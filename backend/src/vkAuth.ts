import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

function base64url(input: Buffer) {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function verifyLaunchParams(query: URLSearchParams, secret: string) {
  const sign = query.get('sign');
  if (!sign) return { ok: false };

  // Собираем vk_* параметры по алфавиту
  const params: string[] = [];
  query.forEach((value, key) => {
    if (key.startsWith('vk_')) params.push(`${key}=${value}`);
  });
  params.sort();
  const data = params.join('&');

  const hmac = crypto.createHmac('sha256', secret).update(data).digest();
  const calc = base64url(hmac);

  return { ok: calc === sign };
}

declare global {
  namespace Express {
    interface Request {
      vk?: { userId: number };
    }
  }
}

export function vkAuthMiddleware(secret: string, allowDevFallback = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Ожидаем заголовок X-VK-Params со строкой query (vk_…)
    const raw = req.header('X-VK-Params');
    if (raw) {
      const qs = new URLSearchParams(raw);
      const v = verifyLaunchParams(qs, secret);
      if (!v.ok) return res.status(401).json({ error: 'bad sign' });
      const id = Number(qs.get('vk_user_id'));
      if (!id) return res.status(401).json({ error: 'vk_user_id missing' });
      req.vk = { userId: id };
      return next();
    }

    // Локальная разработка без подписи
    if (allowDevFallback) {
      const devId = Number(req.header('X-DEV-User-Id') ?? 0);
      if (devId) {
        req.vk = { userId: devId };
        return next();
      }
    }

    return res.status(401).json({ error: 'no vk launch params' });
  };
}
