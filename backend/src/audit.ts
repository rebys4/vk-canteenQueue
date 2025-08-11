import { supaSrv } from './supabase.js';

export async function logAction(params: {
  vkId?: number | null;
  action: string;
  canteenId?: string | null;
  meta?: any;
}) {
  try {
    await supaSrv.from('actions_log').insert({
      vk_id: params.vkId ?? null,
      action: params.action,
      canteen_id: params.canteenId ?? null,
      meta: params.meta ?? null,
    });
  } catch (e) {
    console.warn('audit log failed', e);
  }
}