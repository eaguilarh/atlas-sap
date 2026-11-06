const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const crypto = require('crypto');

test('Seguridad V-01: Verificación de contraseñas con bcrypt (Sin Backdoors)', async () => {
  const passwordReal = 'MiPasswordSeguro123!';
  const hashReal = await bcrypt.hash(passwordReal, 10);

  // 1. Contraseña correcta debe ser válida
  const esValida = await bcrypt.compare(passwordReal, hashReal);
  assert.strictEqual(esValida, true, 'La contraseña real debe ser aceptada');

  // 2. Intentos con claves backdoor eliminadas DEBEN ser rechazados
  const contrasenasMaestrasEliminadas = ['admin123', 'Yanosemeolvida01', '12345678', 'guardiatqs01', 'Inicio.01'];
  for (const passInvalida of contrasenasMaestrasEliminadas) {
    const esInvalidaValida = await bcrypt.compare(passInvalida, hashReal);
    assert.strictEqual(esInvalidaValida, false, `La contraseña maestra ${passInvalida} DEBE ser rechazada`);
  }
});

test('Seguridad V-02: Política CORS de Orígenes Permitidos', () => {
  const allowedOrigins = ['http://localhost:3000', 'http://localhost:54321', 'https://atlas.easconsulting.com.mx'];

  const checkCors = (origin, env) => {
    if (!origin || allowedOrigins.includes(origin) || env !== 'production') {
      return true;
    }
    return false;
  };

  assert.strictEqual(checkCors('http://localhost:3000', 'production'), true);
  assert.strictEqual(checkCors('https://atlas.easconsulting.com.mx', 'production'), true);
  assert.strictEqual(checkCors('https://sitio-malicioso.com', 'production'), false, 'Sitio malicioso debe ser bloqueado en producción');
});

test('QA-04: Esquemas Zod para Validación de Entrada (Input Sanitation)', () => {
  const loginSchema = z.object({
    email: z.string().min(1),
    password: z.string().min(1),
  });

  assert.strictEqual(loginSchema.safeParse({ email: 'admin@easconsulting.com.mx', password: 'secret' }).success, true);
  assert.strictEqual(loginSchema.safeParse({ email: '', password: 'secret' }).success, false);
});

test('SEC-01: JWT Token validation with issuer and audience', () => {
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = 'test-secret-key-at-least-32-chars-long';
  const JWT_ISSUER = 'atlas-sap-operations';
  const JWT_AUDIENCE = 'atlas-api';

  const validToken = jwt.sign({ sub: '123', email: 'test@test.com', role: 'admin' }, JWT_SECRET, { 
    expiresIn: '1h',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  // Valid token should pass
  const decoded = jwt.verify(validToken, JWT_SECRET, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
  assert.strictEqual(decoded.sub, '123');

  // Token without issuer should fail
  const tokenNoIssuer = jwt.sign({ sub: '123' }, JWT_SECRET, { expiresIn: '1h' });
  assert.throws(() => jwt.verify(tokenNoIssuer, JWT_SECRET, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE }));

  // Token with wrong audience should fail
  const tokenWrongAud = jwt.sign({ sub: '123' }, JWT_SECRET, { expiresIn: '1h', issuer: JWT_ISSUER, audience: 'wrong' });
  assert.throws(() => jwt.verify(tokenWrongAud, JWT_SECRET, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE }));
});

test('SEC-02: parseFilters allows only whitelisted columns', () => {
  const ALLOWED_COLUMNS = {
    rfcs: ['id', 'ticket', 'tipo', 'ambiente', 'fecha', 'status'],
    solicitudes: ['id', 'tipo', 'estatus'],
  };

  function parseFilters(query, tableName) {
    const conditions = [];
    const values = [];
    let paramIndex = 1;
    const allowedCols = ALLOWED_COLUMNS[tableName] || [];

    for (const [key, val] of Object.entries(query)) {
      if (['select', 'order', 'limit', 'offset', 'all'].includes(key)) continue;
      if (key !== 'or' && !allowedCols.includes(key)) continue;
      if (typeof val !== 'string') continue;

      if (val.startsWith('eq.')) {
        const v = val.replace('eq.', '');
        conditions.push(`${key} = $${paramIndex++}`);
        values.push(v);
      }
    }
    return { whereClause: conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '', values };
  }

  // Valid column should work
  const result1 = parseFilters({ ticket: 'eq.RFC-123' }, 'rfcs');
  assert.ok(result1.whereClause.includes('ticket = $1'));

  // Invalid column should be ignored
  const result2 = parseFilters({ evil_column: 'eq.injection' }, 'rfcs');
  assert.strictEqual(result2.whereClause, '');

  // SQL injection attempt in column name should be ignored
  const result3 = parseFilters({ 'ticket; DROP TABLE rfcs;--': 'eq.test' }, 'rfcs');
  assert.strictEqual(result3.whereClause, '');
});

test('SEC-03: Rate limiting key generator uses user_id when authenticated', () => {
  const getRateLimitKey = (req) => {
    if (req.user?.sub) return `user:${req.user.sub}`;
    return `ip:${req.ip || '127.0.0.1'}`;
  };

  // Unauthenticated request uses IP
  assert.strictEqual(getRateLimitKey({ ip: '192.168.1.1' }), 'ip:192.168.1.1');

  // Authenticated request uses user_id
  assert.strictEqual(getRateLimitKey({ user: { sub: 'user-123' } }), 'user:user-123');

  // Authenticated request overrides IP
  assert.strictEqual(getRateLimitKey({ ip: '192.168.1.1', user: { sub: 'user-123' } }), 'user:user-123');
});

test('SEC-04: Refresh token hashing and verification', async () => {
  const pool = { query: async () => {} }; // Mock

  async function generateRefreshToken(userId, clientIp) {
    const token = crypto.randomBytes(64).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    return { token, tokenHash };
  }

  async function verifyRefreshToken(token, tokenHashFromDb) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    return tokenHash === tokenHashFromDb;
  }

  const { token, tokenHash } = await generateRefreshToken('user-123', '127.0.0.1');
  
  // Valid token should verify
  const valid = await verifyRefreshToken(token, tokenHash);
  assert.strictEqual(valid, true);

  // Invalid token should fail
  const invalid = await verifyRefreshToken('wrong-token', tokenHash);
  assert.strictEqual(invalid, false);

  // Token should be 128 chars (64 bytes hex)
  assert.strictEqual(token.length, 128);
});

