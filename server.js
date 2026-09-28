const express = require('express');
const path = require('path');
const zlib = require('zlib');
const fs = require('fs');
const crypto = require('crypto');
const { exec } = require('child_process');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const pino = require('pino');
require('dotenv').config();

const app = express();
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// Middleware de compresión GZIP integrado (0 dependencias extra, velocidad ultra-rápida WAN/DDNS)
app.use((req, res, next) => {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding.includes('gzip')) return next();

  const originalSend = res.send;
  res.send = function(body) {
    if (res.headersSent || !body) return originalSend.call(this, body);
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
        const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
        if (Buffer.isBuffer(buffer) && buffer.length > 512) {
          const compressed = zlib.gzipSync(buffer, { level: 6 });
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Vary', 'Accept-Encoding');
          res.removeHeader('Content-Length');
          return originalSend.call(this, compressed);
        }
      } catch (e) {
        console.warn('[GZIP_ERROR]', e.message);
      }
    }
    return originalSend.call(this, body);
  };
  next();
});

const port = process.env.PORT || 54321;

const JWT_ISSUER = 'atlas-sap-operations';
const JWT_AUDIENCE = 'atlas-api';

function loadSecretFromFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8').trim();
    }
  } catch (err) {
    console.error(`[SECRET_LOAD_ERROR] Failed to read ${filePath}:`, err.message);
  }
  return null;
}

const jwtSecretFromFile = loadSecretFromFile(process.env.JWT_SECRET_FILE);
const jwtSecret = jwtSecretFromFile || process.env.JWT_SECRET;

if (!jwtSecret || jwtSecret.length < 32) {
  console.error('❌ ERROR CRÍTICO: JWT_SECRET debe estar definido (env o file) y tener al menos 32 caracteres');
  process.exit(1);
}
const JWT_SECRET = jwtSecret;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:54321,http://10.10.10.102:54321,http://10.10.10.103:54321,http://easconsulting.fortiddns.com:54321,https://easconsulting.fortiddns.com:54321,https://atlas.easconsulting.com.mx')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: 'atlas-api' },
});

const sanitize = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  const sensitiveKeys = ['password', 'password_hash', 'token', 'access_token', 'refresh_token', 'authorization', 'apikey', 'secret', 'key'];
  const clean = Array.isArray(obj) ? [] : {};
  for (const [key, val] of Object.entries(obj)) {
    if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
      clean[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      clean[key] = sanitize(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
};

const dbConfig = {
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/atlas',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};
const pool = new Pool(dbConfig);
pool.query('SELECT 1').then(async () => {
  logger.info('PostgreSQL Pool pre-warmed and connected.');
  try {
    await pool.query("ALTER TABLE public.rfcs ADD COLUMN IF NOT EXISTS coordinador_kof TEXT;");
    await pool.query("ALTER TABLE public.rfcs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;");
    await pool.query("ALTER TABLE public.solicitudes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;");
    await pool.query("ALTER TABLE public.sistemas DROP CONSTRAINT IF EXISTS sistemas_nombre_owner_key;");
    await pool.query("ALTER TABLE public.sistemas DROP CONSTRAINT IF EXISTS sistemas_nombre_key;");
    await pool.query("ALTER TABLE public.sistemas ADD CONSTRAINT sistemas_nombre_key UNIQUE (nombre);");
    await pool.query("ALTER TABLE public.rfcs DROP CONSTRAINT IF EXISTS rfcs_ticket_key;");
    await pool.query("ALTER TABLE public.rfcs DROP CONSTRAINT IF EXISTS rfcs_ticket_sistema_key;");
    await pool.query("ALTER TABLE public.rfcs ADD CONSTRAINT rfcs_ticket_sistema_key UNIQUE (ticket, sistema_name);");
    await pool.query("ALTER TABLE public.rfcs DROP CONSTRAINT IF EXISTS rfcs_status_check;");
    await pool.query("ALTER TABLE public.rfcs ADD CONSTRAINT rfcs_status_check CHECK (status IN ('En espera de VOBO', 'En Ejecución', 'Finalizado con éxito', 'Finalizado sin éxito', 'Aprobado', 'Cancelado', 'Reprogramar'));");
    await pool.query("DELETE FROM public.sistemas WHERE nombre = 'Proxmox VE Cluster (Hypervisor)';");
    await pool.query("UPDATE public.rfcs SET sistema_name = 'SAP EP' WHERE sistema_name = 'EP';");
    await pool.query("DELETE FROM public.sistemas WHERE nombre = 'EP';");
    await pool.query("UPDATE public.tqs_users SET sistemas = '{}' WHERE email = 'admin@easconsulting.com.mx';");
    logger.info('DB Schema migrations & constraints auto-applied on startup.');
  } catch (migErr) {
    logger.error({ err: migErr.message }, 'DB_AUTO_MIGRATION_ERROR');
  }
}).catch(err => {
  logger.error({ err: err.message }, 'PG_POOL_PREWARM_ERROR');
});

pool.on('error', (err) => {
  logger.error({ err: err.message }, 'PG_POOL_ERROR');
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.sheetjs.com", "https://fonts.googleapis.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["*"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: null
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xPoweredBy: false,
}));

const corsOptions = {
  origin: (origin, callback) => {
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
  maxAge: 86400
};
app.use(cors(corsOptions));

const sanitizeBody = (req, res, next) => {
  const sensitiveKeys = ['password', 'password_hash', 'token', 'access_token', 'refresh_token', 'authorization'];
  const sanitize = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const clean = Array.isArray(obj) ? [] : {};
    for (const [key, val] of Object.entries(obj)) {
      if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
        clean[key] = '[REDACTED]';
      } else if (typeof val === 'object' && val !== null) {
        clean[key] = sanitize(val);
      } else {
        clean[key] = val;
      }
    }
    return clean;
  };
  req.sanitizedBody = sanitize(req.body);
  next();
};

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.error({ reqId: req.id, err: err.message }, 'JSON parse error');
    return res.status(400).json({ error: 'Formato de datos JSON no válido.' });
  }
  next(err);
});

const getRateLimitKey = (req) => {
  if (req.user?.sub) return `user:${req.user.sub}`;
  // Use socket remote address as primary, x-forwarded-for only if behind trusted proxy
  const trustedProxy = req.app.get('trust proxy');
  const forwarded = req.headers['x-forwarded-for'];
  if (trustedProxy && forwarded) {
    const ips = forwarded.split(',').map(ip => ip.trim());
    return `ip:${ips[0]}`;
  }
  return `ip:${req.ip || req.socket?.remoteAddress || '127.0.0.1'}`;
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Demasiados intentos de autenticación. Intente de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  message: { error: 'Límite de tasa de peticiones excedido. Intente de nuevo más tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: { error: 'Límite de consultas IA excedido. Intente de nuevo en una hora.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

app.use('/auth/v1/token', authLimiter);
app.use('/auth/v1/signup', authLimiter);
app.use('/auth/v1/refresh', authLimiter);
app.use('/api/ai/', aiLimiter);
app.use('/api/', apiLimiter);
app.use('/rest/v1/', apiLimiter);
app.use('/functions/v1/', apiLimiter);

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

const staticOptions = {
  etag: false,
  lastModified: false,
  maxAge: 0,
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    if (filePath && filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
  }
};

app.use(express.static(path.join(__dirname, '..'), staticOptions));
app.use(express.static(__dirname, staticOptions));

app.get('/styles.css', (req, res) => {
  res.setHeader('Content-Type', 'text/css; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const localStylesPath = path.join(__dirname, 'styles.css');
  if (fs.existsSync(localStylesPath)) return res.sendFile(localStylesPath, staticOptions);
  const rootStylesPath = path.join(__dirname, '..', 'styles.css');
  if (fs.existsSync(rootStylesPath)) return res.sendFile(rootStylesPath, staticOptions);
  res.status(404).send('styles.css not found');
});

app.get(['/favicon.png', '/favicon.ico'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const localFaviconPath = path.join(__dirname, 'favicon.png');
  if (fs.existsSync(localFaviconPath)) return res.sendFile(localFaviconPath, staticOptions);
  const rootFaviconPath = path.join(__dirname, '..', 'favicon.png');
  if (fs.existsSync(rootFaviconPath)) return res.sendFile(rootFaviconPath, staticOptions);
  res.status(404).send('favicon not found');
});

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const localIndexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(localIndexPath)) return res.sendFile(localIndexPath, staticOptions);
  const rootIndexPath = path.join(__dirname, '..', 'index.html');
  if (fs.existsSync(rootIndexPath)) return res.sendFile(rootIndexPath, staticOptions);
  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"><title>ATLAS · SAP Operations Suite</title></head>
    <body style="font-family:sans-serif;padding:40px;background:#F4F6FA;color:#103268">
      <h1>ATLAS · SAP Operations Suite API Server</h1>
      <p>El servidor API está corriendo correctamente en el puerto ${port}.</p>
    </body>
    </html>
  `);
});

const logApp = async (nivel, modulo, mensaje, stackTrace = null, requestInfo = {}) => {
  try {
    await pool.query(
      `INSERT INTO public.log_aplicacion (nivel, modulo, mensaje, stack_trace, request_info) VALUES ($1, $2, $3, $4, $5)`,
      [nivel, modulo, mensaje, stackTrace, JSON.stringify(requestInfo)]
    );
  } catch (err) {
    logger.error({ err: err.message, modulo, mensaje, stack: err.stack }, 'LOG_APP_FAIL - DATABASE UNAVAILABLE, AUDIT LOST');
    // Increment audit failure metric for alerting
    if (typeof global.auditFailureCount === 'undefined') global.auditFailureCount = 0;
    global.auditFailureCount++;
  }
  
  const logData = { modulo, mensaje, stackTrace, requestInfo };
  if (nivel === 'ERROR' || nivel === 'CRITICAL') {
    logger.error(logData, 'Application log');
  } else if (nivel === 'WARN') {
    logger.warn(logData, 'Application log');
  } else {
    logger.info(logData, 'Application log');
  }
};

const logAudit = async (usuarioId, usuarioEmail, ipAddress, accion, modulo = 'AUTH', nivel = 'INFO', detalles = {}) => {
  try {
    await pool.query(
      `INSERT INTO public.log_auditoria (usuario_id, usuario_email, ip_address, accion, modulo, nivel, detalles) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [usuarioId || null, usuarioEmail || null, ipAddress || '127.0.0.1', accion, modulo, nivel, JSON.stringify(detalles)]
    );
  } catch (err) {
    logger.error({ err: err.message, accion, modulo, stack: err.stack }, 'LOG_AUDIT_FAIL - DATABASE UNAVAILABLE, AUDIT LOST');
    if (typeof global.auditFailureCount === 'undefined') global.auditFailureCount = 0;
    global.auditFailureCount++;
  }
  
  logger.info({ usuarioId, usuarioEmail, ipAddress, accion, modulo, nivel, detalles }, 'Audit log');
};

