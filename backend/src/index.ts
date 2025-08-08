import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { supaSrv } from './supabase.js';
import { vkAuthMiddleware } from './vkAuth.js';
import { ensureUser, addXp, maybeAwardBadge, isAdmin } from './rewards.js';

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
  if (!body.success) return res.status(400).json(body.error);

  const vkId = req.vk?.userId!;
  const { canteenId, firstName, lastName } = body.data;

  await ensureUser(vkId);

  // Публичные имена для анонимного списка
  if (firstName || lastName) {
    await supaSrv.from('users_public').upsert({
      vk_id: vkId, first_name: firstName ?? null, last_name: lastName ?? null
    }).eq('vk_id', vkId);
  }

  // Не даём дубль waiting
  const existing = await supaSrv.from('queues')
    .select('id,status')
    .eq('canteen_id', canteenId)
    .eq('user_id', vkId)
    .eq('status', 'waiting')
    .maybeSingle();

  if (existing.data) return res.json(existing.data);

  // Создаём visit
  const visit = await supaSrv.from('visits')
    .insert({ canteen_id: canteenId, vk_id: vkId })
    .select()
    .single();
  if (visit.error) return res.status(500).json({ error: visit.error.message });

  // Вставляем в очередь
  const ins = await supaSrv.from('queues')
    .insert({ canteen_id: canteenId, user_id: vkId, visit_id: visit.data.id })
    .select()
    .single();

  if (ins.error) return res.status(500).json({ error: ins.error.message });
  res.json(ins.data);
});

// Выйти из очереди (сам)
app.post('/api/queue/leave', async (req, res) => {
  const body = z.object({
    rowId: z.string().uuid()
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json(body.error);

  const vkId = req.vk?.userId!;
  const { rowId } = body.data;

  const upd = await supaSrv.from('queues')
    .update({ status: 'left' })
    .eq('id', rowId)
    .eq('user_id', vkId)
    .select('visit_id')
    .single();

  if (upd.error) return res.status(500).json({ error: upd.error.message });

  if (upd.data?.visit_id) {
    await supaSrv.from('visits').update({ left_at: new Date().toISOString() }).eq('id', upd.data.visit_id);
  }

  // Штраф за уход
  await addXp(vkId, -2, 'left_early');

  res.json({ ok: true });
});

// Админ: позвать следующего
app.post('/api/admin/next', async (req, res) => {
  const body = z.object({
    canteenId: z.string().uuid()
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json(body.error);

  const adminVkId = req.vk?.userId!;
  if (!isAdmin(adminVkId)) return res.status(403).json({ error: 'forbidden' });

  const { canteenId } = body.data;

  // Первый waiting
  const next = await supaSrv.from('queues')
    .select('*')
    .eq('canteen_id', canteenId)
    .eq('status', 'waiting')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!next.data) return res.json({ ok: true, message: 'queue empty' });

  const row = next.data;

  // Помечаем как обслужен
  const upd = await supaSrv.from('queues')
    .update({ status: 'served' })
    .eq('id', row.id)
    .select('visit_id, user_id')
    .single();

  if (upd.error) return res.status(500).json({ error: upd.error.message });

  const vkId = upd.data.user_id;

  // Обновляем визит
  if (upd.data.visit_id) {
    await supaSrv.from('visits').update({ served_at: new Date().toISOString() }).eq('id', upd.data.visit_id);
  }

  // Награды
  await addXp(vkId, +10, 'served_on_time');

  const v = await supaSrv.from('visits').select('joined_at, served_at').eq('id', upd.data.visit_id).single();

  // Ранняя пташка (до 12:00 по времени присоединения)
  if (!v.error && v.data?.joined_at) {
    const hourJoined = new Date(v.data.joined_at).getHours();
    if (hourJoined < 12) {
      await addXp(vkId, +5, 'quiet_hour_bonus');
      await maybeAwardBadge(vkId, 'early_bird');
    }
  }

  // Анти-час-пик: served в 15:00–16:59
  if (!v.error && v.data?.served_at) {
    const hourServed = new Date(v.data.served_at).getHours();
    if (hourServed >= 15 && hourServed < 17) {
      await maybeAwardBadge(vkId, 'off_peak');
    }
  }

  // 3 дня подряд: D, D-1, D-2 (по served_at текущего визита)
  if (!v.error && v.data?.served_at) {
    const dayISO = new Date(v.data.served_at).toISOString().slice(0, 10);
    const streak = await supaSrv.rpc('has_3day_streak', { p_vk_id: vkId, p_day: dayISO });
    if (!streak.error && streak.data === true) {
      await maybeAwardBadge(vkId, '3_days');
    }
  }

  res.json({ ok: true, served: row.id });
});

// Профиль: XP, бейджи, история
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
    visits: visits.data ?? []
  });
});

const port = Number(process.env.PORT ?? 5175);
app.listen(port, () => console.log(`Backend listening on :${port}`));