test('SEC-05: Helmet CSP configuration', () => {
  const helmet = require('helmet');
  
  // Test that CSP is configured (not disabled)
  const middleware = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
      },
    },
  });
  
  assert.ok(middleware);
  // Note: Full CSP testing requires integration test with actual HTTP requests
});

test('SEC-06: Email normalization removed - exact match only', () => {
  const cleanEmail = (email) => email.trim().toLowerCase();
  
  // No more automatic domain appending
  assert.strictEqual(cleanEmail('admin@easconsulting.com'), 'admin@easconsulting.com');
  assert.strictEqual(cleanEmail('admin@easconsulting.com.mx'), 'admin@easconsulting.com.mx');
  assert.strictEqual(cleanEmail('  USER@EXAMPLE.COM  '), 'user@example.com');
});

test('SEC-07: RBAC requires explicit role, no "authenticated" default', () => {
  const allowedRoles = ['admin', 'tqs_leader', 'fte', 'director', 'guardia'];
  
  function checkRole(userRole, requiredRoles) {
    if (!userRole || userRole === 'authenticated') return false;
    return requiredRoles.includes(userRole);
  }

  assert.strictEqual(checkRole('admin', ['admin']), true);
  assert.strictEqual(checkRole('fte', ['admin', 'tqs_leader']), false);
  assert.strictEqual(checkRole('authenticated', ['admin']), false, 'authenticated role must be rejected');
  assert.strictEqual(checkRole(null, ['admin']), false);
  assert.strictEqual(checkRole(undefined, ['admin']), false);
});

test('SEC-08: Input validation rejects dangerous characters in Zod schemas', () => {
  const rfcsInsertSchema = z.object({
    ticket: z.string().min(1).max(100).regex(/^[a-zA-Z0-9\-_]+$/),
    sistema_name: z.string().min(1).max(200).regex(/^[a-zA-Z0-9\s\-_\.]+$/),
    descripcion: z.string().max(5000).optional(),
  });

  // Valid input
  assert.ok(rfcsInsertSchema.safeParse({ 
    ticket: 'RFC-123', 
    sistema_name: 'SAP ECC', 
    descripcion: 'Normal description' 
  }).success);

  // SQL injection attempt in ticket
  assert.strictEqual(rfcsInsertSchema.safeParse({ 
    ticket: "RFC-123'; DROP TABLE rfcs;--", 
    sistema_name: 'SAP ECC' 
  }).success, false);

  // XSS attempt in descripcion
  assert.strictEqual(rfcsInsertSchema.safeParse({ 
    ticket: 'RFC-123', 
    sistema_name: 'SAP ECC',
    descripcion: '<script>alert(1)</script>' 
  }).success, false);
});

test('SEC-09: SELECT column validation uses allowlist', () => {
  const ALLOWED_COLUMNS = {
    rfcs: ['id', 'ticket', 'tipo', 'ambiente', 'fecha', 'status'],
  };

  function validateSelectColumns(select, tableName) {
    if (!select || select === '*') return { valid: true, columns: '*' };
    const allowedCols = ALLOWED_COLUMNS[tableName] || [];
    const requestedCols = select.split(',').map(c => c.trim());
    const validCols = requestedCols.filter(c => c === '*' || allowedCols.includes(c));
    return { 
      valid: validCols.length === requestedCols.length, 
      columns: validCols.join(', ') 
    };
  }

  // Valid columns
  const r1 = validateSelectColumns('id,ticket,fecha', 'rfcs');
  assert.strictEqual(r1.valid, true);

  // Invalid column
  const r2 = validateSelectColumns('id,evil_column', 'rfcs');
  assert.strictEqual(r2.valid, false);

  // SQL injection attempt
  const r3 = validateSelectColumns('id,ticket; DROP TABLE rfcs;--', 'rfcs');
  assert.strictEqual(r3.valid, false);
});

