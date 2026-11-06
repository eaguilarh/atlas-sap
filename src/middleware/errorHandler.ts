import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import pino from 'pino';

const logger = pino({ name: 'error-handler' });

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validación fallida', details: err.flatten() });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, details: err.details });
    return;
  }

  if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
    logger.error({ err: err.message }, 'JSON parse error');
    res.status(400).json({ error: 'Formato de datos JSON no válido.' });
    return;
  }

  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json({ error: 'Error interno del servidor' });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Endpoint no encontrado' });
}