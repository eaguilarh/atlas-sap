import { Router, Response } from 'express';
import { AuthRequest, authenticateToken, requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateQuery, ALLOWED_COLUMNS } from '../middleware/validation.js';
import { getPool } from '../config/db.js';
import { logActivity, logAudit } from '../services/audit.js';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const router = Router();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  filters: z.string().optional(),
});

router.get('/', authenticateToken, requireAuth, requireRole('admin', 'director'), validateQuery(listQuerySchema), async (req: AuthRequest, res: Response) => {
  const { limit, offset, search, sort, order, filters } = req.query as any;
  const pool = getPool();

  try {
    let whereClause = '';
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause = 'WHERE (nombre ILIKE $1 OR email ILIKE $1)';
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (filters) {
      try {
        const filterObj = JSON.parse(filters);
        const filterClause = Object.entries(filterObj)
          .filter(([k, v]) => ALLOWED_COLUMNS.tqs_users.includes(k) && v !== '')
          .map(([k]) => `${k} = $${paramIndex++}`)
          .join(' AND ');
        if (filterClause) {
          whereClause = whereClause ? `${whereClause} AND ${filterClause}` : `WHERE ${filterClause}`;
          for (const [, v] of Object.entries(filterObj)) {
            params.push(v);
          }
        }
      } catch {}
    }

    const sortColumn = ALLOWED_COLUMNS.tqs_users.includes(sort) ? sort : 'nombre';
    const orderDirection = order === 'asc' ? 'ASC' : 'DESC';

    const countRes = await pool.query(`SELECT COUNT(*) FROM public.tqs_users ${whereClause}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const dataRes = await pool.query(
      `SELECT id, nombre, email, rol, sistemas, siguiendo_tqs, backup_tqs_id, activo, primer_login, created_at, updated_at
       FROM public.tqs_users ${whereClause} ORDER BY ${sortColumn} ${orderDirection} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    res.json({ data: dataRes.rows, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

router.post('/', authenticateToken, requireAuth, requireRole('admin', 'director'), validateBody(z.object({
  email: z.string().email(),
  password: z.string().min(8),
  nombre: z.string().min(1),
  rol: z.enum(['admin', 'tqs_leader', 'fte', 'director', 'guardia']).default('fte'),
  sistemas: z.array(z.string()).default([]),
  siguiendo_tqs: z.array(z.string().uuid()).default([]),
  backup_tqs_id: z.string().uuid().nullable().optional(),
  activo: z.boolean().default(true),
})), async (req: AuthRequest, res: Response) => {
  const { email, password, nombre, rol, sistemas, siguiendo_tqs, backup_tqs_id, activo } = req.body;
  const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '127.0.0.1';
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const passwordHash = await bcrypt.hash(password, 12);

    const authRes = await client.query(
      'INSERT INTO public.auth_users (email, password_hash, raw_user_meta_data) VALUES ($1, $2, $3) RETURNING id',
      [email.toLowerCase(), passwordHash, JSON.stringify({ nombre, rol, sistemas, siguiendo_tqs, backup_tqs_id })]
    );

    const userId = authRes.rows[0].id;

    await client.query(
      'INSERT INTO public.tqs_users (id, nombre, email, rol, sistemas, siguiendo_tqs, backup_tqs_id, activo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [userId, nombre, email.toLowerCase(), rol, sistemas, siguiendo_tqs, backup_tqs_id, activo]
    );

    await client.query('COMMIT');

    logActivity(req.user!.sub, req.user!.email, 'tqs_users', userId, 'CREATE', `Usuario ${nombre} creado`, { email, rol });
    logAudit(req.user!.sub, req.user!.email, clientIp, 'CREATE_USER', 'USERS', 'INFO', { email, rol, adminId: req.user!.sub });

    res.status(201).json({ id: userId, email, nombre, rol, sistemas, siguiendo_tqs, backup_tqs_id, activo });
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as any).code === '23505') {
      res.status(400).json({ error: 'Email ya registrado' });
      return;
    }
    res.status(500).json({ error: 'Error al crear usuario' });
  } finally {
    client.release();
  }
});

router.get('/:id', authenticateToken, requireAuth, requireRole('admin', 'director'), async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  try {
    const resQuery = await pool.query(
      'SELECT id, nombre, email, rol, sistemas, siguiendo_tqs, backup_tqs_id, activo, primer_login, created_at, updated_at FROM public.tqs_users WHERE id = $1',
      [req.params.id]
    );
    if (resQuery.rows.length === 0) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }
    res.json(resQuery.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

router.patch('/:id', authenticateToken, requireAuth, requireRole('admin', 'director'), validateBody(z.object({
  nombre: z.string().optional(),
  rol: z.enum(['admin', 'tqs_leader', 'fte', 'director', 'guardia']).optional(),
  sistemas: z.array(z.string()).optional(),
  siguiendo_tqs: z.array(z.string().uuid()).optional(),
  backup_tqs_id: z.string().uuid().nullable().optional(),
  activo: z.boolean().optional(),
})), async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const oldRes = await client.query('SELECT * FROM public.tqs_users WHERE id = $1', [req.params.id]);
    if (oldRes.rows.length === 0) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }
    const old = oldRes.rows[0];

    const data = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && key !== 'id') {
        updates.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No hay campos para actualizar' });
      return;
    }

    updates.push('updated_at = NOW()');
    values.push(req.params.id);

    const updRes = await client.query(
      `UPDATE public.tqs_users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    const updated = updRes.rows[0];

    if (data.nombre || data.rol || data.sistemas || data.backup_tqs_id !== undefined) {
      await client.query(
        'UPDATE public.auth_users SET raw_user_meta_data = jsonb_set(raw_user_meta_data, $1, $2) WHERE id = $3',
        ['{nombre,rol,sistemas,siguiendo_tqs,backup_tqs_id}', JSON.stringify({
          nombre: updated.nombre,
          rol: updated.rol,
          sistemas: updated.sistemas,
          siguiendo_tqs: updated.siguiendo_tqs,
          backup_tqs_id: updated.backup_tqs_id,
        }), req.params.id]
      );
    }

    await client.query('COMMIT');

    const cambios: Record<string, { old: any; new: any }> = {};
    for (const col of Object.keys(data)) {
      if (old[col] !== updated[col]) {
        cambios[col] = { old: old[col], new: updated[col] };
      }
    }

    logActivity(req.user!.sub, req.user!.email, 'tqs_users', req.params.id, 'UPDATE', `Usuario ${updated.nombre} actualizado`, cambios);
    logAudit(req.user!.sub, req.user!.email, req.ip, 'UPDATE_USER', 'USERS', 'INFO', { email: updated.email, cambios });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al actualizar usuario' });
  } finally {
    client.release();
  }
});

router.delete('/:id', authenticateToken, requireAuth, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  try {
    const resQuery = await pool.query('SELECT nombre, email FROM public.tqs_users WHERE id = $1', [req.params.id]);
    if (resQuery.rows.length === 0) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    await pool.query('DELETE FROM public.tqs_users WHERE id = $1', [req.params.id]);
    await pool.query('DELETE FROM public.auth_users WHERE id = $1', [req.params.id]).catch(() => {});

    logActivity(req.user!.sub, req.user!.email, 'tqs_users', req.params.id, 'DELETE', `Usuario ${resQuery.rows[0].nombre} eliminado`);
    logAudit(req.user!.sub, req.user!.email, req.ip, 'DELETE_USER', 'USERS', 'WARN', { email: resQuery.rows[0].email });

    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

router.post('/:id/toggle-activo', authenticateToken, requireAuth, requireRole('admin', 'director'), async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  try {
    const resQuery = await pool.query('SELECT nombre, email, activo FROM public.tqs_users WHERE id = $1', [req.params.id]);
    if (resQuery.rows.length === 0) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    const newActivo = !resQuery.rows[0].activo;
    await pool.query('UPDATE public.tqs_users SET activo = $1, updated_at = NOW() WHERE id = $2', [newActivo, req.params.id]);

    logActivity(req.user!.sub, req.user!.email, 'tqs_users', req.params.id, newActivo ? 'ACTIVATE' : 'DEACTIVATE', `Usuario ${resQuery.rows[0].nombre} ${newActivo ? 'activado' : 'desactivado'}`);
    logAudit(req.user!.sub, req.user!.email, req.ip, newActivo ? 'ACTIVATE_USER' : 'DEACTIVATE_USER', 'USERS', 'INFO', { email: resQuery.rows[0].email });

    res.json({ ok: true, activo: newActivo });
  } catch (err) {
    res.status(500).json({ error: 'Error al cambiar estado' });
  }
});

router.post('/:id/reset-password', authenticateToken, requireAuth, requireRole('admin', 'director'), validateBody(z.object({
  new_password: z.string().min(8),
})), async (req: AuthRequest, res: Response) => {
  const { new_password } = req.body;
  const pool = getPool();

  try {
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE public.auth_users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
    await pool.query('UPDATE public.tqs_users SET password_hash = $1, primer_login = false, updated_at = NOW() WHERE id = $2', [hash, req.params.id]);

    logAudit(req.user!.sub, req.user!.email, req.ip, 'ADMIN_RESET_PASSWORD', 'USERS', 'INFO', { targetUserId: req.params.id });

    res.json({ ok: true, message: 'Contraseña reiniciada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al reiniciar contraseña' });
  }
});

export default router;