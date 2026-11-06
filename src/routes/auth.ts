import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { AuthRequest, authenticateToken, requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, signupSchema, loginSchema, passwordSchema, recoverSchema, resetPasswordSchema, securityQuestionSchema, adminUserSchema } from '../middleware/validation.js';
import { createTokenPair, verifyRefreshToken, rotateRefreshToken, revokeRefreshToken, signAccessToken } from '../services/jwt.js';
import { logAudit, logApp } from '../services/audit.js';
import { sendRecoveryEmail, triggerN8nWebhook } from '../services/email.js';
import { getPool } from '../config/db.js';
import crypto from 'crypto';

const router = Router();

router.post('/signup', validateBody(signupSchema), async (req: AuthRequest, res: Response) => {
  const { email, password, options } = req.body;
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '127.0.0.1';

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const metadata = options?.data || {};

    const pool = getPool();
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

      const { accessToken, refreshToken, expiresAt, refreshExpiresAt } = await createTokenPair(
        createdUser.id,
        createdUser.email,
        'fte',
        clientIp
      );

      logAudit(createdUser.id, createdUser.email, clientIp, 'SIGNUP', 'AUTH', 'INFO', { metadata });

      res.status(200).json({
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 86400,
        refresh_token: refreshToken,
        refresh_token_expires_at: refreshExpiresAt.toISOString(),
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
    if ((err as any).code === '23505') {
      res.status(400).json({ error: 'Email ya registrado' });
      return;
    }
    logApp('ERROR', 'AUTH', 'Signup error', (err as Error).stack);
    res.status(400).json({ error: (err as Error).message || 'Signup failed' });
  }
});

router.post('/token', validateBody(loginSchema), async (req: AuthRequest, res: Response) => {
  const { email, password } = req.body;
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '127.0.0.1';

  const cleanInput = email.trim().toLowerCase();
  const usernamePrefix = cleanInput.includes('@') ? cleanInput.split('@')[0] : cleanInput;
  const domainVariants = [
    cleanInput,
    `${usernamePrefix}@easconsulting.com.mx`,
    `${usernamePrefix}@eas-consulting.com`,
    `${usernamePrefix}@easconsulting.com`,
  ];

  try {
    const pool = getPool();
    const userRes = await pool.query(
      `SELECT * FROM public.auth_users 
       WHERE LOWER(email) = LOWER($1) 
          OR LOWER(email) = LOWER($2) 
          OR LOWER(email) = LOWER($3) 
          OR LOWER(email) = LOWER($4) 
          OR LOWER(email) LIKE LOWER($5)
       ORDER BY id ASC LIMIT 1`,
      [...domainVariants, `${usernamePrefix}@%`]
    );

    if (userRes.rows.length === 0) {
      logAudit(null, cleanInput, clientIp, 'LOGIN_FAILED', 'AUTH', 'WARN', { motivo: 'Usuario no encontrado' });
      res.status(400).json({ error: 'Credenciales inválidas' });
      return;
    }

    const user = userRes.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      logAudit(user.id, user.email, clientIp, 'LOGIN_FAILED', 'AUTH', 'WARN', { motivo: 'Contraseña incorrecta' });
      res.status(400).json({ error: 'Credenciales inválidas' });
      return;
    }

    const profileRes = await pool.query('SELECT rol, activo FROM public.tqs_users WHERE id = $1', [user.id]);
    if (profileRes.rows.length > 0 && !profileRes.rows[0].activo) {
      logAudit(user.id, user.email, clientIp, 'LOGIN_FAILED', 'AUTH', 'WARN', { motivo: 'Cuenta desactivada' });
      res.status(400).json({ error: 'Cuenta desactivada' });
      return;
    }

    const realRole = profileRes.rows[0]?.rol || 'fte';
    await pool.query('UPDATE public.tqs_users SET primer_login = false WHERE id = $1', [user.id]).catch(() => {});

    const { accessToken, refreshToken, expiresAt, refreshExpiresAt } = await createTokenPair(
      user.id,
      user.email,
      realRole,
      clientIp
    );

    logAudit(user.id, user.email, clientIp, 'LOGIN_SUCCESS', 'AUTH', 'INFO', { timestamp: new Date().toISOString() });

    res.status(200).json({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 86400,
      refresh_token: refreshToken,
      refresh_token_expires_at: refreshExpiresAt.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        user_metadata: user.raw_user_meta_data,
        role: realRole,
      },
    });
  } catch (err) {
    logApp('ERROR', 'AUTH', 'Excepción interna en login', (err as Error).stack);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.post('/refresh', async (req: AuthRequest, res: Response) => {
  const { refresh_token } = req.body;
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '127.0.0.1';

  if (!refresh_token) {
    res.status(400).json({ error: 'refresh_token requerido' });
    return;
  }

  try {
    const env = (await import('../config/env.js')).getEnv();
    const decoded = require('jsonwebtoken').verify(refresh_token, env.JWT_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }) as { sub: string };

    const userId = decoded.sub;
    const valid = await verifyRefreshToken(refresh_token, userId);

    if (!valid) {
      const pool = getPool();
      await pool.query(
        `UPDATE public.refresh_tokens SET revoked_at = NOW(), revoked_ip = $1 WHERE user_id = $2 AND token_hash = $3`,
        [clientIp, userId, crypto.createHash('sha256').update(refresh_token).digest('hex')]
      ).catch(() => {});
      res.status(403).json({ error: 'Refresh token inválido o revocado' });
      return;
    }

    const profileRes = await pool.query('SELECT email, rol FROM public.auth_users au JOIN public.tqs_users tu ON au.id = tu.id WHERE au.id = $1', [userId]);
    if (profileRes.rows.length === 0) {
      res.status(403).json({ error: 'Usuario no encontrado' });
      return;
    }

    const user = profileRes.rows[0];
    if (!user.rol || user.rol === 'authenticated') {
      res.status(403).json({ error: 'Rol no válido' });
      return;
    }

    const { refreshToken, expiresAt } = await rotateRefreshToken(refresh_token, userId, clientIp);

    const newAccessToken = signAccessToken({ sub: userId, email: user.email, role: user.rol });

    res.status(200).json({
      access_token: newAccessToken,
      token_type: 'bearer',
      expires_in: 86400,
      refresh_token: refreshToken,
      refresh_token_expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    if ((err as any).name === 'JsonWebTokenError' || (err as any).name === 'TokenExpiredError') {
      res.status(403).json({ error: 'Refresh token inválido o expirado' });
      return;
    }
    logApp('ERROR', 'AUTH', 'Error en refresh token', (err as Error).stack);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.post('/recover', validateBody(recoverSchema), async (req: AuthRequest, res: Response) => {
  const { email, method = 'security_question', security_answer, admin_user_id } = req.body;
  const cleanEmail = email.trim().toLowerCase();
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '127.0.0.1';

  try {
    const pool = getPool();
    const userRes = await pool.query(
      'SELECT id, email, raw_user_meta_data FROM public.auth_users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [cleanEmail]
    );

    if (userRes.rows.length === 0) {
      logAudit(null, cleanEmail, clientIp, 'RECOVER_REQUEST_UNKNOWN_USER', 'AUTH', 'WARN');
      res.status(200).json({
        ok: true,
        message: 'Si el correo está registrado, se mostrarán las opciones de recuperación.',
      });
      return;
    }

    const user = userRes.rows[0];
    const meta = user.raw_user_meta_data || {};
    const securityQuestions = meta.security_questions || [];

    if (method === 'admin_reset') {
      if (!req.user || !['admin', 'director', 'tqs_leader'].includes(req.user.role)) {
        res.status(403).json({ error: 'Solo administradores, directores o TQS Leaders pueden iniciar reset por admin' });
        return;
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
        adminEmail: req.user.email,
      });

      res.status(200).json({
        ok: true,
        method: 'admin_reset',
        message: 'Código de recuperación generado por admin. Expira en 60 minutos. Consulte el canal seguro para obtenerlo.',
      });
      return;
    }

    if (method === 'security_question') {
      if (security_answer && securityQuestions.length > 0) {
        const question = securityQuestions[0];
        const answerHash = crypto.createHash('sha256').update(security_answer.trim().toLowerCase()).digest('hex');

        if (question.answer_hash !== answerHash) {
          logAudit(user.id, cleanEmail, clientIp, 'SECURITY_QUESTION_FAILED', 'AUTH', 'WARN');
          res.status(400).json({ error: 'Respuesta de seguridad incorrecta' });
          return;
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

      await sendRecoveryEmail(user.email, resetCode, meta.nombre || user.email);
      await triggerN8nWebhook(user.email, resetCode, meta.nombre || user.email);

      res.status(200).json({
        ok: true,
        method: 'security_question',
        message: 'Código de recuperación generado y enviado a tu correo electrónico.',
      });
      return;
    }

    res.status(400).json({ error: 'Método de recuperación no válido' });
  } catch (err) {
    logApp('ERROR', 'AUTH', 'Recover password error', (err as Error).stack);
    res.status(500).json({ error: 'Error al procesar solicitud de recuperación de contraseña.' });
  }
});

router.post('/reset-password', validateBody(resetPasswordSchema), async (req: AuthRequest, res: Response) => {
  const { email, reset_code, new_password } = req.body;
  const cleanEmail = email.trim().toLowerCase();
  const cleanCode = reset_code.trim();
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '127.0.0.1';

  try {
    const pool = getPool();
    const userRes = await pool.query(
      'SELECT id, email, reset_code, reset_expires FROM public.auth_users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [cleanEmail]
    );

    if (userRes.rows.length === 0) {
      res.status(400).json({ error: 'Usuario o código de recuperación no válido.' });
      return;
    }

    const user = userRes.rows[0];

    if (!user.reset_code || user.reset_code !== cleanCode) {
      logAudit(user.id, cleanEmail, clientIp, 'RESET_PASSWORD_FAILED', 'AUTH', 'WARN', { motivo: 'Código inválido' });
      res.status(400).json({ error: 'El código de recuperación es incorrecto o ha expirado.' });
      return;
    }

    if (user.reset_expires && new Date(user.reset_expires) < new Date()) {
      logAudit(user.id, cleanEmail, clientIp, 'RESET_PASSWORD_FAILED', 'AUTH', 'WARN', { motivo: 'Código expirado' });
      res.status(400).json({ error: 'El código de recuperación ha expirado. Por favor solicita uno nuevo.' });
      return;
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

    res.status(200).json({
      ok: true,
      message: 'Tu contraseña ha sido actualizada correctamente. Ya puedes iniciar sesión.',
    });
  } catch (err) {
    logApp('ERROR', 'AUTH', 'Reset password error', (err as Error).stack);
    res.status(500).json({ error: 'Error al actualizar la contraseña.' });
  }
});

router.post('/password', authenticateToken, requireAuth, validateBody(passwordSchema), async (req: AuthRequest, res: Response) => {
  const { password } = req.body;

  try {
    const hash = await bcrypt.hash(password, 12);
    const pool = getPool();
    await pool.query('UPDATE public.auth_users SET password_hash = $1 WHERE id = $2', [hash, req.user!.sub]);
    await pool.query('UPDATE public.tqs_users SET primer_login = false, updated_at = NOW() WHERE id = $1', [req.user!.sub]);
    logAudit(req.user!.sub, req.user!.email, req.ip, 'PASSWORD_CHANGE', 'AUTH', 'INFO', { reset_onboarding: true });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/user', authenticateToken, requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const pool = getPool();
    const userRes = await pool.query('SELECT id, email, raw_user_meta_data FROM public.auth_users WHERE id = $1', [req.user!.sub]);
    if (userRes.rows.length === 0) {
      res.status(404).json({ error: 'user not found' });
      return;
    }
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

router.put('/user', authenticateToken, requireAuth, async (req: AuthRequest, res: Response) => {
  const { password, data } = req.body;
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '127.0.0.1';

  try {
    const pool = getPool();
    if (password) {
      const parsed = passwordSchema.safeParse({ password });
      if (!parsed.success) {
        res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
        return;
      }
      const passwordHash = await bcrypt.hash(password, 12);
      await pool.query('UPDATE public.auth_users SET password_hash = $1 WHERE id = $2', [passwordHash, req.user!.sub]);
      logAudit(req.user!.sub, req.user!.email, clientIp, 'PASSWORD_CHANGE', 'AUTH', 'INFO', { timestamp: new Date().toISOString() });
    }
    if (data) {
      await pool.query('UPDATE public.auth_users SET raw_user_meta_data = raw_user_meta_data || $1 WHERE id = $2', [JSON.stringify(data), req.user!.sub]);
      if (data.nombre) {
        await pool.query('UPDATE public.tqs_users SET nombre = $1 WHERE id = $2', [data.nombre, req.user!.sub]);
      }
      logAudit(req.user!.sub, req.user!.email, clientIp, 'PROFILE_UPDATE', 'AUTH', 'INFO', { data });
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/logout', authenticateToken, requireAuth, async (req: AuthRequest, res: Response) => {
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '127.0.0.1';
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];

  if (token && token !== (await import('../config/env.js')).getEnv().SB_ANON) {
    await revokeRefreshToken(token, req.user!.sub, clientIp).catch(() => {});
  }

  logAudit(req.user!.sub, req.user!.email, clientIp, 'LOGOUT', 'AUTH', 'INFO', { timestamp: new Date().toISOString() });
  res.status(200).json({});
});

router.post('/security-questions', authenticateToken, requireAuth, validateBody(securityQuestionSchema), async (req: AuthRequest, res: Response) => {
  const { user_id, question_id, answer_hash } = req.body;
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '127.0.0.1';

  if (req.user!.sub !== user_id && !['admin', 'director'].includes(req.user!.role)) {
    res.status(403).json({ error: 'No autorizado para configurar preguntas de otro usuario' });
    return;
  }

  try {
    const pool = getPool();
    const userRes = await pool.query('SELECT raw_user_meta_data FROM public.auth_users WHERE id = $1', [user_id]);
    if (userRes.rows.length === 0) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    const meta = userRes.rows[0].raw_user_meta_data || {};
    const questions = meta.security_questions || [];

    const questionMap: Record<string, string> = {
      birth_city: '¿En qué ciudad naciste?',
      first_pet: '¿Cuál fue el nombre de tu primera mascota?',
      mother_maiden: '¿Cuál es el apellido de soltera de tu madre?',
      first_school: '¿Cuál fue el nombre de tu primera escuela?',
      favorite_teacher: '¿Cuál era el nombre de tu maestro favorito?',
    };

    const questionText = questionMap[question_id] || question_id;
    const hashedAnswer = crypto.createHash('sha256').update(answer_hash.trim().toLowerCase()).digest('hex');

    const existingIndex = questions.findIndex((q: any) => q.id === question_id);
    if (existingIndex >= 0) {
      questions[existingIndex] = { id: question_id, question: questionText, answer_hash: hashedAnswer };
    } else {
      questions.push({ id: question_id, question: questionText, answer_hash: hashedAnswer });
    }

    await pool.query(
      'UPDATE public.auth_users SET raw_user_meta_data = jsonb_set(raw_user_meta_data, $1, $2) WHERE id = $3',
      ['{security_questions}', JSON.stringify(questions), user_id]
    );

    logAudit(req.user!.sub, req.user!.email, clientIp, 'SECURITY_QUESTION_SET', 'AUTH', 'INFO', { userId: user_id, questionId: question_id });
    res.status(200).json({ ok: true, message: 'Pregunta de seguridad configurada' });
  } catch (err) {
    logApp('ERROR', 'AUTH', 'Security question error', (err as Error).stack);
    res.status(500).json({ error: 'Error al configurar pregunta de seguridad' });
  }
});

router.get('/security-questions/:userId', authenticateToken, requireAuth, async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;

  if (req.user!.sub !== userId && !['admin', 'director'].includes(req.user!.role)) {
    res.status(403).json({ error: 'No autorizado' });
    return;
  }

  try {
    const pool = getPool();
    const userRes = await pool.query('SELECT raw_user_meta_data FROM public.auth_users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    const meta = userRes.rows[0].raw_user_meta_data || {};
    const questions = meta.security_questions || [];
    const safeQuestions = questions.map((q: any) => ({ id: q.id, question: q.question }));

    res.status(200).json({ questions: safeQuestions });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener preguntas de seguridad' });
  }
});

router.post('/admin/users', authenticateToken, requireAuth, requireRole('admin', 'director'), validateBody(adminUserSchema), async (req: AuthRequest, res: Response) => {
  const { action, id, email, password, nombre, rol, sistemas, siguiendo_tqs, backup_tqs_id, activo } = req.body;
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '127.0.0.1';
  const adminId = req.user!.sub;
  const adminEmail = req.user!.email;

  const pool = getPool();
  const client = await pool.connect();

  try {
    if (action === 'create') {
      if (!email || !password || !nombre) {
        res.status(400).json({ error: 'Nombre, email y password son obligatorios' });
        return;
      }
      // ... create logic
    }
    // ... other actions
    res.status(200).json({ ok: true });
  } catch (err) {
    logApp('ERROR', 'ADMIN_USERS', 'Error en admin users', (err as Error).stack);
    res.status(500).json({ error: 'Error interno' });
  } finally {
    client.release();
  }
});

export default router;