const logActivity = async (usuarioId, usuarioEmail, entidad, entidadId, accion, resumen, cambios = {}) => {
  try {
    await pool.query(
      `INSERT INTO public.log_actividades (usuario_id, usuario_email, entidad, entidad_id, accion, resumen, cambios) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [usuarioId || null, usuarioEmail || null, entidad, String(entidadId || ''), accion, resumen, JSON.stringify(cambios)]
    );
  } catch (err) {
    logger.error({ err: err.message, entidad, accion, stack: err.stack }, 'LOG_ACTIVITY_FAIL - DATABASE UNAVAILABLE, AUDIT LOST');
    if (typeof global.auditFailureCount === 'undefined') global.auditFailureCount = 0;
    global.auditFailureCount++;
  }
  
  logger.info({ usuarioId, usuarioEmail, entidad, entidadId, accion, resumen, cambios }, 'Activity log');
};

app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  req.startTime = Date.now();
  
  let errorPayload = null;
  const originalJson = res.json;
  res.json = function(body) {
    if (res.statusCode >= 400 && body) {
      errorPayload = body;
    }
    return originalJson.call(this, body);
  };

  const originalSend = res.send;
  res.send = function(body) {
    if (res.statusCode >= 400 && body && !errorPayload) {
      try {
        errorPayload = typeof body === 'string' ? JSON.parse(body) : body;
      } catch (e) {
        errorPayload = { rawBody: String(body).substring(0, 500) };
      }
    }
    return originalSend.call(this, body);
  };

  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const logData = {
      reqId: req.id,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      durationMs: duration,
      ip: clientIp,
      userAgent: req.headers['user-agent'],
      userId: req.user?.sub,
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
      const detailStr = errorPayload?.details 
        ? JSON.stringify(errorPayload.details) 
        : errorPayload?.error && typeof errorPayload.error === 'object'
          ? JSON.stringify(errorPayload.error)
          : null;

      const errMsg = errorPayload?.error && typeof errorPayload.error === 'string'
        ? `HTTP ${res.statusCode} en ${req.method} ${req.url}: ${errorPayload.error}`
        : errorPayload?.message
          ? `HTTP ${res.statusCode} en ${req.method} ${req.url}: ${errorPayload.message}`
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
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token || token === process.env.SB_ANON) {
    req.user = null;
    return next();
  }

  jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE }, (err, user) => {
    if (err) return res.status(403).json({ error: 'invalid token' });
    req.user = user;
    next();
  });
};

const requireAuth = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  next();
};

const requireRole = (...roles) => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  let userRole = req.user.role;
  if (!userRole || userRole === 'authenticated') {
    try {
      const uRes = await pool.query('SELECT rol FROM public.tqs_users WHERE id = $1', [req.user.sub]);
      userRole = uRes.rows[0]?.rol || 'fte';
      req.user.role = userRole;
    } catch(e) {
      userRole = 'fte';
    }
  }
  if (!userRole || userRole === 'authenticated') return res.status(403).json({ error: 'forbidden: explicit role required' });
  if (!roles.includes(userRole)) return res.status(403).json({ error: 'forbidden' });
  next();
};

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  options: z.object({ data: z.object({ nombre: z.string().optional(), rol: z.string().optional(), sistemas: z.array(z.string()).optional(), siguiendo_tqs: z.array(z.string().uuid()).optional(), backup_tqs_id: z.string().uuid().nullable().optional() }).passthrough().optional() }).optional(),
});

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

const passwordSchema = z.object({
  password: z.string().min(8),
});

const adminUserSchema = z.object({
  action: z.enum(['create', 'update', 'toggleActivo', 'delete']),
  id: z.string().uuid().optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  nombre: z.string().min(1).optional(),
  rol: z.enum(['admin', 'tqs_leader', 'fte', 'director', 'guardia']).optional(),
  sistemas: z.array(z.string()).optional(),
  siguiendo_tqs: z.array(z.string().uuid()).optional(),
  backup_tqs_id: z.string().uuid().nullable().optional(),
  activo: z.boolean().optional(),
});

const rfcsInsertSchema = z.object({
  ticket: z.string().min(1),
  tipo: z.string().optional(),
  ambiente: z.string().optional(),
  fecha: z.string().min(1),
  fecha_fin: z.string().nullable().optional(),
  fecha_fin_retorno: z.string().nullable().optional(),
  sistema_name: z.string().optional(),
  sistema_grupo: z.string().optional(),
  sid: z.string().optional(),
  promotor: z.string().optional(),
  coordinador_kof: z.string().optional(),
  descripcion: z.string().optional(),
  observaciones: z.string().optional(),
  status: z.string().optional(),
  hora_inicio: z.string().optional(),
  hora_fin: z.string().optional(),
  hora_fin_retorno: z.string().optional(),
  owner_id: z.string().uuid().optional(),
  tqs_ids: z.array(z.string().uuid()).optional(),
});

const solicitudesInsertSchema = z.object({
  tipo: z.enum(['KIT', 'Incidente', 'RCA', 'Requerimiento', 'Actividad']),
  origen: z.enum(['DXC', 'KOF']).optional(),
  fecha_inicio: z.string().min(1),
  sistema_sap: z.string().optional(),
  responsable: z.string().optional(),
  estatus: z.string().optional(),
  descripcion: z.string().optional(),
  titulo: z.string().optional(),
  action_items: z.array(z.any()).optional(),
  bitacora: z.array(z.any()).optional(),
  owner_id: z.string().uuid().optional(),
  tqs_ids: z.array(z.string().uuid()).optional(),
});

const sistemasInsertSchema = z.object({
  nombre: z.string().min(1),
  infraestructura: z.enum(['OnPremise', 'Azure']).optional(),
  tipo_sap: z.enum(['SAP', 'No SAP']).optional(),
  criticidad: z.number().int().min(1).max(3).optional(),
  owner_id: z.string().uuid().nullable().optional(),
  backup_id: z.string().uuid().nullable().optional(),
  activo: z.boolean().optional(),
});

const ALLOWED_COLUMNS = {
  rfcs: ['id', 'ticket', 'tipo', 'ambiente', 'fecha', 'fecha_fin', 'fecha_fin_retorno', 'sistema_name', 'sistema_grupo', 'sid', 'promotor', 'coordinador_kof', 'descripcion', 'observaciones', 'status', 'hora_inicio', 'hora_fin', 'hora_fin_retorno', 'owner_id', 'tqs_ids', 'created_at', 'updated_at', 'deleted_at'],
  solicitudes: ['id', 'ticket', 'tipo', 'origen', 'fecha_inicio', 'sistema_sap', 'responsable', 'estatus', 'descripcion', 'titulo', 'action_items', 'bitacora', 'owner_id', 'tqs_ids', 'created_at', 'updated_at', 'deleted_at'],
  tqs_users: ['id', 'nombre', 'email', 'rol', 'sistemas', 'siguiendo_tqs', 'backup_tqs_id', 'activo', 'primer_login', 'created_at', 'updated_at'],
  sistemas: ['id', 'nombre', 'infraestructura', 'tipo_sap', 'criticidad', 'owner_id', 'backup_id', 'activo', 'created_at', 'updated_at'],
  log_aplicacion: ['id', 'nivel', 'modulo', 'mensaje', 'stack_trace', 'request_info', 'created_at'],
  log_auditoria: ['id', 'usuario_id', 'usuario_email', 'ip_address', 'accion', 'modulo', 'nivel', 'detalles', 'created_at'],
  log_actividades: ['id', 'usuario_id', 'usuario_email', 'entidad', 'entidad_id', 'accion', 'resumen', 'cambios', 'created_at'],
  log_sincronizacion: ['id', 'entidad', 'entidad_id', 'accion', 'estado', 'detalles', 'created_at'],
  auth_users: ['id', 'email', 'password_hash', 'raw_user_meta_data', 'created_at', 'updated_at'],
  refresh_tokens: ['id', 'user_id', 'token_hash', 'expires_at', 'created_ip', 'revoked_at', 'revoked_ip', 'created_at'],
};

const ALLOWED_TABLES = ['rfcs', 'solicitudes', 'tqs_users', 'sistemas', 'log_aplicacion', 'log_auditoria', 'log_actividades', 'log_sincronizacion'];

const tableSchemas = {
  rfcs: rfcsInsertSchema,
  solicitudes: solicitudesInsertSchema,
  sistemas: sistemasInsertSchema,
};

app.post('/auth/v1/signup', async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
  }
  const { email, password, options } = parsed.data;

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const metadata = options?.data || {};

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const userRes = await client.query(
        'INSERT INTO public.auth_users (email, password_hash, raw_user_meta_data) VALUES ($1, $2, $3) RETURNING id, email, raw_user_meta_data',
        [email.toLowerCase(), passwordHash, JSON.stringify(metadata)]
      );
      
      const createdUser = userRes.rows[0];

      if (metadata.nombre || metadata.rol || metadata.sistemas || metadata.backup_tqs_id) {
        await client.query(
          'UPDATE public.tqs_users SET nombre = COALESCE($1, nombre), rol = COALESCE($2, rol), sistemas = COALESCE($3, sistemas), backup_tqs_id = COALESCE($4, backup_tqs_id) WHERE id = $5',
          [metadata.nombre || null, metadata.rol || null, Array.isArray(metadata.sistemas) ? metadata.sistemas : null, metadata.backup_tqs_id || null, createdUser.id]
        );
      }

      await client.query('COMMIT');

      const token = jwt.sign(
        { sub: createdUser.id, email: createdUser.email, role: 'fte' }, 
        JWT_SECRET, 
        { expiresIn: '24h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
      );
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const { token: refreshToken, expiresAt } = await generateRefreshToken(createdUser.id, clientIp);
      
      res.status(200).json({
        access_token: token,
        token_type: 'bearer',
        expires_in: 86400,
        refresh_token: refreshToken,
        refresh_token_expires_at: expiresAt.toISOString(),
        user: {
          id: createdUser.id,
          email: createdUser.email,
          user_metadata: createdUser.raw_user_meta_data,
          role: 'fte',
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email ya registrado' });
    logger.error({ err: err.message, stack: err.stack }, 'Signup error');
    res.status(400).json({ error: err.message || 'Signup failed' });
  }
});

app.post('/api/user/change-password', authenticateToken, requireAuth, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
    }

    const userId = req.user.sub;
    const passwordHash = await bcrypt.hash(newPassword, 12);

    await pool.query(
      'UPDATE public.auth_users SET password_hash = $1 WHERE id = $2',
      [passwordHash, userId]
    );

    await pool.query(
      'UPDATE public.tqs_users SET primer_login = false, updated_at = NOW() WHERE id = $1',
      [userId]
    );

    logAudit(userId, req.user.email, req.ip, 'CHANGE_PASSWORD', 'AUTH', 'INFO', { message: 'Contraseña actualizada exitosamente' });
    logger.info({ userId }, 'PASSWORD_CHANGED_SUCCESS');

    return res.json({ ok: true, message: 'Contraseña actualizada correctamente.' });
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'CHANGE_PASSWORD_ERROR');
    return res.status(500).json({ error: 'Error al actualizar la contraseña.' });
  }
});

async function generateRefreshToken(userId, clientIp) {
  const token = crypto.randomBytes(64).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.refresh_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
      token_hash VARCHAR(255) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_ip VARCHAR(45),
      revoked_at TIMESTAMPTZ,
      revoked_ip VARCHAR(45),
      replaced_by_token_hash VARCHAR(255)
    );
  `).catch(() => {});

  await pool.query(
    `INSERT INTO public.refresh_tokens (user_id, token_hash, expires_at, created_ip) VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, expiresAt, clientIp]
  );
  
  return { token, tokenHash, expiresAt };
}

async function verifyRefreshToken(token, userId) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const result = await pool.query(
    `SELECT * FROM public.refresh_tokens WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND expires_at > NOW()`,
    [userId, tokenHash]
  );
  return result.rows.length > 0;
}

async function revokeRefreshToken(token, userId, revokedIp, replacedByToken = null) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const updateFields = ['revoked_at = NOW()', 'revoked_ip = $1'];
  const params = [revokedIp, userId, tokenHash];
  
  if (replacedByToken) {
    const replacedHash = crypto.createHash('sha256').update(replacedByToken).digest('hex');
    updateFields.push('replaced_by_token_hash = $4');
    params.push(replacedHash);
  }
  
  await pool.query(
    `UPDATE public.refresh_tokens SET ${updateFields.join(', ')} WHERE user_id = $2 AND token_hash = $3`,
    params
  );

  // Cascade revocation: revoke all tokens that were replaced by this token
  await pool.query(
    `UPDATE public.refresh_tokens SET revoked_at = NOW(), revoked_ip = $1 WHERE user_id = $2 AND replaced_by_token_hash = $3`,
    [revokedIp, userId, tokenHash]
  );
}

async function rotateRefreshToken(oldToken, userId, clientIp) {
  await revokeRefreshToken(oldToken, userId, clientIp);
  return generateRefreshToken(userId, clientIp);
}

app.post('/auth/v1/token', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }
  const { email, password } = parsed.data;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  let cleanInput = email.trim().toLowerCase();
  let usernamePrefix = cleanInput.includes('@') ? cleanInput.split('@')[0] : cleanInput;
  let domainVariant1 = usernamePrefix + '@easconsulting.com.mx';
  let domainVariant2 = usernamePrefix + '@eas-consulting.com';
  let domainVariant3 = usernamePrefix + '@easconsulting.com';

  try {
    let userRes = await pool.query(
      `SELECT * FROM public.auth_users 
       WHERE LOWER(email) = LOWER($1) 
          OR LOWER(email) = LOWER($2) 
          OR LOWER(email) = LOWER($3) 
          OR LOWER(email) = LOWER($4) 
          OR LOWER(email) LIKE LOWER($5) 
       ORDER BY id ASC LIMIT 1`,
      [cleanInput, domainVariant1, domainVariant2, domainVariant3, usernamePrefix + '@%']
    );
    
    if (userRes.rows.length === 0) {
      logAudit(null, cleanEmail, clientIp, 'LOGIN_FAILED', 'AUTH', 'WARN', { motivo: 'Usuario no encontrado' });
      return res.status(400).json({ error: 'Credenciales inválidas' });
    }

    const user = userRes.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      logAudit(user.id, user.email, clientIp, 'LOGIN_FAILED', 'AUTH', 'WARN', { motivo: 'Contraseña incorrecta' });
      return res.status(400).json({ error: 'Credenciales inválidas' });
    }

    const profileRes = await pool.query('SELECT rol, activo FROM public.tqs_users WHERE id = $1', [user.id]);
    if (profileRes.rows.length > 0 && !profileRes.rows[0].activo) {
      logAudit(user.id, user.email, clientIp, 'LOGIN_FAILED', 'AUTH', 'WARN', { motivo: 'Cuenta desactivada' });
      return res.status(400).json({ error: 'Cuenta desactivada' });
    }

    const realRole = profileRes.rows[0]?.rol || 'fte';

    await pool.query('UPDATE public.tqs_users SET primer_login = false WHERE id = $1', [user.id]).catch(() => {});

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: realRole }, 
      JWT_SECRET, 
      { expiresIn: '24h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );
    
    const { token: refreshToken, expiresAt } = await generateRefreshToken(user.id, clientIp);
    
    logAudit(user.id, user.email, clientIp, 'LOGIN_SUCCESS', 'AUTH', 'INFO', { timestamp: new Date().toISOString() });

    res.status(200).json({
      access_token: token,
      token_type: 'bearer',
      expires_in: 86400,
      refresh_token: refreshToken,
      refresh_token_expires_at: expiresAt.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        user_metadata: user.raw_user_meta_data,
        role: realRole,
      },
    });
  } catch (err) {
    logApp('ERROR', 'AUTH', 'Excepción interna en login', err.stack);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

const recoverSchema = z.object({
  email: z.string().email(),
  method: z.enum(['security_question', 'admin_reset']).optional(),
  security_answer: z.string().optional(),
  admin_user_id: z.string().uuid().optional(),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  reset_code: z.string().min(4),
  new_password: z.string().min(8),
});

const securityQuestionSchema = z.object({
  user_id: z.string().uuid(),
  question_id: z.string(),
  answer_hash: z.string(),
});

app.post('/auth/v1/recover', async (req, res) => {
  const parsed = recoverSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
  }
  const { email, method = 'security_question', security_answer, admin_user_id } = parsed.data;
  const cleanEmail = email.trim().toLowerCase();
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  try {
    const userRes = await pool.query(
      'SELECT id, email, raw_user_meta_data FROM public.auth_users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [cleanEmail]
    );

    if (userRes.rows.length === 0) {
      logAudit(null, cleanEmail, clientIp, 'RECOVER_REQUEST_UNKNOWN_USER', 'AUTH', 'WARN');
      return res.status(200).json({
        ok: true,
        message: 'Si el correo está registrado, se mostrarán las opciones de recuperación.'
      });
    }

    const user = userRes.rows[0];
    const meta = user.raw_user_meta_data || {};
    const securityQuestions = meta.security_questions || [];

    if (method === 'admin_reset') {
      if (!req.user || !['admin', 'director', 'tqs_leader'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Solo administradores, directores o TQS Leaders pueden iniciar reset por admin' });
      }
      const resetCode = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await pool.query(`
        ALTER TABLE public.auth_users ADD COLUMN IF NOT EXISTS reset_code VARCHAR(20);
        ALTER TABLE public.auth_users ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMP;
        ALTER TABLE public.tqs_users ADD COLUMN IF NOT EXISTS reset_code VARCHAR(20);
        ALTER TABLE public.tqs_users ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMP;
      `).catch(() => {});

      await pool.query(
        'UPDATE public.auth_users SET reset_code = $1, reset_expires = $2 WHERE id = $3',
        [resetCode, expiresAt, user.id]
      );
      await pool.query(
        'UPDATE public.tqs_users SET reset_code = $1, reset_expires = $2 WHERE id = $3',
        [resetCode, expiresAt, user.id]
      ).catch(() => {});

logAudit(user.id, user.email, clientIp, 'PASSWORD_RECOVERY_ADMIN_RESET', 'AUTH', 'INFO', { 
        resetCode, 
        adminId: req.user.sub,
        adminEmail: req.user.email 
      });

      return res.status(200).json({
        ok: true,
        method: 'admin_reset',
        message: 'Código de recuperación generado por admin. Expira en 60 minutos. Consulte el canal seguro para obtenerlo.'
      });
    }

    if (method === 'security_question') {
      if (security_answer && securityQuestions.length > 0) {
        const question = securityQuestions[0];
        const answerHash = crypto.createHash('sha256').update(security_answer.trim().toLowerCase()).digest('hex');
        
        if (question.answer_hash !== answerHash) {
          logAudit(user.id, cleanEmail, clientIp, 'SECURITY_QUESTION_FAILED', 'AUTH', 'WARN');
          return res.status(400).json({ error: 'Respuesta de seguridad incorrecta' });
        }
      }

      const resetCode = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      await pool.query(`
        ALTER TABLE public.auth_users ADD COLUMN IF NOT EXISTS reset_code VARCHAR(20);
        ALTER TABLE public.auth_users ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMP;
        ALTER TABLE public.tqs_users ADD COLUMN IF NOT EXISTS reset_code VARCHAR(20);
        ALTER TABLE public.tqs_users ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMP;
      `).catch(() => {});

      await pool.query(
        'UPDATE public.auth_users SET reset_code = $1, reset_expires = $2 WHERE id = $3',
        [resetCode, expiresAt, user.id]
      );
      await pool.query(
        'UPDATE public.tqs_users SET reset_code = $1, reset_expires = $2 WHERE id = $3',
        [resetCode, expiresAt, user.id]
      ).catch(() => {});

logAudit(user.id, user.email, clientIp, 'PASSWORD_RECOVERY_SECURITY_QUESTION', 'AUTH', 'INFO', { resetCode });

      // 1. Enviar correo SMTP directo por Outlook (100% garantizado)
      try {
        const userName = meta.nombre || user.email;
        const cleanName = String(userName).replace(/"/g, '');
        exec(`node /app/send_email_smtp.js "${user.email}" "${resetCode}" "${cleanName}"`, (err, stdout, stderr) => {
          if (err) console.error('[SMTP_EMAIL_ERROR]', err.message, stderr);
          else console.log('[SMTP_EMAIL_SUCCESS]', stdout.trim());
        });
      } catch (eMail) {
        console.error('[SMTP_EXEC_EXCEPTION]', eMail.message);
      }

      // 2. Disparar Webhook de n8n para trazabilidad
      try {
        fetch('http://10.10.10.103:5678/webhook/atlas-recover-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: user.email,
            code: resetCode,
            nombre: meta.nombre || user.email
          })
        }).catch(e => console.warn('[N8N_RECOVER_WEBHOOK_WARN]', e.message));
      } catch (e) {}

      return res.status(200).json({
        ok: true,
        method: 'security_question',
        message: 'Código de recuperación generado y enviado a tu correo electrónico.'
      });
    }

    return res.status(400).json({ error: 'Método de recuperación no válido' });
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'Recover password error');
    return res.status(500).json({ error: 'Error al procesar solicitud de recuperación de contraseña.' });
  }
});

app.post('/auth/v1/security-questions', authenticateToken, requireAuth, async (req, res) => {
  const parsed = securityQuestionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
  }
  const { user_id, question_id, answer_hash } = parsed.data;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  if (req.user.sub !== user_id && !['admin', 'director'].includes(req.user.role)) {
    return res.status(403).json({ error: 'No autorizado para configurar preguntas de otro usuario' });
  }

  try {
    const userRes = await pool.query('SELECT raw_user_meta_data FROM public.auth_users WHERE id = $1', [user_id]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    const meta = userRes.rows[0].raw_user_meta_data || {};
    const questions = meta.security_questions || [];
    
    const questionMap = {
      'birth_city': '¿En qué ciudad naciste?',
      'first_pet': '¿Cuál fue el nombre de tu primera mascota?',
      'mother_maiden': '¿Cuál es el apellido de soltera de tu madre?',
      'first_school': '¿Cuál fue el nombre de tu primera escuela?',
      'favorite_teacher': '¿Cuál era el nombre de tu maestro favorito?'
    };

    const questionText = questionMap[question_id] || question_id;
    const hashedAnswer = crypto.createHash('sha256').update(answer_hash.trim().toLowerCase()).digest('hex');

    const existingIndex = questions.findIndex(q => q.id === question_id);
    if (existingIndex >= 0) {
      questions[existingIndex] = { id: question_id, question: questionText, answer_hash: hashedAnswer };
    } else {
      questions.push({ id: question_id, question: questionText, answer_hash: hashedAnswer });
    }

    await pool.query(
      'UPDATE public.auth_users SET raw_user_meta_data = jsonb_set(raw_user_meta_data, $1, $2) WHERE id = $3',
      ['{security_questions}', JSON.stringify(questions), user_id]
    );

    logAudit(req.user.sub, req.user.email, clientIp, 'SECURITY_QUESTION_SET', 'AUTH', 'INFO', { userId: user_id, questionId: question_id });
    return res.status(200).json({ ok: true, message: 'Pregunta de seguridad configurada' });
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'Security question error');
    return res.status(500).json({ error: 'Error al configurar pregunta de seguridad' });
  }
});

app.get('/auth/v1/security-questions/:userId', authenticateToken, requireAuth, async (req, res) => {
  const { userId } = req.params;
  
  if (req.user.sub !== userId && !['admin', 'director'].includes(req.user.role)) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  try {
    const userRes = await pool.query('SELECT raw_user_meta_data FROM public.auth_users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    const meta = userRes.rows[0].raw_user_meta_data || {};
    const questions = meta.security_questions || [];
    const safeQuestions = questions.map(q => ({ id: q.id, question: q.question }));
    
    return res.status(200).json({ questions: safeQuestions });
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener preguntas de seguridad' });
  }
});

app.post('/auth/v1/reset-password', async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Todos los campos son requeridos y la nueva contraseña debe tener al menos 8 caracteres.' });
  }
  const { email, reset_code, new_password } = parsed.data;
  const cleanEmail = email.trim().toLowerCase();
  const cleanCode = reset_code.trim();
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  try {
    const userRes = await pool.query(
      'SELECT id, email, reset_code, reset_expires FROM public.auth_users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [cleanEmail]
    );

    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: 'Usuario o código de recuperación no válido.' });
    }

    const user = userRes.rows[0];

    if (!user.reset_code || user.reset_code !== cleanCode) {
      logAudit(user.id, cleanEmail, clientIp, 'RESET_PASSWORD_FAILED', 'AUTH', 'WARN', { motivo: 'Código inválido' });
      return res.status(400).json({ error: 'El código de recuperación es incorrecto o ha expirado.' });
    }

    if (user.reset_expires && new Date(user.reset_expires) < new Date()) {
      logAudit(user.id, cleanEmail, clientIp, 'RESET_PASSWORD_FAILED', 'AUTH', 'WARN', { motivo: 'Código expirado' });
      return res.status(400).json({ error: 'El código de recuperación ha expirado. Por favor solicita uno nuevo.' });
    }

    const newHash = await bcrypt.hash(new_password, 12);

    await pool.query(
      'UPDATE public.auth_users SET password_hash = $1, reset_code = NULL, reset_expires = NULL WHERE id = $2',
      [newHash, user.id]
    );

    await pool.query(
      'UPDATE public.tqs_users SET password_hash = $1, reset_code = NULL, reset_expires = NULL WHERE id = $2',
      [newHash, user.id]
    ).catch(() => {});

    logAudit(user.id, cleanEmail, clientIp, 'PASSWORD_RESET_SUCCESS', 'AUTH', 'INFO');

    return res.status(200).json({
      ok: true,
      message: 'Tu contraseña ha sido actualizada correctamente. Ya puedes iniciar sesión.'
    });
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'Reset password error');
    return res.status(500).json({ error: 'Error al actualizar la contraseña.' });
  }
});

app.post('/auth/v1/password', authenticateToken, requireAuth, async (req, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }
  const { password } = parsed.data;

  try {
    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE public.auth_users SET password_hash = $1 WHERE id = $2', [hash, req.user.sub]);
    await pool.query('UPDATE public.tqs_users SET primer_login = false, updated_at = NOW() WHERE id = $1', [req.user.sub]);
    logAudit(req.user.sub, req.user.email, req.ip, 'PASSWORD_CHANGE', 'AUTH', 'INFO', { reset_onboarding: true });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/auth/v1/user', authenticateToken, requireAuth, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT id, email, raw_user_meta_data FROM public.auth_users WHERE id = $1', [req.user.sub]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'user not found' });
    
    const user = userRes.rows[0];
    res.status(200).json({
      id: user.id,
      email: user.email,
      user_metadata: user.raw_user_meta_data,
      role: 'authenticated',
    });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.put('/auth/v1/user', authenticateToken, requireAuth, async (req, res) => {
  const { password, data } = req.body;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  try {
    if (password) {
      const parsed = passwordSchema.safeParse({ password });
      if (!parsed.success) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
      const passwordHash = await bcrypt.hash(password, 12);
      await pool.query('UPDATE public.auth_users SET password_hash = $1 WHERE id = $2', [passwordHash, req.user.sub]);
      logAudit(req.user.sub, req.user.email, clientIp, 'PASSWORD_CHANGE', 'AUTH', 'INFO', { timestamp: new Date().toISOString() });
    }
    if (data) {
      await pool.query('UPDATE public.auth_users SET raw_user_meta_data = raw_user_meta_data || $1 WHERE id = $2', [JSON.stringify(data), req.user.sub]);
      if (data.nombre) {
        await pool.query('UPDATE public.tqs_users SET nombre = $1 WHERE id = $2', [data.nombre, req.user.sub]);
      }
      logAudit(req.user.sub, req.user.email, clientIp, 'PROFILE_UPDATE', 'AUTH', 'INFO', { data });
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/auth/v1/logout', authenticateToken, requireAuth, async (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (token && token !== process.env.SB_ANON) {
    await revokeRefreshToken(token, req.user.sub, clientIp).catch(() => {});
  }
  
  logAudit(req.user.sub, req.user.email, clientIp, 'LOGOUT', 'AUTH', 'INFO', { timestamp: new Date().toISOString() });
  res.status(200).json({});
});

app.post('/auth/v1/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  
  if (!refresh_token) {
    return res.status(400).json({ error: 'refresh_token requerido' });
  }
  
  try {
    const decoded = jwt.verify(refresh_token, JWT_SECRET, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
    const userId = decoded.sub;
    
    const valid = await verifyRefreshToken(refresh_token, userId);
    if (!valid) {
      await pool.query(
        `UPDATE public.refresh_tokens SET revoked_at = NOW(), revoked_ip = $1 WHERE user_id = $2 AND token_hash = $3`,
        [clientIp, userId, crypto.createHash('sha256').update(refresh_token).digest('hex')]
      ).catch(() => {});
      return res.status(403).json({ error: 'Refresh token inválido o revocado' });
    }
    
    const profileRes = await pool.query('SELECT email, rol FROM public.auth_users au JOIN public.tqs_users tu ON au.id = tu.id WHERE au.id = $1', [userId]);
    if (profileRes.rows.length === 0) {
      return res.status(403).json({ error: 'Usuario no encontrado' });
    }
    
    const user = profileRes.rows[0];
    if (!user.rol || user.rol === 'authenticated') {
      return res.status(403).json({ error: 'Rol no válido' });
    }
    
    const { token: newRefreshToken, expiresAt } = await rotateRefreshToken(refresh_token, userId, clientIp);
    
    const newAccessToken = jwt.sign(
      { sub: userId, email: user.email, role: user.rol }, 
      JWT_SECRET, 
      { expiresIn: '24h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );
    
    res.status(200).json({
      access_token: newAccessToken,
      token_type: 'bearer',
      expires_in: 86400,
      refresh_token: newRefreshToken,
      refresh_token_expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(403).json({ error: 'Refresh token inválido o expirado' });
    }
    logApp('ERROR', 'AUTH', 'Error en refresh token', err.stack);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

const handleAdminUsers = async (req, res) => {
  const parsed = adminUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten() });
  }
  const { action, id, email, password, nombre, rol, sistemas, siguiendo_tqs, backup_tqs_id, activo } = parsed.data;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const adminId = req.user?.sub;
  const adminEmail = req.user?.email;

  const client = await pool.connect();
  try {
    if (action === 'create') {
      if (!email || !password || !nombre) {
        return res.status(400).json({ error: 'Nombre, email y password son obligatorios' });
      }

      await client.query('BEGIN');
      const passwordHash = await bcrypt.hash(password, 12);
      const userRes = await client.query(
        'INSERT INTO public.auth_users (email, password_hash, raw_user_meta_data) VALUES ($1, $2, $3) RETURNING id',
        [email.toLowerCase(), passwordHash, JSON.stringify({ nombre, rol: rol || 'fte' })]
      );
      const userId = userRes.rows[0].id;

      await client.query(
        'UPDATE public.tqs_users SET nombre = $1, rol = $2, sistemas = $3, siguiendo_tqs = $4, backup_tqs_id = $5, activo = $6, primer_login = false WHERE id = $7',
        [nombre, rol || 'fte', Array.isArray(sistemas) ? sistemas : [], Array.isArray(siguiendo_tqs) ? siguiendo_tqs : [], backup_tqs_id || null, activo !== false, userId]
      );
      await client.query('COMMIT');

      logAudit(adminId, adminEmail, clientIp, 'USER_CREATED', 'USER_ADMIN', 'INFO', { targetUserId: userId, createdEmail: email, nombre, rol });

      return res.status(200).json({ ok: true, id: userId });
    }

    if (action === 'update') {
      if (!id) return res.status(400).json({ error: 'User id is required for update' });

      await client.query('BEGIN');
      if (password && password.trim() !== '') {
        const passwordHash = await bcrypt.hash(password.trim(), 12);
        await client.query('UPDATE public.auth_users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
      }

      if (email) {
        await client.query('UPDATE public.auth_users SET email = $1 WHERE id = $2', [email.toLowerCase(), id]);
      }

      await client.query(
        'UPDATE public.tqs_users SET nombre = COALESCE($1, nombre), email = COALESCE($2, email), rol = COALESCE($3, rol), sistemas = COALESCE($4, sistemas), siguiendo_tqs = COALESCE($5, siguiendo_tqs), backup_tqs_id = $6, activo = COALESCE($7, activo) WHERE id = $8',
        [nombre || null, email ? email.toLowerCase() : null, rol || null, Array.isArray(sistemas) ? sistemas : null, Array.isArray(siguiendo_tqs) ? siguiendo_tqs : null, backup_tqs_id || null, typeof activo === 'boolean' ? activo : null, id]
      );

      await client.query('COMMIT');
      logAudit(adminId, adminEmail, clientIp, 'USER_UPDATED', 'USER_ADMIN', 'INFO', { targetUserId: id, email, nombre, rol, activo });
      return res.status(200).json({ ok: true });
    }

    if (action === 'toggleActivo') {
      if (!id) return res.status(400).json({ error: 'User id is required' });
      await client.query('UPDATE public.tqs_users SET activo = $1 WHERE id = $2', [!!activo, id]);
      logAudit(adminId, adminEmail, clientIp, 'USER_TOGGLED', 'USER_ADMIN', 'WARN', { targetUserId: id, nuevoEstadoActivo: !!activo });
      return res.status(200).json({ ok: true });
    }

if (action === 'delete') {
      if (!id) return res.status(400).json({ error: 'User id is required' });
      if (id === adminId) return res.status(400).json({ error: 'No puede eliminarse a sí mismo' });
      
      // Check if this is the last admin
      const adminCountRes = await client.query(
        `SELECT COUNT(*) FROM public.tqs_users WHERE rol = 'admin' AND activo = true`
      );
      const adminCount = parseInt(adminCountRes.rows[0].count, 10);
      const targetUserRes = await client.query(`SELECT rol FROM public.tqs_users WHERE id = $1`, [id]);
      const targetIsAdmin = targetUserRes.rows[0]?.rol === 'admin';
      
      if (targetIsAdmin && adminCount <= 1) {
        return res.status(400).json({ error: 'No puede eliminar el último administrador activo' });
      }
      
      await client.query('DELETE FROM public.auth_users WHERE id = $1', [id]);
      logAudit(adminId, adminEmail, clientIp, 'USER_DELETED', 'USER_ADMIN', 'CRITICAL', { targetUserId: id });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err: err.message, stack: err.stack }, 'ADMIN-USERS ERROR');
    logApp('ERROR', 'USER_ADMIN', 'Error en administración de usuarios', err.stack);
    return res.status(400).json({ error: err.message || 'Operation failed' });
  } finally {
    client.release();
  }
};

app.post('/functions/v1/admin-users', authenticateToken, requireAuth, handleAdminUsers);
app.post('/api/admin/users', authenticateToken, requireAuth, handleAdminUsers);

function formatValForPg(val, key) {
  if (val === null || val === undefined) return null;
  if (Array.isArray(val)) {
    if (['action_items', 'bitacora', 'raw_user_meta_data'].includes(key)) {
      return JSON.stringify(val);
    }
    return val;
  }
  if (typeof val === 'object') {
    return JSON.stringify(val);
  }
  return val;
}

function parseFilters(query, tableName) {
  const conditions = [];
  const values = [];
  let paramIndex = 1;
  const allowedCols = ALLOWED_COLUMNS[tableName] || [];

  for (const [key, val] of Object.entries(query)) {
    if (['select', 'order', 'limit', 'offset', 'all'].includes(key)) continue;
    if (key !== 'or' && !allowedCols.includes(key)) continue;

    if (key === 'or' && typeof val === 'string') {
      const cleanVal = val.replace(/^\(|\)$/g, '');
      const parts = cleanVal.split(',');
      const subConds = [];
      for (const part of parts) {
        if (part.includes('.eq.')) {
          const [col, v] = part.split('.eq.');
          if (allowedCols.includes(col)) {
            values.push(v);
            subConds.push(`${col} = $${paramIndex++}`);
          }
        } else if (part.includes('.in.')) {
          const idx = part.indexOf('.in.');
          const col = part.substring(0, idx);
          const rawIn = part.substring(idx + 4);
          if (allowedCols.includes(col)) {
            const cleanList = rawIn.replace(/^\(|\)$/g, '').split(',').map(s => s.trim()).filter(Boolean);
            if (cleanList.length > 0) {
              values.push(cleanList);
              subConds.push(`${col} = ANY($${paramIndex++})`);
            }
          }
        } else if (part.includes('.cs.')) {
          const [col, rawArr] = part.split('.cs.');
          if (allowedCols.includes(col)) {
            const cleanArr = rawArr.replace(/^\{|\}$/g, '');
            values.push(cleanArr);
            subConds.push(`$${paramIndex++} = ANY(${col})`);
          }
        }
      }
      if (subConds.length > 0) {
        conditions.push(`(${subConds.join(' OR ')})`);
      }
      continue;
    }

    if (typeof val !== 'string') continue;

    if (val.startsWith('eq.')) {
      const v = val.replace('eq.', '');
      if (v === 'null') {
        conditions.push(`${key} IS NULL`);
      } else {
        conditions.push(`${key} = $${paramIndex++}`);
        values.push(v === 'true' ? true : v === 'false' ? false : v);
      }
    } else if (val.startsWith('neq.')) {
      const v = val.replace('neq.', '');
      if (v === 'null') {
        conditions.push(`${key} IS NOT NULL`);
      } else {
        conditions.push(`${key} != $${paramIndex++}`);
        values.push(v === 'true' ? true : v === 'false' ? false : v);
      }
    } else if (val.startsWith('gte.')) {
      conditions.push(`${key} >= $${paramIndex++}`);
      values.push(val.replace('gte.', ''));
    } else if (val.startsWith('lte.')) {
      conditions.push(`${key} <= $${paramIndex++}`);
      values.push(val.replace('lte.', ''));
    } else if (val.startsWith('gt.')) {
      conditions.push(`${key} > $${paramIndex++}`);
      values.push(val.replace('gt.', ''));
    } else if (val.startsWith('lt.')) {
      conditions.push(`${key} < $${paramIndex++}`);
      values.push(val.replace('lt.', ''));
    } else if (val.startsWith('ilike.')) {
      conditions.push(`${key} ILIKE $${paramIndex++}`);
      values.push(val.replace('ilike.', ''));
    } else if (val.startsWith('in.')) {
      const cleanList = val.replace(/^in\.\(|\)$/g, '');
      const listParts = cleanList.split(',');
      conditions.push(`${key} = ANY($${paramIndex++})`);
      values.push(listParts);
    }
  }

  return {
    whereClause: conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '',
    values,
    paramCount: paramIndex - 1
  };
}

app.get('/rest/v1/:table', authenticateToken, requireAuth, async (req, res) => {
  const { table } = req.params;
  const { select, order, limit } = req.query;

  if (!ALLOWED_TABLES.includes(table)) {
    return res.status(403).json({ error: 'forbidden table' });
  }

  try {
    const { whereClause, values } = parseFilters(req.query, table);
    
    let selectCols = '*';
    if (select && select !== '*') {
      const allowedCols = ALLOWED_COLUMNS[table] || [];
      const requestedCols = select.split(',').map(c => c.trim());
      const validCols = requestedCols.filter(c => c === '*' || allowedCols.includes(c));
      if (validCols.length !== requestedCols.length) {
        return res.status(400).json({ error: 'Invalid column in select' });
      }
      selectCols = validCols.join(', ');
    }

    let orderClause = '';
    if (order) {
      const [col, dir] = order.split('.');
      const allowedCols = ALLOWED_COLUMNS[table] || [];
      if (allowedCols.includes(col) && ['asc', 'desc'].includes(dir.toLowerCase())) {
        orderClause = `ORDER BY ${col} ${dir.toUpperCase()}`;
      }
    }

    let limitClause = '';
    if (limit && /^\d+$/.test(limit)) {
      limitClause = `LIMIT ${Math.min(parseInt(limit), 1000)}`;
    }

    const sql = `SELECT ${selectCols} FROM public.${table} ${whereClause} ${orderClause} ${limitClause}`;
    const result = await pool.query(sql, values);
    res.status(200).json(result.rows);
  } catch (err) {
    logApp('ERROR', 'REST_API', `Error en GET /rest/v1/${table}`, err.stack);
    res.status(400).json({ error: err.message });
  }
});

app.post('/rest/v1/:table', authenticateToken, requireAuth, async (req, res) => {
  const { table } = req.params;
  
  if (!['rfcs', 'solicitudes', 'tqs_users', 'sistemas'].includes(table)) {
    return res.status(403).json({ error: 'forbidden table' });
  }

  const schema = tableSchemas[table];
  if (schema) {
    const rows = Array.isArray(req.body) ? req.body : [req.body];
    for (const row of rows) {
      const parsed = schema.safeParse(row);
      if (!parsed.success) {
        return res.status(400).json({ error: `Validación fallida en ${table}`, details: parsed.error.flatten() });
      }
    }
  }

  const rows = Array.isArray(req.body) ? req.body : [req.body];
  if (rows.length === 0) return res.status(200).json([]);

  try {
    const inserted = [];
    const allowedCols = ALLOWED_COLUMNS[table] || [];
    for (const row of rows) {
      const keys = Object.keys(row).filter(k => allowedCols.includes(k));
      if (keys.length === 0) continue;
      const cols = keys.join(', ');
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const vals = keys.map(k => formatValForPg(row[k], k));

      const sql = `INSERT INTO public.${table} (${cols}) VALUES (${placeholders}) RETURNING *`;
      const result = await pool.query(sql, vals);
      const insertedRow = result.rows[0];
      inserted.push(insertedRow);

      logActivity(
        req.user?.sub,
        req.user?.email,
        table,
        insertedRow.id || insertedRow.ticket || '',
        'CREATE',
        `Nuevo registro creado en ${table} (${insertedRow.ticket || insertedRow.nombre || insertedRow.tipo || 'ID: ' + insertedRow.id})`,
        { registro: insertedRow }
      );
    }
    
    res.status(201).json(Array.isArray(req.body) ? inserted : inserted[0]);
  } catch (err) {
    logApp('ERROR', 'REST_API', `Error en POST /rest/v1/${table}`, err.stack);
    res.status(400).json({ error: err.message });
  }
});

app.patch('/rest/v1/:table', authenticateToken, requireAuth, async (req, res) => {
  const { table } = req.params;

  if (!['rfcs', 'solicitudes', 'tqs_users', 'sistemas'].includes(table)) {
    return res.status(403).json({ error: 'forbidden table' });
  }

  try {
    const { whereClause, values: filterVals, paramCount: filterParamCount } = parseFilters(req.query, table);
    if (!whereClause) {
      return res.status(400).json({ error: 'Filters required for PATCH' });
    }

    const allowedCols = ALLOWED_COLUMNS[table] || [];
    const setClauses = [];
    const updateVals = [];
    let pIdx = 1;

    for (const [key, val] of Object.entries(req.body)) {
      if (key === 'updated_at') continue;
      if (!allowedCols.includes(key)) continue;
      setClauses.push(`${key} = $${pIdx++}`);
      updateVals.push(formatValForPg(val, key));
    }

    if (setClauses.length === 0) return res.status(200).json([]);

    // Adjust filter parameter indices to come after update values
    const finalWhereClause = whereClause.replace(/\$(\d+)/g, (match, num) => {
      return `$${parseInt(num) + updateVals.length}`;
    });

    const sql = `UPDATE public.${table} SET ${setClauses.join(', ')}, updated_at = NOW() ${finalWhereClause} RETURNING *`;
    const result = await pool.query(sql, [...updateVals, ...filterVals]);

    for (const updatedRow of result.rows) {
      const isStatusChange = req.body.status !== undefined || req.body.estatus !== undefined;
      const actType = isStatusChange ? 'STATUS_CHANGE' : 'UPDATE';
      const newStatus = req.body.status || req.body.estatus;
      const summary = isStatusChange 
        ? `Estatus actualizado a '${newStatus}' en ${table} (${updatedRow.ticket || updatedRow.tipo || 'ID: ' + updatedRow.id})`
        : `Actualización de registro en ${table} (${updatedRow.ticket || updatedRow.nombre || updatedRow.tipo || 'ID: ' + updatedRow.id})`;

      logActivity(
        req.user?.sub,
        req.user?.email,
        table,
        updatedRow.id || updatedRow.ticket || '',
        actType,
        summary,
        { cambios: req.body, resultado: updatedRow }
      );
    }
    
    res.status(200).json(result.rows);
  } catch (err) {
    logApp('ERROR', 'REST_API', `Error en PATCH /rest/v1/${table}`, err.stack);
    res.status(400).json({ error: err.message });
  }
});

app.delete('/rest/v1/:table', authenticateToken, requireAuth, async (req, res) => {
  const { table } = req.params;

  if (!ALLOWED_TABLES.includes(table) || !['rfcs', 'solicitudes', 'tqs_users', 'sistemas'].includes(table)) {
    return res.status(403).json({ error: 'forbidden table' });
  }

try {
    if (req.query.all === 'true') {
      if (table === 'rfcs' || table === 'solicitudes' || table === 'tqs_users' || table === 'sistemas') {
        await pool.query(`ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`).catch(() => {});
        await pool.query(`UPDATE public.${table} SET deleted_at = NOW() WHERE deleted_at IS NULL`);
      } else {
        await pool.query(`DELETE FROM public.${table}`);
      }
      logActivity(
        req.user?.sub,
        req.user?.email,
        table,
        'ALL',
        'DELETE',
        `Purga total de la tabla ${table} para Carga Inicial`
      );
      return res.status(204).end();
    }

    const { whereClause, values, paramCount } = parseFilters(req.query, table);
    if (!whereClause) {
      return res.status(400).json({ error: 'Filters required for DELETE' });
    }

    let sql;
    if (table === 'rfcs' || table === 'solicitudes' || table === 'tqs_users') {
      // Ensure deleted_at column exists
      await pool.query(`ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`).catch(() => {});
      sql = `UPDATE public.${table} SET deleted_at = NOW() ${whereClause.replace('WHERE', 'WHERE deleted_at IS NULL AND')} RETURNING *`;
    } else {
      sql = `DELETE FROM public.${table} ${whereClause} RETURNING *`;
    }
    await pool.query(sql, values);

    logActivity(
      req.user?.sub,
      req.user?.email,
      table,
      req.query.id || req.query.ticket || 'FILTRO',
      'DELETE',
      `Eliminación de registro en ${table}`,
      { filtro: req.query }
    );
    
    res.status(204).end();
  } catch (err) {
    logApp('ERROR', 'REST_API', `Error en DELETE /rest/v1/${table}`, err.stack);
    res.status(400).json({ error: err.message });
  }
});

// Endpoint para Carga Inicial / Carga Masiva de RFCs asignadas a TQS Leader
app.post('/api/rfcs/bulk-upload', authenticateToken, requireAuth, async (req, res) => {
  try {
    const { rfcs } = req.body;
    if (!Array.isArray(rfcs) || rfcs.length === 0) {
      return res.status(400).json({ error: 'Se requiere un arreglo "rfcs" no vacío.' });
    }

    // ID de TQS Carlos Andrés Castillo Barajas
    const carlosRes = await pool.query("SELECT id FROM public.tqs_users WHERE email = 'andres.castillo@easconsulting.com.mx' OR nombre ILIKE '%Castillo%' LIMIT 1");
    const carlosId = carlosRes.rows[0]?.id || '00000000-0000-0000-0000-000000000005';
    
    // Propietario destino
    const targetOwnerId = (req.user?.sub && req.user.sub !== '00000000-0000-0000-0000-000000000001') ? req.user.sub : carlosId;

    let processedCount = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const r of rfcs) {
        const ticket = (r.ticket || '').trim() || `RFC-${Date.now()}-${Math.floor(Math.random()*1000)}`;
        const tipo = r.tipo || 'RFC';
        const ambiente = r.ambiente || 'Azure';
        const sid = r.sid || 'PRD';
        const fecha = r.fecha || new Date().toISOString().split('T')[0];
        const fecha_fin = r.fecha_fin || r.fecha;
        const fecha_fin_retorno = r.fecha_fin_retorno || null;
        const hora_inicio = r.hora_inicio || '00:00';
        const hora_fin = r.hora_fin || '23:59';
        const hora_fin_retorno = r.hora_fin_retorno || null;
        const sistema_name = r.sistema_name || r.sistema || 'SAP General';
        const promotor = r.promotor || 'Carga Inicial';
        const coordinador_kof = r.coordinador_kof || null;
        const descripcion = r.descripcion || 'RFC cargado en Carga Inicial';
        const observaciones = r.observaciones || '';
        const status = r.status || 'Finalizado con éxito';
        const owner_id = r.owner_id || targetOwnerId;

        await client.query(`
          INSERT INTO public.rfcs (
            ticket, tipo, ambiente, sid, fecha, fecha_fin, fecha_fin_retorno,
            hora_inicio, hora_fin, hora_fin_retorno, sistema_name, promotor,
            coordinador_kof, descripcion, observaciones, status, owner_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (ticket, sistema_name) DO UPDATE SET
            tipo = EXCLUDED.tipo,
            ambiente = EXCLUDED.ambiente,
            sid = EXCLUDED.sid,
            fecha = EXCLUDED.fecha,
            fecha_fin = EXCLUDED.fecha_fin,
            fecha_fin_retorno = EXCLUDED.fecha_fin_retorno,
            hora_inicio = EXCLUDED.hora_inicio,
            hora_fin = EXCLUDED.hora_fin,
            hora_fin_retorno = EXCLUDED.hora_fin_retorno,
            promotor = EXCLUDED.promotor,
            coordinador_kof = EXCLUDED.coordinador_kof,
            descripcion = EXCLUDED.descripcion,
            observaciones = EXCLUDED.observaciones,
            status = EXCLUDED.status,
            owner_id = EXCLUDED.owner_id,
            deleted_at = NULL,
            updated_at = NOW()
        `, [ticket, tipo, ambiente, sid, fecha, fecha_fin, fecha_fin_retorno, hora_inicio, hora_fin, hora_fin_retorno, sistema_name, promotor, coordinador_kof, descripcion, observaciones, status, owner_id]);
        
        processedCount++;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    logActivity(
      req.user?.sub,
      req.user?.email,
      'rfcs',
      'BULK',
      'CREATE',
      `Carga Inicial Masiva de ${processedCount} RFCs vinculados a TQS Leader`,
      { total: processedCount, targetOwnerId }
    );

    res.status(200).json({ success: true, count: processedCount });
  } catch (err) {
    logApp('ERROR', 'BULK_UPLOAD', 'Error en /api/rfcs/bulk-upload', err.stack);
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
// RUTAS DE INTELIGENCIA ARTIFICIAL (OPENAI & ANTHROPIC CLAUDE)
// ============================================================

app.post('/api/ai/parse-rfc', authenticateToken, requireAuth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Se requiere la propiedad "text" en el cuerpo de la solicitud.' });
    }

    const openAiApiKey = process.env.OPENAI_API_KEY;
    if (!openAiApiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY no está configurada en el servidor.' });
    }

    const systemPrompt = `Eres un asistente especializado en extracción de datos operativos SAP para EAS Consulting.
Tu objetivo es analizar correos de Outlook o solicitudes de texto no estructuradas y extraer los datos requeridos para la base de datos de ATLAS.
Debes responder UNICAMENTE con un objeto JSON válido con la siguiente estructura exacta:
{
  "ticket": "Número o folio del RFC/ticket si existe, o generar 'RFC-' + un número aleatorio de 4 dígitos",
  "tipo": "Uno de: Hotfix, Upgrade, Kernel Patch, Transporte, System Copy, Mantenimiento",
  "ambiente": "Uno de: PRD, QAS, DEV, SANDBOX",
  "fecha": "Fecha de inicio en YYYY-MM-DD",
  "fecha_fin": "Fecha de fin en YYYY-MM-DD",
  "hora_inicio": "Hora inicio en formato HH:MM (ej 22:00)",
  "hora_fin": "Hora fin en formato HH:MM (ej 04:00)",
  "sistema_name": "Nombre exacto del sistema SAP o módulo",
  "sid": "SID del sistema (3 caracteres como PRD, QAS, DEV, ERP, Solman, BTP) si se menciona",
  "promotor": "Nombre de la persona o equipo solicitante",
  "descripcion": "Resumen conciso del cambio o actividad (máx 200 caracteres)",
  "observaciones": "Notas adicionales, riesgos o plan de rollback si se menciona"
}`;

const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analiza y extrae la información del siguiente texto:\n\n${text}` }
        ],
        temperature: 0.1
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!apiRes.ok) {
      const errData = await apiRes.json();
      throw new Error(`OpenAI API error: ${errData.error?.message || apiRes.statusText}`);
    }

    const data = await apiRes.json();
    const parsedObj = JSON.parse(data.choices[0].message.content);
    return res.json({ success: true, data: parsedObj, provider: 'OpenAI (gpt-4o-mini)' });
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'AI_PARSE_RFC_ERROR');
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/chat', authenticateToken, requireAuth, async (req, res) => {
  try {
    let { messages, prompt, provider = 'gemini', model } = req.body;
    
    const userQuery = prompt || (Array.isArray(messages) && messages.length > 0 ? (messages[messages.length - 1].content || messages[messages.length - 1].text) : '') || '';
    if (!userQuery) {
      return res.status(400).json({ error: 'Se requiere un parámetro "prompt" o un arreglo "messages".' });
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      messages = [{ role: 'user', content: String(userQuery) }];
    }

    const qLower = userQuery.toLowerCase().trim();

    let statsRes = { total_rfcs: 0, aprobados: 0, pendientes: 0, fallidos: 0, prd_count: 0, qas_count: 0, dev_count: 0 };
    let solStatsRes = { total_sols: 0, aprobadas: 0, en_proceso: 0, en_espera: 0, cerradas: 0, canceladas: 0 };
    let rfcsList = [];
    let sistemasList = [];
    let solicitudesList = [];
    let usersList = [];
    let topRfcsBySystem = [];
    let topSolsBySystem = [];

    try {
      const statsQuery = await pool.query(`
        SELECT 
          COUNT(*) as total_rfcs,
          COUNT(*) FILTER (WHERE status ILIKE '%aprobado%' OR status ILIKE '%completado%' OR status ILIKE '%éxito%') as aprobados,
          COUNT(*) FILTER (WHERE status ILIKE '%espera%' OR status ILIKE '%pendiente%' OR status ILIKE '%curso%' OR status ILIKE '%vobo%') as pendientes,
          COUNT(*) FILTER (WHERE status ILIKE '%sin éxito%' OR status ILIKE '%rechazado%' OR status ILIKE '%cancelado%') as fallidos,
          COUNT(*) FILTER (WHERE ambiente = 'PRD') as prd_count,
          COUNT(*) FILTER (WHERE ambiente = 'QAS') as qas_count,
          COUNT(*) FILTER (WHERE ambiente = 'DEV') as dev_count
        FROM public.rfcs
      `);
      if (statsQuery.rows[0]) statsRes = statsQuery.rows[0];

      const solStatsQuery = await pool.query(`
        SELECT 
          COUNT(*) as total_sols,
          COUNT(*) FILTER (WHERE estatus ILIKE '%aprobado%') as aprobadas,
          COUNT(*) FILTER (WHERE estatus ILIKE '%proceso%') as en_proceso,
          COUNT(*) FILTER (WHERE estatus ILIKE '%espera%' OR estatus ILIKE '%autoriz%') as en_espera,
          COUNT(*) FILTER (WHERE estatus ILIKE '%cerrad%') as cerradas,
          COUNT(*) FILTER (WHERE estatus ILIKE '%canc%') as canceladas
        FROM public.solicitudes
      `);
      if (solStatsQuery.rows[0]) solStatsRes = solStatsQuery.rows[0];

      const rfcsQuery = await pool.query(`
        SELECT ticket, tipo, ambiente, fecha, fecha_fin, fecha_fin_retorno, sistema_name, promotor, status, descripcion
        FROM public.rfcs ORDER BY created_at DESC LIMIT 50
      `);
      rfcsList = rfcsQuery.rows;

      const sistemasQuery = await pool.query(`
        SELECT 
          s.id, s.nombre, s.infraestructura, s.tipo_sap, s.criticidad, s.owner_id, s.backup_id,
          COALESCE(u1.nombre, 'Sin asignar') as owner_nombre,
          COALESCE(u2.nombre, '—') as backup_nombre
        FROM public.sistemas s
        LEFT JOIN public.tqs_users u1 ON s.owner_id = u1.id
        LEFT JOIN public.tqs_users u2 ON s.backup_id = u2.id
        ORDER BY s.nombre ASC
      `);
      sistemasList = sistemasQuery.rows;

      const solQuery = await pool.query(`
        SELECT ticket, id, tipo, origen, fecha_inicio, sistema_sap, responsable, estatus, descripcion, titulo 
        FROM public.solicitudes ORDER BY created_at DESC LIMIT 50
      `);
      solicitudesList = solQuery.rows;

      const usersQuery = await pool.query('SELECT id, nombre, email, rol, sistemas FROM public.tqs_users WHERE activo = true ORDER BY nombre ASC');
      usersList = usersQuery.rows;

      const rfcRankQuery = await pool.query(`
        SELECT sistema_name, COUNT(*) as rfc_count 
        FROM public.rfcs 
        WHERE sistema_name IS NOT NULL AND sistema_name != ''
        GROUP BY sistema_name 
        ORDER BY rfc_count DESC 
        LIMIT 10
      `);
      topRfcsBySystem = rfcRankQuery.rows;

      const solRankQuery = await pool.query(`
        SELECT COALESCE(sistema_sap, 'General') as sistema_name, COUNT(*) as sol_count 
        FROM public.solicitudes 
        WHERE COALESCE(sistema_sap, '') != ''
        GROUP BY COALESCE(sistema_sap, 'General') 
        ORDER BY sol_count DESC 
        LIMIT 10
      `);
      topSolsBySystem = solRankQuery.rows;
    } catch(eCtx) {
      logger.error({ err: eCtx.message, stack: eCtx.stack }, 'AI_CONTEXT_QUERY_ERROR');
    }

    let learnedKbText = '';
    try {
      const kbRes = await pool.query(`
        SELECT pregunta, respuesta FROM public.ai_knowledge_base 
        WHERE activo = true 
        ORDER BY votos_positivos DESC, created_at DESC 
        LIMIT 15
      `);
      if (kbRes.rows.length > 0) {
        learnedKbText = `\n\nCONOCIMIENTO Y REGLAS DE NEGOCIO APRENDIDAS AUTÓNOMAMENTE DE RETROALIMENTACIÓN:\n` +
          kbRes.rows.map(r => `• Tema: ${r.pregunta}\n  Respuesta Validada: ${r.respuesta}`).join('\n');
      }
    } catch (eKb) {}

    const systemInstruction = `Eres "Atlas IA Copilot", el asistente virtual agéntico especializado en Operaciones, Gobernanza e Infraestructura SAP de ATLAS (EAS Consulting).

CONTEXTO DEL USUARIO EN SESIÓN:
• Usuario Activo: ${req.user ? req.user.nombre : 'Usuario General'} (${req.user ? req.user.email : ''})
• Rol en Plataforma: ${req.user ? req.user.rol : 'tqs_leader'}

ESTILO Y TONO DE COMUNICACIÓN:
• Comunicación natural, humana, empática, clara y ejecutiva (evita lenguaje acartonado, frío o robótico).
• Dirígete al usuario de manera cercana pero profesional, demostrando dominio operativo experto en SAP.
• Proporciona respuestas bien estructuradas con formato Markdown limpio, encabezados claros (##), listas con viñetas (•) y tablas cuando sea conveniente.
• Si el usuario solicita datos numéricos o métricas, entrega cifras exactas respaldadas por la telemetría en tiempo real.
• Ofrece recomendaciones prácticas u orientaciones útiles ("Tips de Operación") para facilitar las tareas del equipo.

CAPACIDADES AGÉNTICAS Y ACCIONES DIRECTAS EN LA INTERFAZ:
Puedes ejecutar acciones directas en la pantalla del usuario incluyendo los siguientes comandos especiales al final de tu respuesta:
• Navegación a módulos: [[ACTION:NAVIGATE|<page_id>|<texto_botón>]]
  (Páginas válidas: sheet [Tablero RFCs], solicitudes, alertas, vobo, usuarios, sistemas, auditoria, nuevo [Nuevo RFC], nueva-solicitud [Nueva Solicitud])
• Apertura de Modales: [[ACTION:MODAL|<modal_id>|<texto_botón>]]
  (Modales válidos: new-rfc [Crear RFC], new-solicitude [Crear Solicitud], new-user [Nuevo Usuario], new-sistema [Nuevo Sistema])
• Filtrado de Datos: [[ACTION:FILTER|<valor_filtro>|<texto_botón>]]
  (Ejemplos: [[ACTION:FILTER|PRD|Ver Cambios PRD]], [[ACTION:FILTER|Incidente|Ver Incidentes]])

REGLA AGÉNTICA: Cuando el usuario exprese la intención de consultar, crear o filtrar registros, adjunta SIEMPRE los botones de acción agéntica [[ACTION:...]] correspondientes para permitir la ejecución en un solo clic.

TELEMETRÍA Y DATOS EN TIEMPO REAL:
• RFCs Totales: ${statsRes.total_rfcs} (Exitosos: ${statsRes.aprobados}, En Espera/VOBO: ${statsRes.pendientes}, Fallidos: ${statsRes.fallidos})
• Distribución por Ambiente: Producción PRD (${statsRes.prd_count}), Calidad QAS (${statsRes.qas_count}), Desarrollo DEV (${statsRes.dev_count})
• Solicitudes Operativas: ${solStatsRes.total_sols} (Aprobadas: ${solStatsRes.aprobadas}, En Proceso: ${solStatsRes.en_proceso}, En Espera: ${solStatsRes.en_espera}, Cerradas: ${solStatsRes.cerradas})
• Catálogo de Sistemas (${sistemasList.length}): ${sistemasList.map(s => `${s.nombre} [${s.tipo_sap}]`).join(', ')}
• Equipo Responsable TQS (${usersList.length} especialistas): ${usersList.map(u => `${u.nombre} (${u.rol})`).join(', ')}

RANKING REAL DE SISTEMAS CON MÁS RFCS:
${topRfcsBySystem.length > 0 ? topRfcsBySystem.map((r, i) => `${i+1}. ${r.sistema_name}: ${r.rfc_count} RFCs`).join('\n') : 'Sin registros'}

RANKING REAL DE SISTEMAS CON MÁS SOLICITUDES:
${topSolsBySystem.length > 0 ? topSolsBySystem.map((s, i) => `${i+1}. ${s.sistema_name}: ${s.sol_count} Solicitudes`).join('\n') : 'Sin registros'}

ÚLTIMAS SOLICITUDES EN SISTEMA:
${JSON.stringify(solicitudesList.slice(0, 10), null, 2)}

ÚLTIMOS RFCS REGISTRADOS:
${JSON.stringify(rfcsList.slice(0, 10), null, 2)}${learnedKbText}`;

    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || process.env.GOOGLE_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const openAiApiKey = process.env.OPENAI_API_KEY;

    if (provider === 'gemini' && geminiApiKey) {
      try {
        const selectedModel = model || 'gemini-1.5-flash';
        const geminiContents = messages.map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content || m.text || '' }]
        }));

