const API = import.meta.env.VITE_API_URL!;

export type Profile = {
  xp: number;
  badges: Array<{
    awarded_at: string;
    badges: { id: string; code: string; title: string; description?: string | null };
  }>;
  visits: Array<{ canteen_id: string; joined_at: string; served_at?: string | null; left_at?: string | null }>;
};

export async function loadProfile(): Promise<Profile> {
  const res = await fetch(`${API}/api/profile`, { credentials: 'omit' });
  if (!res.ok) throw new Error('Failed to load profile');
  return res.json();
}
