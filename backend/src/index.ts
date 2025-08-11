import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { supaSrv } from './supabase.js';
import { vkAuthMiddleware } from './vkAuth.js';
import { ensureUser, addXp, maybeAwardBadge, isAdmin } from './rewards.js';
import { makeRateLimiter } from './ratelimit.js';
import { logAction } from './audit.js';

const app = express();
app.use(cors());
app.use(express.json());

// Проверка подписи VK (или dev-заглушка через X-DEV-User-Id)
const allowDev = process.env.ALLOW_DEV_NO_SIGN === '1';
const secret = process.env.VK_APP_SECRET!;
if (!secret && !allowDev) {
  throw new Error('VK_APP_SECRET is required (or set ALLOW_DEV_NO_SIGN=1 for dev)');
}
app.use(vkAuthMiddleware(secret ?? '', allowDev));

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Список столовых
app.get('/api/canteens', async (_req, res) => {
  const q = await supaSrv.from('canteens').select('*').order('title');
  if (q.error) return res.status(500).json({ error: q.error.message });
  res.json(q.data);
});

// Очередь (чтение)
app.get('/api/queue', async (req, res) => {
  const canteenId = req.query.canteenId as string;
  if (!canteenId) return res.status(400).json({ error: 'canteenId required' });

  const q = await supaSrv
    .from('queues')
    .select('*')
    .eq('canteen_id', canteenId)
    .in('status', ['waiting', 'served'])
    .order('position', { ascending: true });

  if (q.error) return res.status(500).json({ error: q.error.message });
  res.json(q.data);
});

