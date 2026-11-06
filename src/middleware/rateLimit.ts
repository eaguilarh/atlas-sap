import rateLimit from 'express-rate-limit';
import { Request } from 'express';
import { getEnv } from '../config/env.js';

function getRateLimitKey(req: Request): string {
  if (req.user?.sub) return `user:${req.user.sub}`;

  const trustedProxy = req.app.get('trust proxy');
  const forwarded = req.headers['x-forwarded-for'];

  if (trustedProxy && forwarded) {
    const ips = (forwarded as string).split(',').map((ip) => ip.trim());
    return `ip:${ips[0]}`;
  }

  return `ip:${req.ip || req.socket?.remoteAddress || '127.0.0.1'}`;
}

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Demasiados intentos de autenticación. Intente de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  message: { error: 'Límite de tasa de peticiones excedido. Intente de nuevo más tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

export const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: { error: 'Límite de consultas IA excedido. Intente de nuevo en una hora.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

export function applyRateLimiters(app: Express.Application): void {
  app.use('/auth/v1/token', authLimiter);
  app.use('/auth/v1/signup', authLimiter);
  app.use('/auth/v1/refresh', authLimiter);
  app.use('/api/ai/', aiLimiter);
  app.use('/api/', apiLimiter);
  app.use('/rest/v1/', apiLimiter);
  app.use('/functions/v1/', apiLimiter);
}