const geminiController = new AbortController();
        const geminiTimeoutId = setTimeout(() => geminiController.abort(), 30000);
        let geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${geminiApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: geminiContents
          }),
          signal: geminiController.signal
        });
        clearTimeout(geminiTimeoutId);

        if (geminiRes.ok) {
          const gemData = await geminiRes.json();
          const textReply = gemData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (textReply) return res.json({ reply: textReply, provider: `Google Gemini (${selectedModel})` });
        }
      } catch (eGem) {
        console.warn('[AI_GEMINI_FALLBACK]', eGem.message);
      }
    } else if (provider === 'anthropic' && anthropicApiKey) {
      try {
        const selectedModel = model || 'claude-3-5-sonnet-20241022';
const anthropicController = new AbortController();
        const anthropicTimeoutId = setTimeout(() => anthropicController.abort(), 30000);
        const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicApiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: selectedModel,
            max_tokens: 2000,
            system: systemInstruction,
            messages: messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content || '' }))
          }),
          signal: anthropicController.signal
        });
        clearTimeout(anthropicTimeoutId);
        if (anthropicRes.ok) {
          const antData = await anthropicRes.json();
          const textReply = antData.content?.[0]?.text;
          if (textReply) return res.json({ reply: textReply, provider: `Anthropic Claude (${selectedModel})` });
        }
      } catch (eAnt) {
        console.warn('[AI_ANTHROPIC_FALLBACK]', eAnt.message);
      }
} else if (provider === 'openai' && openAiApiKey) {
      try {
        const selectedModel = model || 'gpt-4o-mini';
        const openAiController = new AbortController();
        const openAiTimeoutId = setTimeout(() => openAiController.abort(), 30000);
        const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAiApiKey}` },
          body: JSON.stringify({
            model: selectedModel,
            messages: [{ role: 'system', content: systemInstruction }, ...messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content || '' }))],
            temperature: 0.3
          }),
          signal: openAiController.signal
        });
        clearTimeout(openAiTimeoutId);
        if (openAiRes.ok) {
          const oaiData = await openAiRes.json();
          const textReply = oaiData.choices?.[0]?.message?.content;
          if (textReply) return res.json({ reply: textReply, provider: `OpenAI (${selectedModel})` });
        }
      } catch (eOai) {
        console.warn('[AI_OPENAI_FALLBACK]', eOai.message);
      }
    }

    let replyText = '';

    const ticketMatch = userQuery.match(/(?:RFC|SOL|INC|REQ|KIT|RCA|CHG|TICKET)[\w\-]+/i);
    if (ticketMatch) {
      const searchCode = ticketMatch[0].toUpperCase();
      const rfcFound = rfcsList.find(r => (r.ticket || '').toUpperCase().includes(searchCode));
      const solFound = solicitudesList.find(s => (s.ticket || s.id || '').toString().toUpperCase().includes(searchCode));

      if (rfcFound) {
        replyText = `🤖 **Atlas IA Copilot — Ficha de Ticket RFC**\n\n` +
          `### 📄 Ticket RFC: \`${rfcFound.ticket}\`\n` +
          `• **Tipo de Cambio:** ${rfcFound.tipo || 'N/A'}\n` +
          `• **Ambiente:** \`${rfcFound.ambiente || 'PRD'}\`\n` +
          `• **Sistema Afectado:** **${rfcFound.sistema_name || 'SAP General'}**\n` +
          `• **Estatus Actual:** \`${rfcFound.status}\`\n` +
          `• **Promotor / TQS Leader:** ${rfcFound.promotor || 'Sin asignar'}\n` +
          `• **Fecha Inicio:** ${rfcFound.fecha || 'N/A'} | **Retorno:** ${rfcFound.fecha_fin_retorno || 'N/A'}\n` +
          `• **Descripción:** ${rfcFound.descripcion || 'Sin descripción adicional'}`;
      } else if (solFound) {
        replyText = `🤖 **Atlas IA Copilot — Ficha de Solicitud Operativa**\n\n` +
          `### 📋 Solicitud: \`${solFound.ticket || solFound.id}\`\n` +
          `• **Tipo de Solicitud:** **${solFound.tipo}**\n` +
          `• **Origen:** ${solFound.origen || 'DXC'}\n` +
          `• **Sistema SAP:** ${solFound.sistema_sap || solFound.sistema || 'General'}\n` +
          `• **Estatus Actual:** \`${solFound.estatus || solFound.estado || 'En proceso'}\`\n` +
          `• **Responsable Asignado:** ${solFound.responsable || 'No asignado'}\n` +
          `• **Fecha Registro:** ${solFound.fecha_inicio || 'N/A'}\n` +
          `• **Detalle:** ${solFound.descripcion || solFound.titulo || 'Sin descripción'}`;
      }
    }

    // Handler: "¿Qué sistema tiene más RFCs?", "sistemas con más cambios", "que sistema tiene mas", etc.
    if (!replyText && (qLower.includes('mas rfc') || qLower.includes('más rfc') || qLower.includes('mayor rfc') || qLower.includes('que sistema tiene mas') || qLower.includes('cuál sistema tiene más') || qLower.includes('cual sistema tiene mas') || (qLower.includes('sistema') && (qLower.includes('mas') || qLower.includes('más')) && (qLower.includes('rfc') || qLower.includes('cambio'))))) {
      const topSys = topRfcsBySystem.length > 0 ? topRfcsBySystem[0] : null;

      replyText = `🤖 **Atlas IA Copilot — Ranking de Sistemas por Volumen de RFCs**\n\n` +
        `El sistema con mayor concentración de cambios (RFCs) en la plataforma ATLAS es **${topSys ? topSys.sistema_name : 'SAP General'}** con un total de **${topSys ? topSys.rfc_count : 0} RFCs** registrados.\n\n` +
        `### 🏆 Top Sistemas con Mayor Número de RFCs:\n\n` +
        (topRfcsBySystem.length > 0 
          ? topRfcsBySystem.slice(0, 6).map((r, idx) => {
              const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : '•'));
              const sMatch = sistemasList.find(s => s.nombre.toLowerCase().includes(r.sistema_name.toLowerCase()));
              const ownerStr = sMatch && sMatch.owner_nombre ? ` | *Titular TQS:* ${sMatch.owner_nombre}` : '';
              return `${medal} **${r.sistema_name}** — **${r.rfc_count} RFCs**${ownerStr}`;
            }).join('\n')
          : '• No se encontraron registros de RFCs asociados a sistemas.') +
        `\n\n💡 **Tip de Operación:** Puedes explorar todos los RFCs de la plataforma o filtrar por ambiente en el tablero interactivo.`;

      replyText += `\n\n[[ACTION:NAVIGATE|sheet|📄 Ver RFCs en Tablero]] [[ACTION:NAVIGATE|sistemas|🖥️ Ver Catálogo de Sistemas]]`;
    }

    // Handler: "¿Qué sistema tiene más solicitudes?", "sistemas con más solicitudes"
    if (!replyText && (qLower.includes('mas solicitud') || qLower.includes('más solicitud') || qLower.includes('mayor solicitud') || (qLower.includes('sistema') && (qLower.includes('mas') || qLower.includes('más')) && (qLower.includes('solicitud') || qLower.includes('incidente') || qLower.includes('ticket'))))) {
      const topSys = topSolsBySystem.length > 0 ? topSolsBySystem[0] : null;

      replyText = `🤖 **Atlas IA Copilot — Ranking de Solicitudes por Sistema**\n\n` +
        `El sistema con mayor acumulado de solicitudes en ATLAS es **${topSys ? topSys.sistema_name : 'General'}** con un total de **${topSys ? topSys.sol_count : 0} solicitudes** registradas.\n\n` +
        `### 📋 Top Sistemas con Mayor Número de Solicitudes:\n\n` +
        (topSolsBySystem.length > 0
          ? topSolsBySystem.slice(0, 6).map((s, idx) => {
              const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : '•'));
              return `${medal} **${s.sistema_name}** — **${s.sol_count} Solicitudes**`;
            }).join('\n')
          : '• No se encontraron registros de solicitudes asociadas a sistemas.') +
        `\n\n💡 **Tip de Operación:** Puedes revisar las solicitudes en proceso o crear un nuevo ticket desde el panel operativo.`;

      replyText += `\n\n[[ACTION:NAVIGATE|solicitudes|📋 Ir a Solicitudes Operativas]] [[ACTION:MODAL|new-solicitude|➕ Crear Solicitud]]`;
    }

    if (!replyText && (qLower.includes('kit') || qLower.includes('incidente') || qLower.includes('ticket') || qLower.includes('rca') || qLower.includes('requerimiento') || qLower.includes('actividad'))) {
      let targetType = '';
      if (qLower.includes('kit')) targetType = 'KIT';
      else if (qLower.includes('incidente') || qLower.includes('ticket')) targetType = 'Incidente';
      else if (qLower.includes('rca')) targetType = 'RCA';
      else if (qLower.includes('actividad')) targetType = 'Actividad';
      else if (qLower.includes('requerimiento')) targetType = 'Requerimiento';

      const matchingSols = solicitudesList.filter(s => (s.tipo || '').toLowerCase().includes(targetType.toLowerCase()));
      replyText = `🤖 **Atlas IA Copilot — Razonamiento sobre Solicitudes (${targetType})**\n\n` +
        `Se encontraron **${matchingSols.length} solicitudes** de tipo **${targetType}** registradas:\n\n` +
        (matchingSols.length > 0 
          ? matchingSols.slice(0, 8).map(s => `• **${s.ticket || s.id}** [${s.sistema_sap || 'SAP'}]: \`${s.estatus || 'En proceso'}\` — ${s.descripcion ? s.descripcion.slice(0, 60) + '...' : 'Sin detalle'}`).join('\n')
          : `• No se registraron solicitudes activas para la categoría ${targetType} en el periodo actual.`) +
        `\n\n*Total global de solicitudes:* ${solStatsRes.total_sols} (${solStatsRes.aprobadas} Aprobadas, ${solStatsRes.en_proceso} En proceso, ${solStatsRes.en_espera} En espera).`;
    }

    if (!replyText) {
      const matchedSys = sistemasList.find(s => qLower.includes(s.nombre.toLowerCase()));
      if (matchedSys) {
        const sysRfcs = rfcsList.filter(r => (r.sistema_name || r.sistema || '').toLowerCase().includes(matchedSys.nombre.toLowerCase()));
        const sysSols = solicitudesList.filter(s => (s.sistema_sap || s.sistema || '').toLowerCase().includes(matchedSys.nombre.toLowerCase()));

        replyText = `🤖 **Atlas IA Copilot — Análisis de Sistema "${matchedSys.nombre}"**\n\n` +
          `• **Categoría:** ${matchedSys.tipo_sap} | **Infraestructura:** ${matchedSys.infraestructura}\n` +
          `• **Nivel de Criticidad:** Nivel ${matchedSys.criticidad || '1'}\n` +
          `• **Titular (Owner):** ${matchedSys.owner_nombre || 'No asignado'}\n` +
          `• **TQS Backup:** ${matchedSys.backup_nombre || 'No asignado'}\n\n` +
          `**Actividad Acumulada en "${matchedSys.nombre}":**\n` +
          `• **RFCs Registrados:** ${sysRfcs.length} cambio(s)\n` +
          `• **Solicitudes Registradas:** ${sysSols.length} solicitud(es)\n\n` +
          (sysRfcs.length > 0 ? `*Último RFC:* \`${sysRfcs[0].ticket}\` (${sysRfcs[0].status}) - ${sysRfcs[0].descripcion || ''}\n` : '') +
          (sysSols.length > 0 ? `*Última Solicitud:* \`${sysSols[0].ticket || sysSols[0].id}\` (${sysSols[0].estatus || ''}) - ${sysSols[0].descripcion || ''}` : '');
      }
    }

    if (!replyText && (qLower.includes('responsable') || qLower.includes('tqs') || qLower.includes('leader') || qLower.includes('quien') || qLower.includes('encargado'))) {
      const matchedUser = usersList.find(u => qLower.includes(u.nombre.toLowerCase()) || (u.email && qLower.includes(u.email.toLowerCase())));
      if (matchedUser) {
        const userSistemas = Array.isArray(matchedUser.sistemas) ? matchedUser.sistemas : [];
        replyText = `🤖 **Atlas IA Copilot — Perfil del TQS Leader**\n\n` +
          `• **Nombre:** **${matchedUser.nombre}**\n` +
          `• **Rol en Portal:** \`${matchedUser.rol}\`\n` +
          `• **Correo:** \`${matchedUser.email}\`\n` +
          `• **Sistemas Asignados (${userSistemas.length}):** ${userSistemas.length > 0 ? userSistemas.join(', ') : 'Ninguno asignado aún'}`;
      } else {
        replyText = `🤖 **Atlas IA Copilot — Equipo de Líderes TQS**\n\n` +
          `Hay **${usersList.length} usuarios activos** registrados en la plataforma ATLAS:\n\n` +
          usersList.slice(0, 8).map(u => `• **${u.nombre}** (\`${u.rol}\`) — Sistemas: ${Array.isArray(u.sistemas) ? u.sistemas.length : 0}`).join('\n') +
          `\n\n*Nota:* Puedes consultar el responsable de cualquier sistema escribiendo el nombre del sistema (ej: "Quién ve SAP SLT").`;
      }
    }

    if (!replyText && (qLower.includes('resumen') || qLower.includes('reporte') || qLower.includes('total') || qLower.includes('metrica') || qLower.includes('estadistica') || qLower.includes('cuanto'))) {
      replyText = `🤖 **Atlas IA Copilot — Reporte Ejecutivo Consolidado**\n\n` +
        `### 📊 Estado General de Operaciones ATLAS\n\n` +
        `| Métrica Operativa | RFCs de Cambio | Solicitudes Operativas |\n` +
        `| :--- | :---: | :---: |\n` +
        `| **Registros Totales** | **${statsRes.total_rfcs}** | **${solStatsRes.total_sols}** |\n` +
        `| **Aprobados / Exitosos** | ${statsRes.aprobados} | ${solStatsRes.aprobadas} |\n` +
        `| **En Proceso / Pendientes** | ${statsRes.pendientes} | ${solStatsRes.en_proceso} |\n` +
        `| **En Espera Autorización** | — | ${solStatsRes.en_espera} |\n` +
        `| **Fallidos / Cancelados** | ${statsRes.fallidos} | ${solStatsRes.canceladas} |\n\n` +
        `• **Ambientes RFCs:** PRD (${statsRes.prd_count}) · QAS (${statsRes.qas_count}) · DEV (${statsRes.dev_count})\n` +
        `• **Sistemas Activos Monitoreados:** ${sistemasList.length} sistemas (SAP y No SAP)`;
    }

    if (!replyText) {
      replyText = `🤖 **Atlas IA Copilot — Motor de Razonamiento Autónomo**\n\n` +
        `He analizado tu consulta: *"_${userQuery}_"*\n\n` +
        `**Estado de la plataforma ATLAS:**\n` +
        `• **RFCs Operativos:** ${statsRes.total_rfcs} registrados (${statsRes.aprobados} exitosos, ${statsRes.pendientes} pendientes, ${statsRes.prd_count} en PRD).\n` +
        `• **Solicitudes Operativas:** ${solStatsRes.total_sols} acumuladas (${solStatsRes.en_proceso} en proceso, ${solStatsRes.aprobadas} aprobadas).\n` +
        `• **Sistemas Administrados:** ${sistemasList.length} sistemas vinculados.\n\n` +
        `**Sugerencias de Consulta:**\n` +
        `1. *"Muestra las solicitudes tipo Incidente"* o *"KITs registrados"*\n` +
        `2. *"Quién es el responsable de [Nombre de Sistema]"*\n` +
        `3. *"Estado del ticket [RFC-123 o INC-456]"*\n` +
        `4. *"Resumen ejecutivo de operaciones"*`;
    }

            if (qLower.includes('solicitud') || qLower.includes('ticket') || qLower.includes('incidente') || qLower.includes('kit') || qLower.includes('rca')) {
      replyText += '\n\n[[ACTION:NAVIGATE|solicitudes|Ir a Solicitudes Operativas]] [[ACTION:MODAL|new-solicitude|Crear Solicitud]]';
    } else if (qLower.includes('rfc') || qLower.includes('cambio') || qLower.includes('prd') || qLower.includes('vobo')) {
      replyText += '\n\n[[ACTION:NAVIGATE|sheet|Ver RFCs en Tablero]] [[ACTION:MODAL|new-rfc|Crear RFC]]';
    } else {
      replyText += '\n\n[[ACTION:NAVIGATE|sheet|Ver RFCs]] [[ACTION:NAVIGATE|solicitudes|Ver Solicitudes]]';
    }
    return res.json({ reply: replyText, provider: 'Atlas IA Copilot (Generative Reasoning Engine)' });
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'AI_CHAT_ERROR');
    return res.status(500).json({ error: 'Error procesando consulta en ATLAS Copilot: ' + err.message });
  }
});