// Присоединиться к очереди
app.post('/api/queue/join', async (req, res) => {
  const body = z.object({
    canteenId: z.string().uuid(),
    firstName: z.string().optional(),
    lastName: z.string().optional()
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid_body' });

  const vkId = req.vk?.userId!;
  const { canteenId, firstName, lastName } = body.data;

  // окно открыто?
  const c = await supaSrv.from('canteens').select('is_open').eq('id', canteenId).maybeSingle();
  if (c.error) return res.status(500).json({ error: c.error.message });
  if (!c.data?.is_open) return res.status(423).json({ error: 'canteen_closed' });

  await ensureUser(vkId);

  if (firstName || lastName) {
    await supaSrv.from('users_public').upsert({
      vk_id: vkId, first_name: firstName ?? null, last_name: lastName ?? null
    }).eq('vk_id', vkId);
  }

  const existing = await supaSrv.from('queues')
    .select('id,status')
    .eq('canteen_id', canteenId)
    .eq('user_id', vkId)
    .eq('status', 'waiting')
    .maybeSingle();
  if (existing.data) {
    return res.status(409).json({ error: 'already_waiting', row: existing.data });
  }

  // создаём визит
  const visit = await supaSrv.from('visits')
    .insert({ canteen_id: canteenId, vk_id: vkId })
    .select()
    .single();
  if (visit.error) return res.status(500).json({ error: visit.error.message });

  // вставляем в очередь
  const ins = await supaSrv.from('queues')
    .insert({ canteen_id: canteenId, user_id: vkId, visit_id: visit.data.id })
    .select()
    .single();
  if (ins.error) return res.status(500).json({ error: ins.error.message });

  await logAction({ vkId, action: 'queue_join', canteenId, meta: { row_id: ins.data.id } });

  res.json(ins.data);
});

// Выйти из очереди (сам)
app.post('/api/queue/leave', async (req, res) => {
  const body = z.object({ rowId: z.string().uuid() }).safeParse(req.body);
  if (!body.success) return res.status(400).json(body.error);

  const vkId = req.vk?.userId!;
  const { rowId } = body.data;

  const upd = await supaSrv.from('queues')
    .update({ status: 'left' })
    .eq('id', rowId)
    .eq('user_id', vkId)
    .eq('status', 'waiting') // защита от повторного штрафа
    .select('visit_id')
    .single();

  if (upd.error) return res.status(500).json({ error: upd.error.message });

  if (upd.data?.visit_id) {
    await supaSrv.from('visits').update({ left_at: new Date().toISOString() }).eq('id', upd.data.visit_id);
  }

  await addXp(vkId, -2, 'left_early');
  await logAction({ vkId, action: 'queue_leave', meta: { row_id: rowId } });

  res.json({ ok: true });
});

// rate-limit для admin/next
const canNext = makeRateLimiter({ capacity: 5, refillPerSec: 0.5 });

// Админ: позвать следующего
app.post('/api/admin/next', async (req, res) => {
  const body = z.object({ canteenId: z.string().uuid() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid_body' });

  const adminVkId = req.vk?.userId!;
  if (!isAdmin(adminVkId)) return res.status(403).json({ error: 'forbidden' });

  const { canteenId } = body.data;

  // rate-limit
  const key = `next:${adminVkId}:${canteenId}`;
  if (!canNext(key)) return res.status(429).json({ error: 'rate_limited' });

  // первый waiting
  const next = await supaSrv
    .from('queues')
    .select('*')
    .eq('canteen_id', canteenId)
    .eq('status', 'waiting')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!next.data) return res.status(409).json({ error: 'queue_empty' });

  const row = next.data;

  // переводим в served
  const upd = await supaSrv
    .from('queues')
    .update({ status: 'served' })
    .eq('id', row.id)
    .select('visit_id, user_id')
    .single();
  if (upd.error) return res.status(500).json({ error: upd.error.message });

  const vkId = upd.data.user_id;
  const visitId = upd.data.visit_id;

  // served_at и фактическое время
  if (visitId) {
    const servedAt = new Date().toISOString();
    await supaSrv.from('visits').update({ served_at: servedAt }).eq('id', visitId);
    const v = await supaSrv.from('visits').select('joined_at').eq('id', visitId).maybeSingle();
    if (!v.error && v.data?.joined_at) {
      const secs = Math.max(0, Math.floor((new Date(servedAt).getTime() - new Date(v.data.joined_at).getTime()) / 1000));
      await supaSrv.from('visits').update({ actual_seconds: secs }).eq('id', visitId);
    }
  }

  // XP + бейджи
  try {
    await addXp(vkId, +10, 'served_on_time');

    const v = await supaSrv
      .from('visits')
      .select('joined_at, served_at')
      .eq('id', visitId)
      .maybeSingle();

    if (!v.error && v.data?.joined_at) {
      const hourJoined = new Date(v.data.joined_at).getHours();
      if (hourJoined < 12) {
        await addXp(vkId, +5, 'quiet_hour_bonus');
        await maybeAwardBadge(vkId, 'early_bird');
      }
    }
    if (!v.error && v.data?.served_at) {
      const h = new Date(v.data.served_at).getHours();
      if (h >= 15 && h < 17) await maybeAwardBadge(vkId, 'off_peak');

      const dayISO = new Date(v.data.served_at).toISOString().slice(0, 10);
      const streak = await supaSrv.rpc('has_3day_streak', { p_vk_id: vkId, p_day: dayISO });
      if (!streak.error && streak.data === true) {
        await maybeAwardBadge(vkId, '3_days');
      }
    }
  } catch (e) {
    console.warn('rewards error', e);
  }

  await logAction({ vkId: adminVkId, action: 'admin_next', canteenId, meta: { served_row_id: row.id } });

  res.json({ ok: true, served: row.id });
});

// Профиль
app.get('/api/profile', async (req, res) => {
  const vkId = req.vk?.userId!;
  const user = await supaSrv.from('users').select('*').eq('vk_id', vkId).maybeSingle();
  const badges = await supaSrv
    .from('user_badges')
    .select('awarded_at,badges(id,code,title,description)')
    .eq('vk_id', vkId)
    .order('awarded_at', { ascending: false });

  const visits = await supaSrv
    .from('visits')
    .select('canteen_id, joined_at, served_at, left_at')
    .eq('vk_id', vkId)
    .order('joined_at', { ascending: false })
    .limit(50);

  res.json({
    xp: user.data?.xp ?? 0,
    badges: badges.data ?? [],
    visits: visits.data ?? [],
    isAdmin: isAdmin(vkId)
  });
});

// Админ: смена статуса окна
app.post('/api/admin/canteen/open', async (req, res) => {
  const body = z.object({ canteenId: z.string().uuid(), isOpen: z.boolean() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid_body' });

  const adminVkId = req.vk?.userId!;
  if (!isAdmin(adminVkId)) return res.status(403).json({ error: 'forbidden' });

  const { canteenId, isOpen } = body.data;
  const upd = await supaSrv.from('canteens').update({ is_open: isOpen }).eq('id', canteenId).select('id,is_open').single();
  if (upd.error) return res.status(500).json({ error: upd.error.message });

  await logAction({ vkId: adminVkId, action: 'admin_toggle_open', canteenId, meta: { is_open: isOpen } });

  res.json({ ok: true, is_open: upd.data.is_open });
});

// ETA (медиана по истории)
app.get('/api/eta', async (req, res) => {
  const canteenId = req.query.canteenId as string;
  const ahead = Number(req.query.ahead ?? 0);
  if (!canteenId) return res.status(400).json({ error: 'canteenId required' });
  const rpc = await supaSrv.rpc('queue_eta_seconds', { _canteen: canteenId, _ahead: ahead });
  if (rpc.error) return res.status(500).json({ error: rpc.error.message });
  res.json({ eta_seconds: rpc.data ?? 0 });
});

// Квесты на сегодня
app.get('/api/quests/today', async (req, res) => {
  const vkId = req.vk?.userId!;
  const today = new Date().toISOString().slice(0, 10);

  const quests = await supaSrv.from('today_quests').select('*');
  if (quests.error) return res.status(500).json({ error: quests.error.message });

  const prog = await supaSrv
    .from('user_daily_quests')
    .select('quest_code, completed_at, day')
    .eq('vk_id', vkId)
    .eq('day', today);

  const map = new Map<string, { completed_at: string | null }>();
  (prog.data ?? []).forEach(r => map.set(r.quest_code, { completed_at: r.completed_at }));

  const payload = (quests.data ?? []).map(q => ({
    code: q.code,
    title: q.title,
    description: q.description,
    xp: q.xp,
    completed: map.has(q.code) && !!map.get(q.code)?.completed_at
  }));

  res.json(payload);
});

const port = Number(process.env.PORT ?? 5175);
app.listen(port, () => console.log(`Backend listening on :${port}`));