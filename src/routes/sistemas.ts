import { Router, Response } from 'express';
import { AuthRequest, authenticateToken, requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateQuery, sistemasInsertSchema, ALLOWED_COLUMNS } from '../middleware/validation.js';
import { getPool } from '../config/db.js';
import { logActivity, logAudit } from '../services/audit.js';
import { z } from 'zod';

const router = Router();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  filters: z.string().optional(),
});

router.get('/', authenticateToken, requireAuth, validateQuery(listQuerySchema), async (req: AuthRequest, res: Response) => {
  const { limit, offset, search, sort, order, filters } = req.query as any;
  const pool = getPool();

  try {
    let whereClause = '';
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause = 'WHERE nombre ILIKE $1';
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (filters) {
      try {
        const filterObj = JSON.parse(filters);
        const filterClause = Object.entries(filterObj)
          .filter(([k, v]) => ALLOWED_COLUMNS.sistemas.includes(k) && v !== '')
          .map(([k]) => `${k} = $${paramIndex++}`)
          .join(' AND ');
        if (filterClause) {
          whereClause = whereClause ? `${whereClause} AND ${filterClause}` : `WHERE ${filterClause}`;
          for (const [, v] of Object.entries(filterObj)) {
            if (ALLOWED_COLUMNS.sistemas.includes(v as string)) params.push(v);
          }
        }
      } catch {}
    }

    const sortColumn = ALLOWED_COLUMNS.sistemas.includes(sort) ? sort : 'nombre';
    const orderDirection = order === 'asc' ? 'ASC' : 'DESC';

    const countRes = await pool.query(`SELECT COUNT(*) FROM public.sistemas ${whereClause}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const dataRes = await pool.query(
      `SELECT * FROM public.sistemas ${whereClause} ORDER BY ${sortColumn} ${orderDirection} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    res.json({ data: dataRes.rows, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener sistemas' });
  }
});

router.post('/', authenticateToken, requireAuth, requireRole('admin', 'director'), validateBody(sistemasInsertSchema), async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  try {
    const data = req.body;
    const columns = Object.keys(data).filter(k => ALLOWED_COLUMNS.sistemas.includes(k));
    const values = columns.map(c => data[c]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

    const resInsert = await pool.query(
      `INSERT INTO public.sistemas (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );

    const created = resInsert.rows[0];

    logActivity(req.user!.sub, req.user!.email, 'sistemas', created.id, 'CREATE', `Sistema ${created.nombre} creado`, { nombre: created.nombre });
    logAudit(req.user!.sub, req.user!.email, req.ip, 'CREATE_SISTEMA', 'SISTEMAS', 'INFO', { nombre: created.nombre });

    res.status(201).json(created);
  } catch (err) {
    if ((err as any).code === '23505') {
      res.status(400).json({ error: 'Sistema ya existe' });
      return;
    }
    res.status(500).json({ error: 'Error al crear sistema' });
  }
});

router.get('/:id', authenticateToken, requireAuth, async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  try {
    const resQuery = await pool.query('SELECT * FROM public.sistemas WHERE id = $1', [req.params.id]);
    if (resQuery.rows.length === 0) {
      res.status(404).json({ error: 'Sistema no encontrado' });
      return;
    }
    res.json(resQuery.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener sistema' });
  }
});

router.patch('/:id', authenticateToken, requireAuth, requireRole('admin', 'director'), validateBody(sistemasInsertSchema.partial()), async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const oldRes = await client.query('SELECT * FROM public.sistemas WHERE id = $1', [req.params.id]);
    if (oldRes.rows.length === 0) {
      res.status(404).json({ error: 'Sistema no encontrado' });
      return;
    }
    const old = oldRes.rows[0];

    const data = req.body;
    const columns = Object.keys(data).filter(k => ALLOWED_COLUMNS.sistemas.includes(k) && k !== 'id' && k !== 'created_at');
    if (columns.length === 0) {
      res.status(400).json({ error: 'No hay campos válidos para actualizar' });
      return;
    }

    const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const values = [...columns.map(c => data[c]), req.params.id];

    const updRes = await client.query(
      `UPDATE public.sistemas SET ${setClause}, updated_at = NOW() WHERE id = $${columns.length + 1} RETURNING *`,
      values
    );

    const updated = updRes.rows[0];
    await client.query('COMMIT');

    const cambios: Record<string, { old: any; new: any }> = {};
    for (const col of columns) {
      if (old[col] !== updated[col]) {
        cambios[col] = { old: old[col], new: updated[col] };
      }
    }

    logActivity(req.user!.sub, req.user!.email, 'sistemas', req.params.id, 'UPDATE', `Sistema ${updated.nombre} actualizado`, cambios);
    logAudit(req.user!.sub, req.user!.email, req.ip, 'UPDATE_SISTEMA', 'SISTEMAS', 'INFO', { nombre: updated.nombre, cambios });

    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as any).code === '23505') {
      res.status(400).json({ error: 'Sistema ya existe' });
      return;
    }
    res.status(500).json({ error: 'Error al actualizar sistema' });
  } finally {
    client.release();
  }
});

router.delete('/:id', authenticateToken, requireAuth, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const pool = getPool();
  try {
    const resQuery = await pool.query('SELECT nombre FROM public.sistemas WHERE id = $1', [req.params.id]);
    if (resQuery.rows.length === 0) {
      res.status(404).json({ error: 'Sistema no encontrado' });
      return;
    }

    await pool.query('DELETE FROM public.sistemas WHERE id = $1', [req.params.id]);

    logActivity(req.user!.sub, req.user!.email, 'sistemas', req.params.id, 'DELETE', `Sistema ${resQuery.rows[0].nombre} eliminado`);
    logAudit(req.user!.sub, req.user!.email, req.ip, 'DELETE_SISTEMA', 'SISTEMAS', 'WARN', { nombre: resQuery.rows[0].nombre });

    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar sistema' });
  }
});

export default router;