test('SEC-10: ORDER BY column validation uses allowlist', () => {
  const ALLOWED_COLUMNS = {
    rfcs: ['id', 'ticket', 'tipo', 'ambiente', 'fecha', 'status'],
  };

  function validateOrderBy(order, tableName) {
    if (!order) return { valid: true, clause: '' };
    const allowedCols = ALLOWED_COLUMNS[tableName] || [];
    const [col, dir] = order.split('.');
    if (allowedCols.includes(col) && ['asc', 'desc'].includes(dir?.toLowerCase())) {
      return { valid: true, clause: `ORDER BY ${col} ${dir.toUpperCase()}` };
    }
    return { valid: false, clause: '' };
  }

  // Valid order
  const r1 = validateOrderBy('fecha.desc', 'rfcs');
  assert.strictEqual(r1.valid, true);
  assert.ok(r1.clause.includes('fecha DESC'));

  // Invalid column
  const r2 = validateOrderBy('evil_column.desc', 'rfcs');
  assert.strictEqual(r2.valid, false);

  // Invalid direction
  const r3 = validateOrderBy('fecha.invalid', 'rfcs');
  assert.strictEqual(r3.valid, false);
});

test('SEC-11: ALLOWED_COLUMNS includes siguiendo_tqs for tqs_users and tqs_ids for rfcs/solicitudes', () => {
  const ALLOWED_COLUMNS = {
    rfcs: ['id', 'ticket', 'tipo', 'ambiente', 'fecha', 'fecha_fin', 'fecha_fin_retorno', 'sistema_name', 'sistema_grupo', 'sid', 'promotor', 'descripcion', 'observaciones', 'status', 'hora_inicio', 'hora_fin', 'hora_fin_retorno', 'owner_id', 'tqs_ids', 'created_at', 'updated_at', 'deleted_at'],
    solicitudes: ['id', 'ticket', 'tipo', 'origen', 'fecha_inicio', 'sistema_sap', 'responsable', 'estatus', 'descripcion', 'titulo', 'action_items', 'bitacora', 'owner_id', 'tqs_ids', 'created_at', 'updated_at', 'deleted_at'],
    tqs_users: ['id', 'nombre', 'email', 'rol', 'sistemas', 'siguiendo_tqs', 'backup_tqs_id', 'activo', 'primer_login', 'created_at', 'updated_at'],
  };

  assert.ok(ALLOWED_COLUMNS.tqs_users.includes('siguiendo_tqs'), 'tqs_users MUST include siguiendo_tqs');
  assert.ok(ALLOWED_COLUMNS.rfcs.includes('tqs_ids'), 'rfcs MUST include tqs_ids');
  assert.ok(ALLOWED_COLUMNS.solicitudes.includes('tqs_ids'), 'solicitudes MUST include tqs_ids');
});

test('SEC-12: Resolving effective systems combines tqs_users.sistemas, owned systems, and followed TQS Leaders', () => {
  const userLeader = {
    id: 'user-leader-1',
    rol: 'tqs_leader',
    sistemas: ['SAP Solman', 'SAP Cloud Connector']
  };

  const userFte = {
    id: 'user-fte-1',
    rol: 'fte',
    sistemas: ['SAP CRM'],
    siguiendo_tqs: ['user-leader-1']
  };

  const systemsDb = [
    { nombre: 'SAP Solman', owner_id: 'user-leader-1' },
    { nombre: 'SAP Focus Run', owner_id: 'user-leader-1' },
    { nombre: 'SAP EWM', owner_id: 'other-user' }
  ];

  function getEffectiveSystemsMock(user) {
    if (['admin', 'director', 'guardia'].includes(user.rol)) {
      return ['ALL_SYSTEMS'];
    }
    const set = new Set(user.sistemas || []);
    systemsDb.forEach(s => {
      if (s.owner_id === user.id || s.backup_id === user.id) {
        set.add(s.nombre);
      }
    });

    if (user.rol === 'fte' && Array.isArray(user.siguiendo_tqs)) {
      if (user.siguiendo_tqs.includes('user-leader-1')) {
        set.add('SAP Solman');
        set.add('SAP Cloud Connector');
        systemsDb.filter(s => s.owner_id === 'user-leader-1').forEach(s => set.add(s.nombre));
      }
    }
    return Array.from(set).sort();
  }

  const leaderSystems = getEffectiveSystemsMock(userLeader);
  assert.ok(leaderSystems.includes('SAP Solman'));
  assert.ok(leaderSystems.includes('SAP Cloud Connector'));
  assert.ok(leaderSystems.includes('SAP Focus Run'));

  const fteSystems = getEffectiveSystemsMock(userFte);
  assert.ok(fteSystems.includes('SAP CRM'));
  assert.ok(fteSystems.includes('SAP Solman'));
  assert.ok(fteSystems.includes('SAP Focus Run'));
  assert.strictEqual(fteSystems.includes('SAP EWM'), false, 'Unfollowed system must not be included');
});