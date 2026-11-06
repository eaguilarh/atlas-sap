-- Migración: Soft delete para RFCs y Solicitudes
-- Ejecutar con: npm run db:migrate

-- Agregar columna deleted_at a rfcs si no existe
ALTER TABLE public.rfcs 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Agregar columna deleted_at a solicitudes si no existe
ALTER TABLE public.solicitudes 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Índices para soft delete
CREATE INDEX IF NOT EXISTS idx_rfcs_deleted_at ON public.rfcs(deleted_at) 
WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_solicitudes_deleted_at ON public.solicitudes(deleted_at) 
WHERE deleted_at IS NOT NULL;

-- Vista para RFCs activos (no eliminados)
CREATE OR REPLACE VIEW public.v_rfcs_activos AS
SELECT * FROM public.rfcs WHERE deleted_at IS NULL;

-- Vista para Solicitudes activas (no eliminadas)
CREATE OR REPLACE VIEW public.v_solicitudes_activas AS
SELECT * FROM public.solicitudes WHERE deleted_at IS NULL;

-- Trigger para updated_at automático en tqs_users
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_tqs_users_updated_at ON public.tqs_users;
CREATE TRIGGER update_tqs_users_updated_at
  BEFORE UPDATE ON public.tqs_users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_sistemas_updated_at ON public.sistemas;
CREATE TRIGGER update_sistemas_updated_at
  BEFORE UPDATE ON public.sistemas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_rfcs_updated_at ON public.rfcs;
CREATE TRIGGER update_rfcs_updated_at
  BEFORE UPDATE ON public.rfcs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_solicitudes_updated_at ON public.solicitudes;
CREATE TRIGGER update_solicitudes_updated_at
  BEFORE UPDATE ON public.solicitudes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_candidatos_updated_at ON public.candidatos;
CREATE TRIGGER update_candidatos_updated_at
  BEFORE UPDATE ON public.candidatos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();