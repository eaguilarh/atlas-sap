import express, { Express, Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import zlib from 'zlib';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import { loadEnv, getEnv } from './config/env.js';
import { getPool, warmupPool, closePool } from './config/db.js';
import { helmetConfig } from './config/helmet.js';
import { applyRateLimiters } from './middleware/rateLimit.js';
import { requestLogger, noCacheHeaders } from './middleware/logging.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRoutes, rfcsRoutes, solicitudesRoutes, sistemasRoutes, usersRoutes, logsRoutes } from './routes/index.js';
import { logApp } from './services/audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnv();
const env = getEnv();

const app: Express = express();
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

app.use((req: Request, res: Response, next: () => void) => {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding.includes('gzip')) return next();

  const originalSend = res.send.bind(res);
  res.send = function (body: unknown) {
    if (res.headersSent || !body) return originalSend(body);
    const contentType = String(res.getHeader('Content-Type') || '');
    const isCompressible = !contentType ||
      contentType.includes('text') ||
      contentType.includes('json') ||
      contentType.includes('javascript') ||
      contentType.includes('css') ||
      contentType.includes('xml') ||
      contentType.includes('html');

    if (isCompressible) {
      try {
        const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : body as Buffer;
        if (Buffer.isBuffer(buffer) && buffer.length > 512) {
          const compressed = zlib.gzipSync(buffer, { level: 6 });
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Vary', 'Accept-Encoding');
          res.removeHeader('Content-Length');
          return originalSend(compressed);
        }
      } catch (e) {
        console.warn('[GZIP_ERROR]', (e as Error).message);
      }
    }
    return originalSend(body);
  };
  next();
});

const logger = pino({
  level: env.LOG_LEVEL,
  formatters: { level: (label) => ({ level: label }) },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: 'atlas-api' },
});

const allowedOrigins = env.ALLOWED_ORIGINS
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(helmet(helmetConfig));

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS blocked: ' + origin), false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['authorization', 'apikey', 'content-type', 'x-client-info', 'prefer', 'x-api-version'],
  exposedHeaders: ['content-range', 'location', 'x-client-info'],
  credentials: true,
  maxAge: 86400,
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((err: Error, _req: Request, res: Response, next: () => void) => {
  if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
    logger.error({ err: err.message }, 'JSON parse error');
    return res.status(400).json({ error: 'Formato de datos JSON no válido.' });
  }
  next(err);
});

applyRateLimiters(app);

app.use(noCacheHeaders);
app.use(requestLogger);

const staticOptions = {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders: (res: Response, filePath: string) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
  },
};

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, staticOptions));
app.use(express.static(__dirname, staticOptions));

app.get('/styles.css', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/css; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const localStylesPath = path.join(__dirname, '..', 'styles.css');
  if (fs.existsSync(localStylesPath)) return res.sendFile(localStylesPath, staticOptions);

  const distStylesPath = path.join(publicDir, 'styles.css');
  if (fs.existsSync(distStylesPath)) return res.sendFile(distStylesPath, staticOptions);

  res.status(404).send('styles.css not found');
});

app.get(['/favicon.png', '/favicon.ico'], (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const localFaviconPath = path.join(__dirname, '..', 'favicon.png');
  if (fs.existsSync(localFaviconPath)) return res.sendFile(localFaviconPath, staticOptions);

  const distFaviconPath = path.join(publicDir, 'favicon.png');
  if (fs.existsSync(distFaviconPath)) return res.sendFile(distFaviconPath, staticOptions);

  res.status(404).send('favicon not found');
});

app.get('/', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const localIndexPath = path.join(__dirname, '..', 'index.html');
  if (fs.existsSync(localIndexPath)) return res.sendFile(localIndexPath, staticOptions);

  const distIndexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(distIndexPath)) return res.sendFile(distIndexPath, staticOptions);

  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"><title>ATLAS · SAP Operations Suite</title></head>
    <body style="font-family:sans-serif;padding:40px;background:#F4F6FA;color:#103268">
      <h1>ATLAS · SAP Operations Suite API Server</h1>
      <p>El servidor API está corriendo correctamente en el puerto ${env.PORT}.</p>
    </body>
    </html>
  `);
});

app.use('/auth/v1', authRoutes);
app.use('/api/rfcs', rfcsRoutes);
app.use('/api/solicitudes', solicitudesRoutes);
app.use('/api/sistemas', sistemasRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/logs', logsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

async function start(): Promise<void> {
  try {
    await warmupPool();
    logger.info('PostgreSQL Pool pre-warmed and connected.');

    const pool = getPool();
    await pool.query("ALTER TABLE public.rfcs ADD COLUMN IF NOT EXISTS coordinador_kof TEXT;").catch(() => {});
    await pool.query("ALTER TABLE public.rfcs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;").catch(() => {});
    await pool.query("ALTER TABLE public.solicitudes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;").catch(() => {});
    await pool.query("ALTER TABLE public.sistemas DROP CONSTRAINT IF EXISTS sistemas_nombre_owner_key;").catch(() => {});
    await pool.query("ALTER TABLE public.sistemas DROP CONSTRAINT IF EXISTS sistemas_nombre_key;").catch(() => {});
    await pool.query("ALTER TABLE public.sistemas ADD CONSTRAINT sistemas_nombre_key UNIQUE (nombre);").catch(() => {});
    await pool.query("ALTER TABLE public.rfcs DROP CONSTRAINT IF EXISTS rfcs_ticket_key;").catch(() => {});
    await pool.query("ALTER TABLE public.rfcs DROP CONSTRAINT IF EXISTS rfcs_ticket_sistema_key;").catch(() => {});
    await pool.query("ALTER TABLE public.rfcs ADD CONSTRAINT rfcs_ticket_sistema_key UNIQUE (ticket, sistema_name);").catch(() => {});
    await pool.query("ALTER TABLE public.rfcs DROP CONSTRAINT IF EXISTS rfcs_status_check;").catch(() => {});
    await pool.query("ALTER TABLE public.rfcs ADD CONSTRAINT rfcs_status_check CHECK (status IN ('En espera de VOBO', 'En Ejecución', 'Finalizado con éxito', 'Finalizado sin éxito', 'Aprobado', 'Cancelado', 'Reprogramar'));").catch(() => {});
    await pool.query("DELETE FROM public.sistemas WHERE nombre = 'Proxmox VE Cluster (Hypervisor)';").catch(() => {});
    await pool.query("UPDATE public.rfcs SET sistema_name = 'SAP EP' WHERE sistema_name = 'EP';").catch(() => {});
    await pool.query("DELETE FROM public.sistemas WHERE nombre = 'EP';").catch(() => {});
    await pool.query("UPDATE public.tqs_users SET sistemas = '{}' WHERE email = 'admin@easconsulting.com.mx';").catch(() => {});
    logger.info('DB Schema migrations & constraints auto-applied on startup.');
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'DB_AUTO_MIGRATION_ERROR');
  }

  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, `ATLAS API Server listening on port ${env.PORT}`);
  });
}

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Shutting down...');
  await closePool();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'Failed to start server');
  process.exit(1);
});

export { app };