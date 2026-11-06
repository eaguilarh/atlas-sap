-- ============================================================
-- ATLAS SAP Operations Suite — Archivo y Purga de Logs
-- Retención: Mueve registros mayores a 90 días a tablas de archivo
-- y libera espacio físico con VACUUM.
-- ============================================================

BEGIN;

-- 1. Tabla de Archivo para Auditoría
CREATE TABLE IF NOT EXISTS public.archive_log_auditoria (
    LIKE public.log_auditoria INCLUDING ALL
);

-- 2. Mover registros mayores a 90 días
WITH moved AS (
    DELETE FROM public.log_auditoria
    WHERE fecha < NOW() - INTERVAL '90 days'
    RETURNING *
)
INSERT INTO public.archive_log_auditoria
SELECT * FROM moved;

-- 3. Tabla de Archivo para Actividades
CREATE TABLE IF NOT EXISTS public.archive_log_actividades (
    LIKE public.log_actividades INCLUDING ALL
);

WITH moved_act AS (
    DELETE FROM public.log_actividades
    WHERE fecha < NOW() - INTERVAL '90 days'
    RETURNING *
)
INSERT INTO public.archive_log_actividades
SELECT * FROM moved_act;

-- 4. Purga de logs temporales de aplicación y sincronización (> 60 días)
DELETE FROM public.log_aplicacion
WHERE created_at < NOW() - INTERVAL '60 days';

DELETE FROM public.log_sincronizacion
WHERE fecha_sincronizacion < NOW() - INTERVAL '60 days';

COMMIT;

-- 5. Mantenimiento y optimización de índices
VACUUM ANALYZE public.log_auditoria;
VACUUM ANALYZE public.log_actividades;
VACUUM ANALYZE public.log_aplicacion;
VACUUM ANALYZE public.log_sincronizacion;

