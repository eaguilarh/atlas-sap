import { Router, Response } from 'express';
import { AuthRequest, authenticateToken, requireAuth, requireRole } from '../middleware/auth.js';
import { validateQuery, ALLOWED_COLUMNS } from '../middleware/validation.js';
import { getPool } from '../config/db.js';
import { z } from 'zod';

const router = Router();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  filters: z.string().optional(),
  nivel: z.string().optional(),
  modulo: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

function buildWhereClause(query: any, allowedCols: string[], paramIndex: number, params: any[]): { where: string; paramIndex: number } {
  let whereClause = '';
  let idx = paramIndex;

  if (query.nivel) {
    whereClause = 'WHERE nivel = $' + idx;
    params.push(query.nivel);
    idx++;
  }

  if (query.modulo) {
    whereClause = whereClause ? `${whereClause} AND modulo = $${idx}` : `WHERE modulo = $${idx}`;
    params.push(query.modulo);
    idx++;
  }

  if (query.search) {
    whereClause = whereClause ? `${whereClause} AND (mensaje ILIKE $${idx} OR modulo ILIKE $${idx})` : `WHERE mensaje ILIKE $${idx} OR modulo ILIKE $${idx}`;
    params.push(`%${query.search}%`);
    idx++;
  }

  if (query.filters) {
    try {
      const filterObj = JSON.parse(query.filters);
      for (const [key, value] of Object.entries(filterObj)) {
        if (allowedCols.includes(key) && value !== '') {
          whereClause = whereClause ? `${whereClause} AND ${key} = $${idx}` : `WHERE ${key} = $${idx}`;
          params.push(value);
          idx++;
        }
      }
    } catch {}
  }

  if (query.startDate) {
    whereClause = whereClause ? `${whereClause} AND created_at >= $${idx}` : `WHERE created_at >= $${idx}`;
    params.push(query.startDate);
    idx++;
  }

  if (query.endDate) {
    whereClause = whereClause ? `${whereClause} AND created_at <= $${idx}` : `WHERE created_at <= $${idx}`;
    params.push(query.endDate);
    idx++;
  }

  return { where: whereClause, paramIndex: idx };
}

router.get('/aplicacion', authenticateToken, requireAuth, requireRole('admin', 'director'), validateQuery(listQuerySchema), async (req: AuthRequest, res: Response) => {
  const { limit, offset, sort, order } = req.query as any;
  const pool = getPool();
  const params: any[] = [];

  const { where, paramIndex } = buildWhereClause(req.query, ALLOWED_COLUMNS.log_aplicacion, 1, params);

  const sortColumn = ALLOWED_COLUMNS.log_aplicacion.includes(sort) ? sort : 'created_at';
  const orderDirection = order === 'asc' ? 'ASC' : 'DESC';

  const countRes = await pool.query(`SELECT COUNT(*) FROM public.log_aplicacion ${where}`, params);
  const total = parseInt(countRes.rows[0].count, 10);

  params.push(limit, offset);
  const dataRes = await pool.query(
    `SELECT * FROM public.log_aplicacion ${where} ORDER BY ${sortColumn} ${orderDirection} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  res.json({ data: dataRes.rows, total, limit, offset });
});

router.get('/auditoria', authenticateToken, requireAuth, requireRole('admin', 'director'), validateQuery(listQuerySchema), async (req: AuthRequest, res: Response) => {
  const { limit, offset, sort, order } = req.query as any;
  const pool = getPool();
  const params: any[] = [];

  const { where, paramIndex } = buildWhereClause(req.query, ALLOWED_COLUMNS.log_auditoria, 1, params);

  const sortColumn = ALLOWED_COLUMNS.log_auditoria.includes(sort) ? sort : 'created_at';
  const orderDirection = order === 'asc' ? 'ASC' : 'DESC';

  const countRes = await pool.query(`SELECT COUNT(*) FROM public.log_auditoria ${where}`, params);
  const total = parseInt(countRes.rows[0].count, 10);

  params.push(limit, offset);
  const dataRes = await pool.query(
    `SELECT * FROM public.log_auditoria ${where} ORDER BY ${sortColumn} ${orderDirection} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  res.json({ data: dataRes.rows, total, limit, offset });
});

router.get('/actividades', authenticateToken, requireAuth, requireRole('admin', 'director'), validateQuery(listQuerySchema), async (req: AuthRequest, res: Response) => {
  const { limit, offset, sort, order } = req.query as any;
  const pool = getPool();
  const params: any[] = [];

  const { where, paramIndex } = buildWhereClause(req.query, ALLOWED_COLUMNS.log_actividades, 1, params);

  const sortColumn = ALLOWED_COLUMNS.log_actividades.includes(sort) ? sort : 'created_at';
  const orderDirection = order === 'asc' ? 'ASC' : 'DESC';

  const countRes = await pool.query(`SELECT COUNT(*) FROM public.log_actividades ${where}`, params);
  const total = parseInt(countRes.rows[0].count, 10);

  params.push(limit, offset);
  const dataRes = await pool.query(
    `SELECT * FROM public.log_actividades ${where} ORDER BY ${sortColumn} ${orderDirection} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  res.json({ data: dataRes.rows, total, limit, offset });
});

router.get('/sincronizacion', authenticateToken, requireAuth, requireRole('admin', 'director'), validateQuery(listQuerySchema), async (req: AuthRequest, res: Response) => {
  const { limit, offset, sort, order } = req.query as any;
  const pool = getPool();
  const params: any[] = [];

  const { where, paramIndex } = buildWhereClause(req.query, ALLOWED_COLUMNS.log_sincronizacion, 1, params);

  const sortColumn = ALLOWED_COLUMNS.log_sincronizacion.includes(sort) ? sort : 'created_at';
  const orderDirection = order === 'asc' ? 'ASC' : 'DESC';

  const countRes = await pool.query(`SELECT COUNT(*) FROM public.log_sincronizacion ${where}`, params);
  const total = parseInt(countRes.rows[0].count, 10);

  params.push(limit, offset);
  const dataRes = await pool.query(
    `SELECT * FROM public.log_sincronizacion ${where} ORDER BY ${sortColumn} ${orderDirection} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  res.json({ data: dataRes.rows, total, limit, offset });
});

router.get('/audit-failures', authenticateToken, requireAuth, requireRole('admin', 'director'), async (_req: AuthRequest, res: Response) => {
  const { getAuditFailureCount } = await import('../services/audit.js');
  res.json({ auditFailureCount: getAuditFailureCount() });
});

export default router;