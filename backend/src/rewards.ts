import { supaSrv } from './supabase.js';

export async function ensureUser(vkId: number) {
  await supaSrv.from('users').upsert({ vk_id: vkId }).eq('vk_id', vkId);
}

export async function addXp(vkId: number, delta: number, reason: string, meta: any = null) {
  // Пытаемся через RPC (рекомендовано)
  const rpc = await supaSrv.rpc('add_xp', { p_vk_id: vkId, p_delta: delta });
  if (rpc.error) {
    // Фоллбек: читаем текущее и апсертим новое значение
    const cur = await supaSrv.from('users').select('xp').eq('vk_id', vkId).maybeSingle();
    const newXp = (cur.data?.xp ?? 0) + delta;
    await supaSrv.from('users').upsert({ vk_id: vkId, xp: newXp }).eq('vk_id', vkId);
  }
  await supaSrv.from('xp_log').insert({ vk_id: vkId, delta, reason, meta });
}

export async function maybeAwardBadge(vkId: number, code: string) {
  const b = await supaSrv.from('badges').select('id').eq('code', code).single();
  if (b.error || !b.data) return;
  const has = await supaSrv
    .from('user_badges')
    .select('badge_id')
    .eq('vk_id', vkId)
    .eq('badge_id', b.data.id)
    .maybeSingle();
  if (!has.data) {
    await supaSrv.from('user_badges').insert({ vk_id: vkId, badge_id: b.data.id });
  }
}

const ADMIN_IDS = (process.env.VK_ADMINS || '')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(Boolean);

export function isAdmin(vkId: number): boolean {
  return ADMIN_IDS.includes(vkId);
}
