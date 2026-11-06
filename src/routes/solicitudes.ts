import { Router, Response } from 'express';
import { AuthRequest, authenticateToken, requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateQuery, solicitudesInsertSchema, ALLOWED_COLUMNS } from '../middleware/validation.js';
import { getPool } from '../config/db.js';
import { logActivity, logAudit } from '../services/audit.js';
import { z } from 'zod';

const router = Router();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  filters: z.string().optional(),
});

router.get('/', authenticateToken, requireAuth, validateQuery(listQuerySchema), async (req: AuthRequest, res: Response) => {
  const { limit, offset, search, sort, order, filters } = req.query as any;
  const pool = getPool();

  try {
    let whereClause = 'WHERE deleted_at IS NULL';
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause += ` AND (ticket ILIKE $${paramIndex} OR titulo ILIKE $${paramIndex} OR descripcion ILIKE $${paramIndex} OR responsable ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (filters) {
      try {
        const filterObj = JSON.parse(filters);
        for (const [key, value] of Object.entries(filterObj)) {
          if (ALLOWED_COLUMNS.solicitudes.includes(key) && value !== '') {
            whereClause += ` AND ${key} = $${paramIndex}`;
            params.push(value);
            paramIndex++;
          }
        }
      } catch {}
    }

    const sortColumn = ALLOWED_COLUMNS.solicitudes.includes(sort) ? sort : 'created_at';
    const orderDirection = order === 'asc' ? 'ASC' : 'DESC';

    const countRes = await pool.query(`SELECT COUNT(*) FROM public.solicitudes ${whereClause}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const dataRes = await pool.query(
      `SELECT * FROM public.solicitudes ${whereClause} ORDER BY ${sortColumn} ${orderDirection} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    res.json({ data: dataRes.rows, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener solicitudes' });
  }
});

router.post('/', authenticateToken, requireAuth, validateBody(solicitudesInsertSchema), async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const data = req.body;
    const columns = Object.keys(data).filter(k => ALLOWED_COLUMNS.solicitudes.includes(k));
    const values = columns.map(c => data[c]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

    const resInsert = await client.query(
      `INSERT INTO public.solicitudes (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );

    const created = resInsert.rows[0];

    if (data.tqs_ids && data.tqs_ids.length > 0) {
      await client.query('DELETE FROM public.solicitud_tqs WHERE solicitud_id = $1', [created.id]);
      for (const tqsId of data.tqs_ids) {
        await client.query('INSERT INTO public.solicitud_tqs (solicitud_id, tqs_id) VALUES ($1, $2)', [created.id, tqsId]);
      }
    }

    await client.query('COMMIT');

    logActivity(req.user!.sub, req.user!.email, 'solicitudes', created.id, 'CREATE', `Solicitud ${created.ticket} creada`, { ticket: created.ticket });
    logAudit(req.user!.sub, req.user!.email, req.ip, 'CREATE_SOLICITUD', 'SOLICITUDES', 'INFO', { ticket: created.ticket });

    res.status(201).json(created);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al crear solicitud' });
  } finally {
    client.release();
  }
});

router.get('/:id', authenticateToken, requireAuth, async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  try {
    const resQuery = await pool.query('SELECT * FROM public.solicitudes WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (resQuery.rows.length === 0) {
      res.status(404).json({ error: 'Solicitud no encontrada' });
      return;
    }

    const tqsRes = await pool.query('SELECT tqs_id FROM public.solicitud_tqs WHERE solicitud_id = $1', [req.params.id]);
    const result = { ...resQuery.rows[0], tqs_ids: tqsRes.rows.map(r => r.tqs_id) };
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener solicitud' });
  }
});

router.patch('/:id', authenticateToken, requireAuth, validateBody(solicitudesInsertSchema.partial()), async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const oldRes = await client.query('SELECT * FROM public.solicitudes WHERE id = $1', [req.params.id]);
    if (oldRes.rows.length === 0) {
      res.status(404).json({ error: 'Solicitud no encontrada' });
      return;
    }
    const old = oldRes.rows[0];

    const data = req.body;
    const columns = Object.keys(data).filter(k => ALLOWED_COLUMNS.solicitudes.includes(k) && k !== 'id' && k !== 'created_at');
    if (columns.length === 0) {
      res.status(400).json({ error: 'No hay campos válidos para actualizar' });
      return;
    }

    const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const values = [...columns.map(c => data[c]), req.params.id];

    const updRes = await client.query(
      `UPDATE public.solicitudes SET ${setClause}, updated_at = NOW() WHERE id = $${columns.length + 1} RETURNING *`,
      values
    );

    const updated = updRes.rows[0];

    if (data.tqs_ids !== undefined) {
      await client.query('DELETE FROM public.solicitud_tqs WHERE solicitud_id = $1', [req.params.id]);
      if (data.tqs_ids.length > 0) {
        for (const tqsId of data.tqs_ids) {
          await client.query('INSERT INTO public.solicitud_tqs (solicitud_id, tqs_id) VALUES ($1, $2)', [req.params.id, tqsId]);
        }
      }
    }

    await client.query('COMMIT');

    const cambios: Record<string, { old: any; new: any }> = {};
    for (const col of columns) {
      if (old[col] !== updated[col]) {
        cambios[col] = { old: old[col], new: updated[col] };
      }
    }

    logActivity(req.user!.sub, req.user!.email, 'solicitudes', req.params.id, 'UPDATE', `Solicitud ${updated.ticket} actualizada`, cambios);
    logAudit(req.user!.sub, req.user!.email, req.ip, 'UPDATE_SOLICITUD', 'SOLICITUDES', 'INFO', { ticket: updated.ticket, cambios });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al actualizar solicitud' });
  } finally {
    client.release();
  }
});

router.delete('/:id', authenticateToken, requireAuth, requireRole('admin', 'tqs_leader'), async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  try {
    const resQuery = await pool.query('SELECT ticket FROM public.solicitudes WHERE id = $1', [req.params.id]);
    if (resQuery.rows.length === 0) {
      res.status(404).json({ error: 'Solicitud no encontrada' });
      return;
    }

    await pool.query('UPDATE public.solicitudes SET deleted_at = NOW() WHERE id = $1', [req.params.id]);

    logActivity(req.user!.sub, req.user!.email, 'solicitudes', req.params.id, 'DELETE', `Solicitud ${resQuery.rows[0].ticket} eliminada`);
    logAudit(req.user!.sub, req.user!.email, req.ip, 'DELETE_SOLICITUD', 'SOLICITUDES', 'WARN', { ticket: resQuery.rows[0].ticket });

    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar solicitud' });
  }
});

export default router;