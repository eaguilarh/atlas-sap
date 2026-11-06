import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import { sanitize } from '../utils/index.js';

export interface ValidationRequest extends Request {
  sanitizedBody?: any;
}

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: ValidationRequest, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Datos inválidos', details: result.error.flatten() });
      return;
    }
    req.body = result.data;
    req.sanitizedBody = sanitize(result.data);
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({ error: 'Query parameters inválidos', details: result.error.flatten() });
      return;
    }
    req.query = result.data as any;
    next();
  };
}

export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res.status(400).json({ error: 'Parámetros de ruta inválidos', details: result.error.flatten() });
      return;
    }
    req.params = result.data as any;
    next();
  };
}

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  options: z.object({
    data: z.object({
      nombre: z.string().optional(),
      rol: z.string().optional(),
      sistemas: z.array(z.string()).optional(),
      siguiendo_tqs: z.array(z.string().uuid()).optional(),
      backup_tqs_id: z.string().uuid().nullable().optional(),
    }).passthrough().optional(),
  }).optional(),
});

export const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export const passwordSchema = z.object({
  password: z.string().min(8),
});

export const recoverSchema = z.object({
  email: z.string().email(),
  method: z.enum(['security_question', 'admin_reset']).optional(),
  security_answer: z.string().optional(),
  admin_user_id: z.string().uuid().optional(),
});

export const resetPasswordSchema = z.object({
  email: z.string().email(),
  reset_code: z.string().min(4),
  new_password: z.string().min(8),
});

export const securityQuestionSchema = z.object({
  user_id: z.string().uuid(),
  question_id: z.string(),
  answer_hash: z.string(),
});

export const adminUserSchema = z.object({
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

export const rfcsInsertSchema = z.object({
  ticket: z.string().min(1),
  tipo: z.string().nullable().optional(),
  ambiente: z.string().nullable().optional(),
  fecha: z.string().min(1),
  fecha_fin: z.string().nullable().optional(),
  fecha_fin_retorno: z.string().nullable().optional(),
  sistema_name: z.string().nullable().optional(),
  sistema_grupo: z.string().nullable().optional(),
  sid: z.string().nullable().optional(),
  promotor: z.string().nullable().optional(),
  coordinador_kof: z.string().nullable().optional(),
  descripcion: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  hora_inicio: z.string().nullable().optional(),
  hora_fin: z.string().nullable().optional(),
  hora_fin_retorno: z.string().nullable().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  tqs_ids: z.array(z.string().uuid()).nullable().optional(),
});

export const solicitudesInsertSchema = z.object({
  tipo: z.enum(['KIT', 'Incidente', 'RCA', 'Requerimiento', 'Actividad']),
  origen: z.enum(['DXC', 'KOF']).nullable().optional(),
  fecha_inicio: z.string().min(1),
  sistema_sap: z.string().nullable().optional(),
  responsable: z.string().nullable().optional(),
  estatus: z.string().nullable().optional(),
  descripcion: z.string().nullable().optional(),
  titulo: z.string().nullable().optional(),
  action_items: z.array(z.any()).nullable().optional(),
  bitacora: z.array(z.any()).nullable().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  tqs_ids: z.array(z.string().uuid()).nullable().optional(),
});

export const sistemasInsertSchema = z.object({
  nombre: z.string().min(1),
  infraestructura: z.enum(['OnPremise', 'Azure']).nullable().optional(),
  tipo_sap: z.enum(['SAP', 'No SAP']).nullable().optional(),
  criticidad: z.number().int().min(1).max(3).nullable().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  backup_id: z.string().uuid().nullable().optional(),
  activo: z.boolean().nullable().optional(),
});

export const ALLOWED_COLUMNS: Record<string, string[]> = {
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

export const ALLOWED_TABLES = [
  'rfcs', 'solicitudes', 'tqs_users', 'sistemas',
  'log_aplicacion', 'log_auditoria', 'log_actividades', 'log_sincronizacion',
];

export const tableSchemas = {
  rfcs: rfcsInsertSchema,
  solicitudes: solicitudesInsertSchema,
  sistemas: sistemasInsertSchema,
} as const;