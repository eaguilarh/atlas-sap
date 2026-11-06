import { Pool } from 'pg';
import { getPool } from '../config/db.js';
import pino from 'pino';

const logger = pino({ name: 'audit' });

export interface AuditLogParams {
  usuarioId: string | null;
  usuarioEmail: string | null;
  ipAddress: string;
  accion: string;
  modulo?: string;
  nivel?: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  detalles?: Record<string, unknown>;
}

export interface ActivityLogParams {
  usuarioId: string | null;
  usuarioEmail: string | null;
  entidad: string;
  entidadId: string;
  accion: string;
  resumen: string;
  cambios?: Record<string, unknown>;
}

export interface AppLogParams {
  nivel: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  modulo: string;
  mensaje: string;
  stackTrace?: string | null;
  requestInfo?: Record<string, unknown>;
}

let auditFailureCount = 0;

export async function logAudit(params: AuditLogParams): Promise<void> {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO public.log_auditoria (usuario_id, usuario_email, ip_address, accion, modulo, nivel, detalles)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.usuarioId,
        params.usuarioEmail,
        params.ipAddress,
        params.accion,
        params.modulo || 'AUTH',
        params.nivel || 'INFO',
        JSON.stringify(params.detalles || {}),
      ]
    );
  } catch (err) {
    auditFailureCount++;
    logger.error({ err: (err as Error).message, ...params, stack: (err as Error).stack }, 'LOG_AUDIT_FAIL - AUDIT LOST');
  }
  logger.info(params, 'Audit log');
}

export async function logActivity(params: ActivityLogParams): Promise<void> {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO public.log_actividades (usuario_id, usuario_email, entidad, entidad_id, accion, resumen, cambios)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.usuarioId,
        params.usuarioEmail,
        params.entidad,
        params.entidadId,
        params.accion,
        params.resumen,
        JSON.stringify(params.cambios || {}),
      ]
    );
  } catch (err) {
    auditFailureCount++;
    logger.error({ err: (err as Error).message, ...params, stack: (err as Error).stack }, 'LOG_ACTIVITY_FAIL - AUDIT LOST');
  }
  logger.info(params, 'Activity log');
}

export async function logApp(params: AppLogParams): Promise<void> {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO public.log_aplicacion (nivel, modulo, mensaje, stack_trace, request_info)
       VALUES ($1, $2, $3, $4, $5)`,
      [params.nivel, params.modulo, params.mensaje, params.stackTrace || null, JSON.stringify(params.requestInfo || {})]
    );
  } catch (err) {
    auditFailureCount++;
    logger.error({ err: (err as Error).message, ...params, stack: (err as Error).stack }, 'LOG_APP_FAIL - AUDIT LOST');
  }

  const logData = { modulo: params.modulo, mensaje: params.mensaje, stackTrace: params.stackTrace, requestInfo: params.requestInfo };
  if (params.nivel === 'ERROR' || params.nivel === 'CRITICAL') {
    logger.error(logData, 'Application log');
  } else if (params.nivel === 'WARN') {
    logger.warn(logData, 'Application log');
  } else {
    logger.info(logData, 'Application log');
  }
}

export function getAuditFailureCount(): number {
  return auditFailureCount;
}