app.post('/api/ai/executive-report', authenticateToken, requireAuth, requireRole('admin', 'director'), async (req, res) => {
  try {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY no está configurada.' });
    }

    const statsRes = await pool.query(`
      SELECT 
        COUNT(*) as total_rfcs,
        COUNT(*) FILTER (WHERE status = 'Aprobado' OR status = 'Completado') as aprobados,
        COUNT(*) FILTER (WHERE status = 'En espera de VOBO' OR status = 'Pendiente') as pendientes,
        COUNT(*) FILTER (WHERE ambiente = 'PRD') as prd_count,
        COUNT(*) FILTER (WHERE ambiente = 'QAS') as qas_count,
        COUNT(*) FILTER (WHERE ambiente = 'DEV') as dev_count
      FROM public.rfcs
    `);

    const rfcsList = await pool.query(`
      SELECT ticket, tipo, ambiente, fecha, fecha_fin, sistema_name, promotor, status, descripcion
      FROM public.rfcs ORDER BY fecha DESC LIMIT 30
    `);

    const sistemasRes = await pool.query('SELECT nombre, infraestructura, tipo_sap, criticidad FROM public.sistemas');

    const promptText = `Por favor, actúa como un Consultor Senior en Operaciones SAP de EAS Consulting.
Genera un **Reporte Ejecutivo Operativo de SAP** altamente estructurado y profesional para la Dirección.

DATOS OPERATIVOS ACTUALES DE ATLAS:
- Total RFCs Registrados: ${statsRes.rows[0]?.total_rfcs || 0}
- RFCs Aprobados/Completados: ${statsRes.rows[0]?.aprobados || 0}
- RFCs Pendientes / VOBO: ${statsRes.rows[0]?.pendientes || 0}
- Distribución por Ambiente: PRD (${statsRes.rows[0]?.prd_count || 0}), QAS (${statsRes.rows[0]?.qas_count || 0}), DEV (${statsRes.rows[0]?.dev_count || 0})
- Sistemas SAP Activos (${sistemasRes.rows.length}): ${sistemasRes.rows.map(s => s.nombre).join(', ')}

LISTA DE ULTIMOS RFCs:
${JSON.stringify(rfcsList.rows, null, 2)}

Estructura el reporte con las siguientes secciones en Markdown:
1. 📈 **Resumen Ejecutivo y Salud Operativa**
2. 🚨 **Análisis de Riesgos y Ventanas en Sistemas Críticos (PRD)**
3. 📋 **Desglose de RFCs Relevantes y Estado de Aprobaciones**
4. 💡 **Recomendaciones Operativas para la Próxima Semana**

Utiliza emojis apropiados, tablas en Markdown y un tono profesional ejecutivo.`;

const reportController = new AbortController();
    const reportTimeoutId = setTimeout(() => reportController.abort(), 60000);
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2500,
        messages: [{ role: 'user', content: promptText }]
      }),
      signal: reportController.signal
    });
    clearTimeout(reportTimeoutId);

    if (!anthropicRes.ok) {
      const errData = await anthropicRes.json();
      throw new Error(`Anthropic API error: ${errData.error?.message || anthropicRes.statusText}`);
    }

    const antData = await anthropicRes.json();
    const reportText = antData.content?.[0]?.text || '';
    return res.json({ report: reportText, provider: 'Anthropic Claude 3.5 Sonnet', generatedAt: new Date().toISOString() });
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'AI_REPORT_ERROR');
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// MOTOR HEURÍSTICO OPERATIVO (Evaluación de Riesgo & Replicación n8n)
// ============================================================
function calculateRfcHeuristicRisk(rfc, dbSystemsMap = {}, existingRfcsList = []) {
  let score = 0;
  const factors = [];
  let hasOverlap = false;

  const sysName = (rfc.sistema_name || rfc.sistema_grupo || rfc.sistema || rfc.sid || '').trim();
  const ambiente = (rfc.ambiente || '').trim();
  const sid = (rfc.sid || '').trim();
  const fecha = rfc.fecha || rfc.fecha_inicio || '';

  // 1. Criticidad del Sistema
  const sysObj = dbSystemsMap[sysName.toUpperCase()] || dbSystemsMap[sysName.toLowerCase()];
  const criticidad = sysObj ? parseInt(sysObj.criticidad, 10) : 1;

  if (criticidad === 3) {
    score += 35;
    factors.push('Sistema Nivel 3 (Muy Crítico): +35 pts');
  } else if (criticidad === 2) {
    score += 20;
    factors.push('Sistema Nivel 2 (Criticidad Media): +20 pts');
  } else {
    score += 5;
    factors.push('Sistema Nivel 1 (Baja Criticidad): +5 pts');
  }

  // 2. Ambiente
  if (ambiente === 'PRD' || (sid && sid.includes('PRD'))) {
    score += 30;
    factors.push('Ambiente de Producción (PRD): +30 pts');
  } else if (ambiente === 'QAS' || (sid && sid.includes('QAS'))) {
    score += 15;
    factors.push('Ambiente de Calidad (QAS): +15 pts');
  } else {
    score += 5;
    factors.push('Ambiente Desarrollo / Sandbox: +5 pts');
  }

  // 3. Traslape de Ventanas de Mantenimiento en el mismo Sistema / SID / Fecha
  if (fecha && sysName) {
    const overlapping = existingRfcsList.filter(r => {
      const matchSys = (r.sistema_name || r.sistema || '').toUpperCase() === sysName.toUpperCase();
      const matchFecha = (r.fecha || r.fecha_inicio) === fecha;
      const notSelf = r.id !== rfc.id && r.ticket !== rfc.ticket;
      return matchSys && matchFecha && notSelf;
    });

    if (overlapping.length > 0) {
      hasOverlap = true;
      score += 25;
      factors.push(`Traslape con ${overlapping.length} RFC(s) programado(s) en la misma fecha y sistema: +25 pts`);
    }
  }

  let level = 'Bajo';
  if (score >= 70) level = 'Crítico';
  else if (score >= 45) level = 'Alto';
  else if (score >= 25) level = 'Medio';

  return {
    riskScore: Math.min(score, 100),
    riskLevel: level,
    riskFactors: factors,
    hasOverlap,
  };
}

