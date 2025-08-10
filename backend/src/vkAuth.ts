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

// backend/src/vkAuth.ts
export function vkAuthMiddleware(secret: string, allowDevFallback = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    // 1) Прод/тест с подписью
    const raw = req.header('X-VK-Params') || req.header('X-VK-Launch-Params');
    if (raw) {
      const qs = new URLSearchParams(raw);
      const v = verifyLaunchParams(qs, secret);
      if (!v.ok) return res.status(401).json({ error: 'bad sign' });
      const id = Number(qs.get('vk_user_id'));
      if (!id) return res.status(401).json({ error: 'vk_user_id missing' });
      req.vk = { userId: id };
      return next();
    }

    // 2) Dev: принимаем X-DEV-User-Id если он есть
    const devIdHeader = req.header('X-DEV-User-Id');
    const devId = devIdHeader ? Number(devIdHeader) : 0;
    const isProd = process.env.NODE_ENV === 'production';
    if (devId && (allowDevFallback || !isProd)) {
      req.vk = { userId: devId };
      return next();
    }

    return res.status(401).json({ error: 'no vk launch params' });
  };
}
