import { Request, Response, NextFunction } from 'express';
import { getEnv } from '../config/env.js';
import { sanitize, generateRequestId } from '../utils/index.js';
import { logApp } from '../services/audit.js';
import pino from 'pino';

const logger = pino({ name: 'http' });

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  req.id = generateRequestId();
  req.startTime = Date.now();

  let errorPayload: unknown = null;
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    if (res.statusCode >= 400 && body) {
      errorPayload = body;
    }
    return originalJson(body);
  };

  const originalSend = res.send.bind(res);
  res.send = function (body: unknown) {
    if (res.statusCode >= 400 && body && !errorPayload) {
      try {
        errorPayload = typeof body === 'string' ? JSON.parse(body) : body;
      } catch {
        errorPayload = { rawBody: String(body).substring(0, 500) };
      }
    }
    return originalSend(body);
  };

  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '127.0.0.1';

    const logData = {
      reqId: req.id,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      durationMs: duration,
      ip: clientIp,
      userAgent: req.headers['user-agent'],
      userId: (req as any).user?.sub,
      error: errorPayload ? sanitize(errorPayload) : null,
      body: req.sanitizedBody || sanitize(req.body),
      query: sanitize(req.query),
      headers: sanitize(req.headers),
    };

    if (res.statusCode >= 500) {
      logger.error(logData, `HTTP ${req.method} ${req.url} responded with ${res.statusCode}`);
    } else if (res.statusCode >= 400) {
      logger.warn(logData, `HTTP ${req.method} ${req.url} responded with ${res.statusCode}`);
    } else {
      logger.info(logData, `HTTP ${req.method} ${req.url} responded with ${res.statusCode}`);
    }

    if (res.statusCode >= 400) {
      const detailStr = (errorPayload as any)?.details
        ? JSON.stringify((errorPayload as any).details)
        : (errorPayload as any)?.error && typeof (errorPayload as any).error === 'object'
          ? JSON.stringify((errorPayload as any).error)
          : null;

      const errMsg = (errorPayload as any)?.error && typeof (errorPayload as any).error === 'string'
        ? `HTTP ${res.statusCode} en ${req.method} ${req.url}: ${(errorPayload as any).error}`
        : (errorPayload as any)?.message
          ? `HTTP ${res.statusCode} en ${req.method} ${req.url}: ${(errorPayload as any).message}`
          : `HTTP ${req.method} ${req.url} respondió con ${res.statusCode} (${duration}ms)`;

      logApp(
        res.statusCode >= 500 ? 'ERROR' : 'WARN',
        'REST_API',
        errMsg,
        detailStr,
        logData
      );
    }
  });

  next();
}

export function noCacheHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
}