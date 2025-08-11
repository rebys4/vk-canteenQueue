import { supabase } from './supabase';

export function subscribeQueueStable(canteenId: string, onChange: () => void) {
  let attempt = 0;
  let channel: any;

  const subscribe = () => {
    channel = supabase
      .channel(`queues:${canteenId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'queues', filter: `canteen_id=eq.${canteenId}` },
        () => onChange()
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          attempt = 0;
        } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
          attempt++;
          const backoff = Math.min(30000, 1000 * 2 ** attempt);
          setTimeout(() => {
            try { supabase.removeChannel(channel); } catch {}
            subscribe();
          }, backoff);
        }
      });
  };

  subscribe();

  const refetchTimer = setInterval(onChange, 20000);
  return () => {
    clearInterval(refetchTimer);
    try { supabase.removeChannel(channel); } catch {}
  };
}