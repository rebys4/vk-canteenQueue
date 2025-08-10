import bridge from '@vkontakte/vk-bridge';

const API_URL = import.meta.env.VITE_API_URL;
const DEV_ID = import.meta.env.VITE_DEV_VK_ID;

export class ApiError extends Error {
  status: number;
  code?: string;
  body?: any;
  constructor(status: number, code?: string, body?: any) {
    super(code || `HTTP_${status}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export async function apiRequest(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');

  if (import.meta.env.DEV && DEV_ID) {
    headers.set('X-DEV-User-Id', String(DEV_ID));
  } else {
    try {
      const qs = location.search.startsWith('?') ? location.search.slice(1) : '';
      if (qs && qs.includes('vk_user_id=') && qs.includes('sign=')) {
        headers.set('X-VK-Params', qs);
      } else {
        const lp = await bridge.send('VKWebAppGetLaunchParams');
        const query = new URLSearchParams(lp as any).toString();
        if (query && query.includes('vk_user_id=') && query.includes('sign=')) {
          headers.set('X-VK-Params', query);
        }
      }
    } catch {}
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  let data: any = null;
  const text = await res.text().catch(() => '');
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const code = typeof data === 'object' && data?.error ? data.error : undefined;
    throw new ApiError(res.status, code, data);
  }
  return data;
}