import { Router, Response } from 'express';
import { AuthRequest, authenticateToken, requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams, rfcsInsertSchema, ALLOWED_COLUMNS, ALLOWED_TABLES, tableSchemas } from '../middleware/validation.js';
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
      whereClause += ` AND (ticket ILIKE $${paramIndex} OR descripcion ILIKE $${paramIndex} OR promotor ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (filters) {
      try {
        const filterObj = JSON.parse(filters);
        for (const [key, value] of Object.entries(filterObj)) {
          if (ALLOWED_COLUMNS.rfcs.includes(key) && value !== '') {
            whereClause += ` AND ${key} = $${paramIndex}`;
            params.push(value);
            paramIndex++;
          }
        }
      } catch {
        // ignore invalid filters
      }
    }

    const sortColumn = ALLOWED_COLUMNS.rfcs.includes(sort) ? sort : 'created_at';
    const orderDirection = order === 'asc' ? 'ASC' : 'DESC';

    const countRes = await pool.query(`SELECT COUNT(*) FROM public.rfcs ${whereClause}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const dataRes = await pool.query(
      `SELECT * FROM public.rfcs ${whereClause} ORDER BY ${sortColumn} ${orderDirection} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    res.json({ data: dataRes.rows, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener RFCs' });
  }
});

router.post('/', authenticateToken, requireAuth, validateBody(rfcsInsertSchema), async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const data = req.body;
    const columns = Object.keys(data).filter(k => ALLOWED_COLUMNS.rfcs.includes(k));
    const values = columns.map(c => data[c]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

    const resInsert = await client.query(
      `INSERT INTO public.rfcs (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );

    const created = resInsert.rows[0];

    if (data.tqs_ids && data.tqs_ids.length > 0) {
      await client.query('DELETE FROM public.rfc_tqs WHERE rfc_id = $1', [created.id]);
      for (const tqsId of data.tqs_ids) {
        await client.query('INSERT INTO public.rfc_tqs (rfc_id, tqs_id) VALUES ($1, $2)', [created.id, tqsId]);
      }
    }

    await client.query('COMMIT');

    logActivity(req.user!.sub, req.user!.email, 'rfcs', created.id, 'CREATE', `RFC ${created.ticket} creado`, { ticket: created.ticket });
    logAudit(req.user!.sub, req.user!.email, req.ip, 'CREATE_RFC', 'RFCS', 'INFO', { ticket: created.ticket });

    res.status(201).json(created);
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as any).code === '23505') {
      res.status(400).json({ error: 'Ticket duplicado para este sistema' });
      return;
    }
    res.status(500).json({ error: 'Error al crear RFC' });
  } finally {
    client.release();
  }
});

router.get('/:id', authenticateToken, requireAuth, async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  try {
    const resQuery = await pool.query('SELECT * FROM public.rfcs WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (resQuery.rows.length === 0) {
      res.status(404).json({ error: 'RFC no encontrado' });
      return;
    }

    const tqsRes = await pool.query('SELECT tqs_id FROM public.rfc_tqs WHERE rfc_id = $1', [req.params.id]);
    const result = { ...resQuery.rows[0], tqs_ids: tqsRes.rows.map(r => r.tqs_id) };
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener RFC' });
  }
});

router.patch('/:id', authenticateToken, requireAuth, validateBody(rfcsInsertSchema.partial()), async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const oldRes = await client.query('SELECT * FROM public.rfcs WHERE id = $1', [req.params.id]);
    if (oldRes.rows.length === 0) {
      res.status(404).json({ error: 'RFC no encontrado' });
      return;
    }
    const old = oldRes.rows[0];

    const data = req.body;
    const columns = Object.keys(data).filter(k => ALLOWED_COLUMNS.rfcs.includes(k) && k !== 'id' && k !== 'created_at');
    if (columns.length === 0) {
      res.status(400).json({ error: 'No hay campos válidos para actualizar' });
      return;
    }

    const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const values = [...columns.map(c => data[c]), req.params.id];

    const updRes = await client.query(
      `UPDATE public.rfcs SET ${setClause}, updated_at = NOW() WHERE id = $${columns.length + 1} RETURNING *`,
      values
    );

    const updated = updRes.rows[0];

    if (data.tqs_ids !== undefined) {
      await client.query('DELETE FROM public.rfc_tqs WHERE rfc_id = $1', [req.params.id]);
      if (data.tqs_ids.length > 0) {
        for (const tqsId of data.tqs_ids) {
          await client.query('INSERT INTO public.rfc_tqs (rfc_id, tqs_id) VALUES ($1, $2)', [req.params.id, tqsId]);
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

    logActivity(req.user!.sub, req.user!.email, 'rfcs', req.params.id, 'UPDATE', `RFC ${updated.ticket} actualizado`, cambios);
    logAudit(req.user!.sub, req.user!.email, req.ip, 'UPDATE_RFC', 'RFCS', 'INFO', { ticket: updated.ticket, cambios });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as any).code === '23505') {
      res.status(400).json({ error: 'Ticket duplicado para este sistema' });
      return;
    }
    res.status(500).json({ error: 'Error al actualizar RFC' });
  } finally {
    client.release();
  }
});

router.delete('/:id', authenticateToken, requireAuth, requireRole('admin', 'tqs_leader'), async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  try {
    const resQuery = await pool.query('SELECT ticket FROM public.rfcs WHERE id = $1', [req.params.id]);
    if (resQuery.rows.length === 0) {
      res.status(404).json({ error: 'RFC no encontrado' });
      return;
    }

    await pool.query('UPDATE public.rfcs SET deleted_at = NOW() WHERE id = $1', [req.params.id]);

    logActivity(req.user!.sub, req.user!.email, 'rfcs', req.params.id, 'DELETE', `RFC ${resQuery.rows[0].ticket} eliminado`);
    logAudit(req.user!.sub, req.user!.email, req.ip, 'DELETE_RFC', 'RFCS', 'WARN', { ticket: resQuery.rows[0].ticket });

    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar RFC' });
  }
});

export default router;