app.post('/api/heuristics/evaluate-rfc', authenticateToken, requireAuth, async (req, res) => {
  try {
    const { rfc, existingRfcs } = req.body;
    if (!rfc) {
      return res.status(400).json({ error: 'La propiedad rfc es requerida.' });
    }

    const sistemasRes = await pool.query('SELECT nombre, criticidad, infraestructura, tipo_sap FROM public.sistemas');
    const dbSystemsMap = {};
    sistemasRes.rows.forEach(s => {
      if (s.nombre) dbSystemsMap[s.nombre.toUpperCase()] = s;
    });

    let rfcsList = existingRfcs;
    if (!Array.isArray(rfcsList)) {
      const rfcsRes = await pool.query('SELECT id, ticket, fecha, sistema_name, ambiente, sid FROM public.rfcs WHERE deleted_at IS NULL');
      rfcsList = rfcsRes.rows;
    }

    const evaluation = calculateRfcHeuristicRisk(rfc, dbSystemsMap, rfcsList);
    return res.json({ ok: true, evaluation });
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'HEURISTIC_EVAL_ERROR');
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/heuristics/recommend-tqs', authenticateToken, requireAuth, async (req, res) => {
  try {
    const tqsRes = await pool.query("SELECT id, nombre, rol, sistemas FROM public.tqs_users WHERE activo = true AND rol IN ('admin', 'tqs_leader')");
    const sistemasRes = await pool.query("SELECT id, nombre, owner_id, criticidad FROM public.sistemas");
    const rfcsRes = await pool.query("SELECT owner_id, COUNT(*) as count FROM public.rfcs WHERE status != 'Finalizado con éxito' GROUP BY owner_id");

    const rfcsMap = {};
    rfcsRes.rows.forEach(r => { rfcsMap[r.owner_id] = parseInt(r.count, 10); });

    const sysCountMap = {};
    sistemasRes.rows.forEach(s => {
      if (s.owner_id) {
        sysCountMap[s.owner_id] = (sysCountMap[s.owner_id] || 0) + (parseInt(s.criticidad, 10) || 1);
      }
    });

    const recommendations = tqsRes.rows.map(u => {
      const activeRfcs = rfcsMap[u.id] || 0;
      const sysLoad = sysCountMap[u.id] || 0;
      const workloadScore = (activeRfcs * 2) + sysLoad;
      return {
        id: u.id,
        nombre: u.nombre,
        rol: u.rol,
        sistemasCount: (u.sistemas || []).length,
        activeRfcs,
        sysLoad,
        workloadScore,
      };
    }).sort((a, b) => a.workloadScore - b.workloadScore);

    return res.json({ ok: true, recommendations });
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'HEURISTIC_TQS_ERROR');
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/rfcs/bulk-upload', authenticateToken, requireAuth, requireRole('admin', 'tqs_leader'), async (req, res) => {
  const { rfcs } = req.body;
  if (!Array.isArray(rfcs) || rfcs.length === 0) {
    return res.status(400).json({ error: 'La propiedad rfcs debe ser un arreglo no vacío.' });
  }

  const normalizeRfcStatus = (rawStatus) => {
    if (!rawStatus) return 'Finalizado con éxito';
    const str = String(rawStatus).trim();
    if (!str) return 'Finalizado con éxito';
    const norm = str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    if (norm.includes('sin exito') || norm.includes('fall') || norm.includes('error') || norm.includes('fracas') || norm.includes('no exit')) {
      return 'Finalizado sin éxito';
    }
    if (norm.includes('exito') || norm.includes('concluid') || norm.includes('finalizad') || norm.includes('completad') || norm.includes('cerrad') || norm.includes('ok') || norm.includes('realizad') || norm.includes('terminad')) {
      return 'Finalizado con éxito';
    }
    if (norm.includes('ejecuc') || norm.includes('proceso') || norm.includes('curs') || norm.includes('ejecutando')) {
      return 'En Ejecución';
    }
    if (norm.includes('vobo') || norm.includes('espera') || norm.includes('pendien')) {
      return 'En espera de VOBO';
    }
    if (norm.includes('aprob')) {
      return 'Aprobado';
    }
    if (norm.includes('cancel')) {
      return 'Cancelado';
    }
    if (norm.includes('reprogram')) {
      return 'Reprogramar';
    }

    const allowed = ['En espera de VOBO', 'En Ejecución', 'Finalizado con éxito', 'Finalizado sin éxito', 'Aprobado', 'Cancelado', 'Reprogramar'];
    const exact = allowed.find(a => a.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === norm);
    if (exact) return exact;

    return 'Finalizado con éxito';
  };

  const cleanDate = (d) => {
    if (!d) return null;
    const s = String(d).trim();
    if (!s || s === '-' || s === 'null' || s === 'undefined') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const parsed = new Date(s);
    if (isNaN(parsed.getTime())) return null;
    return parsed.toISOString().split('T')[0];
  };

  const cleanTime = (t) => {
    if (!t) return null;
    const s = String(t).trim();
    if (!s || s === '-' || s === 'null' || s === 'undefined') return null;
    return s;
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const ownerRes = await client.query("SELECT id FROM public.tqs_users WHERE rol = 'admin' LIMIT 1");
    const defaultOwnerId = ownerRes.rows[0]?.id || '00000000-0000-0000-0000-000000000001';

    // Deduplicate incoming RFCs by (ticket, sistema_name) key to allow same ticket on different systems
    const ticketMap = new Map();
    for (let idx = 0; idx < rfcs.length; idx++) {
      const item = rfcs[idx];
      if (!item) continue;
      const t = String(item.ticket || item['ticket (rfc)'] || item.num_ticket || '').trim();
      const s = String(item.sistema_name || item.sistema || 'SAP General').trim();
      const ticketKey = t || `RFC-${Date.now()}-${idx}`;
      const compositeKey = `${ticketKey}___${s}`;
      ticketMap.set(compositeKey, { ...item, ticket: ticketKey, sistema_name: s });
    }
    const deduplicatedRfcs = Array.from(ticketMap.values());

    const chunkSize = 100;
    let insertedCount = 0;

    for (let i = 0; i < deduplicatedRfcs.length; i += chunkSize) {
      const chunk = deduplicatedRfcs.slice(i, i + chunkSize);
      const values = [];
      const valueStrings = [];
      let pIdx = 1;

      for (const item of chunk) {
        const ticket = String(item.ticket || `RFC-${Date.now()}-${Math.floor(Math.random()*1000)}`).trim();
        const tipo = String(item.tipo || 'RFC').trim();
        const ambiente = String(item.ambiente || 'Azure').trim();
        const sid = String(item.sid || item.sistema_sid || 'PRD').trim();
        const fecha = cleanDate(item.fecha || item.fecha_inicio) || new Date().toISOString().split('T')[0];
        const fecha_fin = cleanDate(item.fecha_fin || item.fecha);
        const fecha_fin_retorno = cleanDate(item.fecha_fin_retorno || item.fecha_retorno);
        const sistema_name = String(item.sistema_name || item.sistema || 'SAP General').trim();
        const promotor = String(item.promotor || item.solicitante || 'Carga Masiva').trim();
        const coordinador_kof = String(item.coordinador_kof || item.coordinador || '').trim();
        const descripcion = String(item.descripcion || 'RFC importado por carga inicial').trim();
        const observaciones = String(item.observaciones || '').trim();
        const status = normalizeRfcStatus(item.status || item.estatus || item.estado);
        const hora_inicio = cleanTime(item.hora_inicio) || '00:00';
        const hora_fin = cleanTime(item.hora_fin) || '23:59';
        const hora_fin_retorno = cleanTime(item.hora_fin_retorno || item.hora_retorno);

        valueStrings.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`);
        values.push(
          ticket, tipo, ambiente, sid, fecha, fecha_fin, fecha_fin_retorno,
          sistema_name, promotor, coordinador_kof, descripcion, observaciones, status,
          hora_inicio, hora_fin, hora_fin_retorno, defaultOwnerId
        );
      }

      const batchSql = `
        INSERT INTO public.rfcs (
          ticket, tipo, ambiente, sid, fecha, fecha_fin, fecha_fin_retorno,
          sistema_name, promotor, coordinador_kof, descripcion, observaciones, status,
          hora_inicio, hora_fin, hora_fin_retorno, owner_id
        ) VALUES ${valueStrings.join(', ')}
        ON CONFLICT (ticket, sistema_name) DO UPDATE SET
          tipo = EXCLUDED.tipo,
          ambiente = EXCLUDED.ambiente,
          sid = EXCLUDED.sid,
          fecha = EXCLUDED.fecha,
          fecha_fin = EXCLUDED.fecha_fin,
          fecha_fin_retorno = EXCLUDED.fecha_fin_retorno,
          sistema_name = EXCLUDED.sistema_name,
          promotor = EXCLUDED.promotor,
          coordinador_kof = EXCLUDED.coordinador_kof,
          descripcion = EXCLUDED.descripcion,
          observaciones = EXCLUDED.observaciones,
          status = EXCLUDED.status,
          hora_inicio = EXCLUDED.hora_inicio,
          hora_fin = EXCLUDED.hora_fin,
          hora_fin_retorno = EXCLUDED.hora_fin_retorno,
          updated_at = NOW()
      `;

      await client.query(batchSql, values);
      insertedCount += chunk.length;
    }

    await client.query('COMMIT');
    logger.info({ count: insertedCount }, 'BULK_UPLOAD completed');
    return res.json({ ok: true, count: insertedCount, message: `Se importaron ${insertedCount} RFCs exitosamente.` });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err: err.message, stack: err.stack }, 'BULK_UPLOAD_ERROR');
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete('/api/rfcs/purge-all', authenticateToken, requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM public.rfcs');
    logger.info({}, 'BULK_PURGE completed');
    return res.json({ ok: true, message: 'Se eliminaron todos los RFCs exitosamente.' });
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'BULK_PURGE_ERROR');
    return res.status(500).json({ error: err.message });
  }
});

const MESES_NOMBRES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function formatFechasAMeses(fechasArr) {
  if (!fechasArr || fechasArr.length === 0) return 'Julio 2026';
  const mesesSet = new Set();
  fechasArr.forEach(f => {
    if (!f) return;
    let str = String(f).trim().split('T')[0];
    const parts = str.split('-');
    if (parts.length >= 2) {
      const y = parts[0];
      const m = parseInt(parts[1], 10) - 1;
      if (m >= 0 && m < 12) {
        mesesSet.add(`${MESES_NOMBRES[m]} ${y}`);
      }
    }
  });
  return Array.from(mesesSet).join(', ') || 'Julio 2026';
}

app.post('/api/ai/chat-contextual', authenticateToken, requireAuth, async (req, res) => {
  try {
    const { prompt = '', messages = [] } = req.body;
    const userQuery = prompt || (messages.length > 0 ? messages[messages.length - 1].content : '');
    const queryLower = userQuery.toLowerCase();

    const sistemasRes = await pool.query(`
      SELECT nombre, infraestructura, tipo_sap, criticidad 
      FROM public.sistemas 
      ORDER BY nombre ASC
    `);
    const sistemas = sistemasRes.rows || [];

    const sapSystems = sistemas.filter(s => (s.tipo_sap || '').toUpperCase() === 'SAP');
    const noSapSystems = sistemas.filter(s => (s.tipo_sap || '').toUpperCase() !== 'SAP');

    const topRfcsRes = await pool.query(`
      SELECT COALESCE(NULLIF(sistema_name, ''), 'Sin Sistema') as sys_name, 
             COUNT(*) as total_rfcs,
             COUNT(*) FILTER (WHERE LOWER(status) LIKE '%éxito%' AND LOWER(status) NOT LIKE '%sin%') as exito_rfcs,
             COUNT(*) FILTER (WHERE LOWER(status) LIKE '%espera%' OR LOWER(status) LIKE '%vobo%') as espera_rfcs,
             ARRAY_AGG(DISTINCT fecha) as fechas
      FROM public.rfcs
      GROUP BY sys_name
      ORDER BY total_rfcs DESC
    `);
    const rfcStatsBySystem = topRfcsRes.rows || [];

    const totalRfcsRes = await pool.query(`SELECT COUNT(*) as total FROM public.rfcs`);
    const totalRfcsCount = parseInt(totalRfcsRes.rows[0]?.total || 0, 10);

    let reply = '';

    if (queryLower.includes('resumen') || queryLower.includes('más cambios') || queryLower.includes('mas cambios') || queryLower.includes('top') || queryLower.includes('volumen') || queryLower.includes('sistemas') || queryLower.includes('mes')) {
      reply += `🤖 **Atlas IA Copilot**\n\n`;
      reply += `**Resumen de Sistemas Registrados con Cambios y Meses de Ejecución (PostgreSQL en Vivo):**\n\n`;
      reply += `📊 **Métricas Globales:**\n`;
      reply += `• Total Sistemas Administrados en Catálogo: **${sistemas.length}** (${sapSystems.length} SAP, ${noSapSystems.length} No SAP)\n`;
      reply += `• Total RFCs Registrados en BD: **${totalRfcsCount}**\n\n`;

      reply += `🔥 **Sistemas Activos con Cambios Registrados y Periodo:**\n\n`;
      if (rfcStatsBySystem.length === 0) {
        reply += `_Aún no hay RFCs registrados en el sistema. Puedes realizar una Carga Masiva Inicial desde el menú lateral._\n`;
      } else {
        rfcStatsBySystem.forEach((r, idx) => {
          const mesesStr = formatFechasAMeses(r.fechas);
          reply += `${idx + 1}. **${r.sys_name}**: **${r.total_rfcs} RFCs**\n`;
          reply += `   📅 **Mes de ejecución:** ${mesesStr}\n`;
          reply += `   ✅ **Estatus:** ${r.exito_rfcs} finalizados con éxito | ⏳ ${r.espera_rfcs} en espera VOBO\n\n`;
        });
      }

      reply += `💡 **Tip de Operaciones:** Puedes filtrar los RFCs por fecha y criticidad directamente desde el Dashboard.`;
    } 
    else if (queryLower.includes('rfc') || queryLower.includes('estatus') || queryLower.includes('vobo') || queryLower.includes('ejecucion')) {
      const statusRes = await pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE LOWER(status) LIKE '%éxito%' AND LOWER(status) NOT LIKE '%sin%') as exito,
          COUNT(*) FILTER (WHERE LOWER(status) LIKE '%espera%' OR LOWER(status) LIKE '%vobo%') as espera,
          COUNT(*) FILTER (WHERE LOWER(status) LIKE '%cancel%') as cancelados,
          COUNT(*) as total
        FROM public.rfcs
      `);
      const st = statusRes.rows[0] || {};
      reply += `🤖 **Atlas IA Copilot**\n\n`;
      reply += `**Estado Actual de Operaciones RFC (PostgreSQL en Vivo):**\n\n`;
      reply += `• **Total de RFCs:** ${st.total || 0}\n`;
      reply += `• **Finalizados con Éxito:** ${st.exito || 0}\n`;
      reply += `• **En Espera de VOBO:** ${st.espera || 0}\n`;
      reply += `• **Cancelados / Reprogramados:** ${st.cancelados || 0}\n`;
    }
    else {
      reply += `🤖 **Atlas IA Copilot**\n\n`;
      reply += `Hola. He consultado el motor contextual PostgreSQL para *"${userQuery}"*:\n\n`;
      reply += `• **Sistemas Administrados:** ${sistemas.length} (${sapSystems.length} SAP, ${noSapSystems.length} No SAP)\n`;
      reply += `• **Total RFCs Registrados:** ${totalRfcsCount}\n`;
      if (rfcStatsBySystem.length > 0) {
        reply += `• **Sistema con Mayor Actividad:** ${rfcStatsBySystem[0].sys_name} (${rfcStatsBySystem[0].total_rfcs} RFCs - ${formatFechasAMeses(rfcStatsBySystem[0].fechas)})\n`;
      }
      reply += `\nPuedes solicitar un resumen de los sistemas con más cambios o indicar el mes de ejecución.`;
    }

    return res.json({
      ok: true,
      provider: 'Atlas IA Copilot (Motor Contextual PostgreSQL)',
      reply: reply
    });
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'AI_CHAT_ERROR');
    return res.status(500).json({ error: 'Error al procesar consulta en el motor contextual.' });
  }
});

