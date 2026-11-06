import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JWTPayload } from '../services/jwt.js';
import { getEnv } from '../config/env.js';

export interface AuthRequest extends Request {
  user?: JWTPayload | null;
}

export function authenticateToken(req: AuthRequest, _res: Response, next: NextFunction): void {
  const env = getEnv();
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];

  if (!token || token === env.SB_ANON) {
    req.user = null;
    return next();
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    req.user = null;
    return next();
  }

  req.user = payload;
  next();
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

export function requireRole(...roles: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    let userRole = req.user.role;
    if (!userRole || userRole === 'authenticated') {
      try {
        const pool = (await import('../config/db.js')).getPool();
        const uRes = await pool.query('SELECT rol FROM public.tqs_users WHERE id = $1', [req.user.sub]);
        userRole = uRes.rows[0]?.rol || 'fte';
        req.user.role = userRole;
      } catch {
        userRole = 'fte';
      }
    }

    if (!userRole || userRole === 'authenticated' || !roles.includes(userRole)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    next();
  };
}