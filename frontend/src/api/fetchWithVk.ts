export function withVkParams(init?: RequestInit): RequestInit {
  const params = location.search.startsWith('?') ? location.search.slice(1) : '';
  const headers = new Headers(init?.headers);

  if (params) headers.set('X-VK-Params', params);
  // dev-режим без подписи
  if (import.meta.env.DEV && !params && import.meta.env.VITE_DEV_VK_ID) {
    headers.set('X-DEV-User-Id', String(import.meta.env.VITE_DEV_VK_ID));
  }

  return { ...init, headers };
}