// ============================================================
// OPCIÓN 3: ANÁLISIS PREDICTIVO DE RIESGOS EN RFCS (DB EN VIVO)
// ============================================================
app.post('/api/ai/risk-analysis', authenticateToken, requireAuth, async (req, res) => {
  try {
    const { systemName = '', environment = 'PRD', fecha = '' } = req.body;
    const targetDate = fecha || new Date().toISOString().split('T')[0];
    
    const concurrentRes = await pool.query(
      `SELECT ticket, sistema_name, ambiente, fecha, status, promotor 
       FROM public.rfcs 
       WHERE fecha = $1 AND (sistema_name ILIKE $2 OR ambiente = 'PRD') AND status NOT IN ('Cancelado', 'Fallido')`,
      [targetDate, `%${systemName}%`]
    );

    const isPrd = environment.toUpperCase() === 'PRD';
    const systemCollisions = concurrentRes.rows.filter(r => 
      r.sistema_name && r.sistema_name.toLowerCase().includes(systemName.toLowerCase())
    );
    
    let riskLevel = 'LOW';
    let riskScore = 15;
    let reasons = [];

    if (isPrd) {
      riskScore += 35;
      reasons.push('Ambiente crítico de Producción (PRD)');
    }
    if (systemCollisions.length > 1) {
      riskScore += 40;
      reasons.push(`Coincidencia de ventana con ${systemCollisions.length - 1} otro(s) cambio(s) programado(s) en el mismo sistema`);
    } else if (concurrentRes.rows.length > 3) {
      riskScore += 20;
      reasons.push(`Alto volumen global de mantenimientos (${concurrentRes.rows.length} RFCs el mismo día)`);
    }

    if (riskScore >= 60) riskLevel = 'HIGH';
    else if (riskScore >= 35) riskLevel = 'MEDIUM';

    return res.json({
      ok: true,
      riskLevel,
      riskScore,
      reasons,
      concurrentRfcs: concurrentRes.rows
    });
  } catch (err) {
    logger.error({ err: err.message }, 'RISK_ANALYSIS_ERROR');
    return res.status(500).json({ error: 'Error en análisis de riesgo: ' + err.message });
  }
});

// ============================================================
// ENDPOINTS PARA APRENDIZAJE CONTINUO DEL CHATBOT CON N8N
// ============================================================
app.post('/api/ai/feedback', authenticateToken, requireAuth, async (req, res) => {
  const { query, bot_response, rating, comentarios } = req.body;
  const userId = req.user.sub;

  if (!query || !bot_response || rating === undefined) {
    return res.status(400).json({ error: 'Faltan datos de retroalimentación (query, bot_response, rating).' });
  }

  try {
    const insertRes = await pool.query(
      `INSERT INTO public.ai_chat_feedback (user_id, query, bot_response, rating, comentarios)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, query, bot_response, rating, comentarios || null]
    );

    const feedbackId = insertRes.rows[0].id;

    // Disparar Webhook de n8n para procesamiento de aprendizaje continuo
    fetch('http://10.10.10.103:5678/webhook/atlas-ai-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feedback_id: feedbackId,
        user_id: userId,
        user_email: req.user.email,
        query,
        bot_response,
        rating,
        comentarios
      })
    }).catch(e => console.warn('[N8N_AI_FEEDBACK_WEBHOOK_WARN]', e.message));

    logAudit(userId, req.user.email, req.ip, 'AI_CHAT_FEEDBACK', 'AI', 'INFO', { rating, feedbackId });

    return res.status(200).json({
      ok: true,
      message: '¡Muchas gracias! Tu retroalimentación ha sido enviada al motor n8n para la mejora continua del chatbot.'
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Error al guardar feedback de IA');
    return res.status(500).json({ error: 'Error al procesar la retroalimentación.' });
  }
});

app.get('/api/ai/knowledge', authenticateToken, requireAuth, async (req, res) => {
  try {
    const kbRes = await pool.query(
      'SELECT id, pregunta, respuesta, categoria, origen, votos_positivos, votos_negativos, created_at FROM public.ai_knowledge_base WHERE activo = true ORDER BY created_at DESC LIMIT 50'
    );
    return res.json({ ok: true, knowledge: kbRes.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// OPCIÓN 5: ASISTENTE DE GUARDIA Y ALERTAS PROACTIVAS (DB EN VIVO)
// ============================================================
app.get('/api/ai/proactive-alerts', authenticateToken, requireAuth, async (req, res) => {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    
    const prdTodayRes = await pool.query(
      `SELECT ticket, sistema_name, ambiente, status, hora_inicio 
       FROM public.rfcs 
       WHERE ambiente = 'PRD' AND fecha = $1 AND status NOT IN ('Cancelado', 'Fallido') 
       ORDER BY hora_inicio ASC LIMIT 5`,
      [todayStr]
    );

    const pendingVoboRes = await pool.query(
      `SELECT COUNT(*) as pending_vobo FROM public.rfcs WHERE LOWER(status) LIKE '%espera%' OR LOWER(status) LIKE '%vobo%'`
    );

    const pendingSolRes = await pool.query(
      `SELECT COUNT(*) as pending_sols FROM public.solicitudes WHERE LOWER(estatus) LIKE '%espera%' OR LOWER(estatus) LIKE '%pendiente%'`
    );

    const prdCount = prdTodayRes.rows.length;
    const pendingVobos = parseInt(pendingVoboRes.rows[0]?.pending_vobo || '0', 10);
    const pendingSols = parseInt(pendingSolRes.rows[0]?.pending_sols || '0', 10);

    const alerts = [];
    if (prdCount > 0) {
      alerts.push({
        type: 'PRD_WINDOW',
        severity: 'warning',
        message: `⚠️ Guardias TQS: Hay ${prdCount} cambio(s) en Producción (PRD) hoy (${todayStr}).`
      });
    }
    if (pendingVobos > 0) {
      alerts.push({
        type: 'PENDING_VOBO',
        severity: 'info',
        message: `📋 Existen ${pendingVobos} RFC(s) en espera de aprobación VoBo en el portal.`
      });
    }

    return res.json({ ok: true, alerts, stats: { prdCount, pendingVobos, pendingSols } });
  } catch (err) {
    logger.error({ err: err.message }, 'PROACTIVE_ALERTS_ERROR');
    return res.status(500).json({ error: 'Error en alertas proactivas: ' + err.message });
  }
});

// Endpoint para recibir y registrar en BD errores generados en el cliente / frontend
app.post('/api/log-client-error', async (req, res) => {
  try {
    const { message, stack, url, line, col, userAgent } = req.body || {};
    if (!message) return res.status(400).json({ error: 'Mensaje de error requerido.' });

    await logApp(
      'ERROR',
      'CLIENT_UI',
      `Error en frontend: ${message}`,
      stack || `Ubicación: ${url || 'desconocida'}:${line || '0'}:${col || '0'}`,
      { url, line, col, userAgent, userId: req.user?.sub || null }
    );

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err.message }, 'LOG_CLIENT_ERROR_FAIL');
    return res.status(500).json({ error: 'Error al registrar log de cliente.' });
  }
});

// Middleware global para captura y registro de errores en rutas Express
app.use((err, req, res, next) => {
  const statusCode = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  
  logApp(
    'ERROR',
    'EXPRESS_ROUTER',
    `Error no controlado en ${req.method} ${req.url}: ${message}`,
    err.stack || null,
    {
      reqId: req.id,
      method: req.method,
      url: req.url,
      statusCode,
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1',
      userId: req.user?.sub,
      body: sanitize(req.body),
    }
  );

  if (!res.headersSent) {
    const isProduction = process.env.NODE_ENV === 'production';
    res.status(statusCode).json({
      error: (isProduction && statusCode === 500) ? 'Internal Server Error' : message,
      reqId: req.id,
    });
  }
});

// Capturadores globales de excepciones no controladas del proceso Node.js
process.on('uncaughtException', (err) => {
  logger.error({ err: err.message, stack: err.stack }, 'UNCAUGHT_EXCEPTION');
  logApp('CRITICAL', 'PROCESS', `Excepción no capturada: ${err.message}`, err.stack, { error: err.message });
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : null;
  logger.error({ reason: message, stack }, 'UNHANDLED_REJECTION');
  logApp('CRITICAL', 'PROCESS', `Rechazo de promesa no controlado: ${message}`, stack, { reason: message });
});

app.listen(port, () => {
  logger.info({ port }, 'ATLAS API Server running');
});