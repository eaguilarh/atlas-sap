-- ============================================================
-- ATLAS SAP OPERATIONS SUITE — SCHEMA COMPLETO POSTGRESQL v3.0
-- Proyecto: ATLAS Local / Proxmox (Arquitectura OnPremise)
-- ============================================================

-- 0. EXTENSIONES REQUERIDAS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TABLA DE CREDENCIALES LOCALES (Reemplazo de auth.users)
CREATE TABLE IF NOT EXISTS public.auth_users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT NOT NULL UNIQUE,
  password_hash      TEXT NOT NULL,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- 1.1 TABLA DE REFRESH TOKENS
CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  created_ip  VARCHAR(45),
  revoked_at  TIMESTAMPTZ,
  revoked_ip  VARCHAR(45)
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON public.refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON public.refresh_tokens(token_hash);

-- 2. TABLA DE PERFILES DE USUARIOS (tqs_users)
CREATE TABLE IF NOT EXISTS public.tqs_users (
  id            UUID PRIMARY KEY REFERENCES public.auth_users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  rol           TEXT NOT NULL DEFAULT 'fte' CHECK (rol IN ('admin','tqs_leader','fte','director','guardia')),
  sistemas      TEXT[] DEFAULT '{}',
  siguiendo_tqs UUID[] DEFAULT '{}',
  backup_tqs_id UUID REFERENCES public.tqs_users(id) ON DELETE SET NULL,
  primer_login  BOOLEAN DEFAULT TRUE,
  activo        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Migraciones para bases de datos existentes:
ALTER TABLE public.tqs_users DROP CONSTRAINT IF EXISTS tqs_users_rol_check;
ALTER TABLE public.tqs_users ADD CONSTRAINT tqs_users_rol_check CHECK (rol IN ('admin','tqs_leader','fte','director','guardia'));


-- 2.1 TABLA DE SISTEMAS Y ATRIBUTOS OPERATIVOS (sistemas)
CREATE TABLE IF NOT EXISTS public.sistemas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          TEXT NOT NULL,
  infraestructura TEXT DEFAULT 'OnPremise' CHECK (infraestructura IN ('OnPremise', 'Azure', 'Ambos')),
  tipo_sap        TEXT DEFAULT 'SAP' CHECK (tipo_sap IN ('SAP', 'No SAP')),
  criticidad      INT DEFAULT 1 CHECK (criticidad IN (1, 2, 3)), -- 3: Muy Crítico, 2: Medio, 1: Baja Criticidad
  owner_id        UUID REFERENCES public.tqs_users(id) ON DELETE SET NULL, -- TQS Titular
  backup_id       UUID REFERENCES public.tqs_users(id) ON DELETE SET NULL, -- TQS Backup
  activo          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT sistemas_nombre_infra_key UNIQUE (nombre, infraestructura)
);

ALTER TABLE public.sistemas DROP CONSTRAINT IF EXISTS sistemas_nombre_owner_key;
ALTER TABLE public.sistemas DROP CONSTRAINT IF EXISTS sistemas_nombre_key;
ALTER TABLE public.sistemas DROP CONSTRAINT IF EXISTS sistemas_nombre_infra_key;
ALTER TABLE public.sistemas ADD CONSTRAINT sistemas_nombre_infra_key UNIQUE (nombre, infraestructura);
ALTER TABLE public.sistemas DROP CONSTRAINT IF EXISTS sistemas_infraestructura_check;
ALTER TABLE public.sistemas ADD CONSTRAINT sistemas_infraestructura_check CHECK (infraestructura IN ('OnPremise', 'Azure', 'Ambos'));

-- 3. TABLA DE RFCs (rfcs)
CREATE TABLE IF NOT EXISTS public.rfcs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                TEXT DEFAULT 'RFC',
  ambiente            TEXT,
  infraestructura     TEXT DEFAULT 'OnPremise',
  ticket              TEXT NOT NULL,
  fecha               DATE NOT NULL,
  fecha_fin           DATE,
  fecha_fin_retorno   DATE,
  sistema_name        TEXT NOT NULL,
  sistema_grupo       TEXT,
  sid                 TEXT,
  promotor            TEXT,
  coordinador_kof     TEXT,
  descripcion         TEXT,
  observaciones       TEXT,
  status              TEXT DEFAULT 'En espera de VOBO',
  hora_inicio         TEXT,
  hora_fin            TEXT,
  hora_fin_retorno    TEXT,
  owner_id            UUID NOT NULL REFERENCES public.tqs_users(id) ON DELETE CASCADE,
  tqs_ids             UUID[] DEFAULT '{}', -- TQS Colaboradores (UUIDs)
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);
ALTER TABLE public.rfcs ADD COLUMN IF NOT EXISTS infraestructura TEXT DEFAULT 'OnPremise';
ALTER TABLE public.rfcs ADD COLUMN IF NOT EXISTS coordinador_kof TEXT;
ALTER TABLE public.rfcs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
UPDATE public.rfcs SET infraestructura = ambiente WHERE ambiente IS NOT NULL AND (infraestructura IS NULL OR infraestructura = 'OnPremise');
ALTER TABLE public.rfcs DROP CONSTRAINT IF EXISTS rfcs_ticket_key;
ALTER TABLE public.rfcs ADD CONSTRAINT rfcs_ticket_key UNIQUE (ticket);
ALTER TABLE public.rfcs DROP CONSTRAINT IF EXISTS rfcs_status_check;
ALTER TABLE public.rfcs ADD CONSTRAINT rfcs_status_check CHECK (status IN ('En espera de VOBO', 'En espera', 'Pendiente', 'PENDIENTE', 'En Ejecución', 'En ejecución', 'En ejecucion', 'En Proceso', 'En proceso', 'EN_PROCESO', 'Finalizado con éxito', 'Finalizado con exito', 'Finalizado', 'Exitoso', 'Completado', 'COMPLETADO', 'Finalizado sin éxito', 'Finalizado sin exito', 'Fallido', 'Aprobado', 'APROBADO', 'Cancelado', 'CANCELADO', 'Reprogramar', 'Reprogramado', 'REPROGRAMADO', 'Borrador'));

-- 4. TABLA DE SOLICITUDES OPERATIVAS (solicitudes)
CREATE TABLE IF NOT EXISTS public.solicitudes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            TEXT NOT NULL CHECK (tipo IN ('KIT', 'Incidente', 'RCA', 'Requerimiento', 'Actividad')),
  origen          TEXT DEFAULT 'EAS' CHECK (origen IN ('EAS', 'KOF')),
  fecha_inicio    DATE NOT NULL,
  sistema_sap     TEXT,
  responsable     TEXT,
  estatus         TEXT DEFAULT 'En espera de autorización' CHECK (estatus IN ('En espera de autorización','Aprobado','En proceso','Re-asignado','Cerrado','Cancelado')),
  tqs_ids         UUID[] DEFAULT '{}', -- TQS Leaders asignados (UUIDs)
  action_items    JSONB DEFAULT '[]'::jsonb, -- Action items asociados
  bitacora        JSONB DEFAULT '[]'::jsonb, -- Log de seguimiento / bitácora de entradas
  owner_id        UUID NOT NULL REFERENCES public.tqs_users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
ALTER TABLE public.solicitudes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.solicitudes ADD COLUMN IF NOT EXISTS ticket TEXT;
ALTER TABLE public.solicitudes ADD COLUMN IF NOT EXISTS descripcion TEXT;
ALTER TABLE public.solicitudes ADD COLUMN IF NOT EXISTS ambiente TEXT;
ALTER TABLE public.solicitudes ADD COLUMN IF NOT EXISTS estatus_historial JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.solicitudes DROP CONSTRAINT IF EXISTS solicitudes_tipo_check;
ALTER TABLE public.solicitudes ADD CONSTRAINT solicitudes_tipo_check CHECK (tipo IN ('KIT', 'Incidente', 'RCA', 'Requerimiento', 'Actividad'));


-- 5. LOGS DE SISTEMA, AUDITORÍA Y ACTIVIDADES
CREATE TABLE IF NOT EXISTS public.log_sincronizacion (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha         TIMESTAMPTZ DEFAULT NOW(),
  tipo_error    TEXT NOT NULL,
  detalle       TEXT
);

-- Logs de Aplicación (Errores, Excepciones, Latencia, Diagnóstico)
CREATE TABLE IF NOT EXISTS public.log_aplicacion (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha         TIMESTAMPTZ DEFAULT NOW(),
  nivel         TEXT NOT NULL DEFAULT 'INFO' CHECK (nivel IN ('INFO', 'WARN', 'ERROR', 'FATAL')),
  modulo        TEXT NOT NULL DEFAULT 'SERVER',
  mensaje       TEXT NOT NULL,
  stack_trace   TEXT,
  request_info  JSONB DEFAULT '{}'::jsonb
);

-- Logs de Auditoría (Seguridad, Login, Administración de Usuarios y Permisos)
CREATE TABLE IF NOT EXISTS public.log_auditoria (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha         TIMESTAMPTZ DEFAULT NOW(),
  usuario_id    UUID REFERENCES public.tqs_users(id) ON DELETE SET NULL,
  usuario_email TEXT,
  ip_address    TEXT,
  accion        TEXT NOT NULL,
  modulo        TEXT NOT NULL DEFAULT 'AUTH',
  nivel         TEXT NOT NULL DEFAULT 'INFO' CHECK (nivel IN ('INFO', 'WARN', 'CRITICAL')),
  detalles      JSONB DEFAULT '{}'::jsonb
);

-- Registro de Actividades de Usuarios (Trazabilidad Operativa)
CREATE TABLE IF NOT EXISTS public.log_actividades (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha         TIMESTAMPTZ DEFAULT NOW(),
  usuario_id    UUID REFERENCES public.tqs_users(id) ON DELETE SET NULL,
  usuario_email TEXT,
  entidad       TEXT NOT NULL,
  entidad_id    TEXT,
  accion        TEXT NOT NULL,
  resumen       TEXT NOT NULL,
  cambios       JSONB DEFAULT '{}'::jsonb
);

-- 6. TRIGGERS PARA EL CAMPO updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_tqs_users_updated_at ON public.tqs_users;
CREATE TRIGGER set_tqs_users_updated_at BEFORE UPDATE ON public.tqs_users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_rfcs_updated_at ON public.rfcs;
CREATE TRIGGER set_rfcs_updated_at BEFORE UPDATE ON public.rfcs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_solicitudes_updated_at ON public.solicitudes;
CREATE TRIGGER set_solicitudes_updated_at BEFORE UPDATE ON public.solicitudes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. TRIGGER PARA LA CREACIÓN AUTOMÁTICA DE PERFIL (al insertar en auth_users)
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.tqs_users (id, email, nombre, rol, activo, primer_login)
  VALUES (
    NEW.id,
    NEW.email,
    split_part(NEW.email, '@', 1),
    'fte',
    TRUE,
    TRUE
  ) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON public.auth_users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON public.auth_users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 8. INDICES PARA RENDIMIENTO
CREATE INDEX IF NOT EXISTS idx_rfcs_owner_id ON public.rfcs(owner_id);
CREATE INDEX IF NOT EXISTS idx_rfcs_fecha    ON public.rfcs(fecha);
CREATE INDEX IF NOT EXISTS idx_solicitudes_owner_id ON public.solicitudes(owner_id);
CREATE INDEX IF NOT EXISTS idx_log_app_fecha      ON public.log_aplicacion(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_log_audit_fecha    ON public.log_auditoria(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_log_act_fecha      ON public.log_actividades(fecha DESC);

-- 9. USUARIOS PREDETERMINADOS
-- Contraseña admin/usuarios: Nosemeolvida01 ($2b$10$nuM7kFL/89UdLdit8Y3ktu5a71XtIJWXBypgL0uOBYVpl4P4crnKq)
-- Contraseña guardia_me: guardiatqs01 ($2a$10$ogftYza3vnciTiD.L/fGfeBfX4NT3MJ6FOF9sixBM8nq2Bg7lIPW6)

DELETE FROM public.tqs_users WHERE LOWER(email) IN ('susana.dolores@easconsulting.com.mx', 'carlos.castillo@easconsulting.com.mx');
DELETE FROM public.auth_users WHERE LOWER(email) IN ('susana.dolores@easconsulting.com.mx', 'carlos.castillo@easconsulting.com.mx');

INSERT INTO public.auth_users (id, email, password_hash, raw_user_meta_data)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'admin@easconsulting.com.mx', '$2b$10$nuM7kFL/89UdLdit8Y3ktu5a71XtIJWXBypgL0uOBYVpl4P4crnKq', '{"nombre": "Administrador ATLAS", "rol": "admin"}'::jsonb),
  ('00000000-0000-0000-0000-000000000002', 'enrique.aguilar@easconsulting.com.mx', '$2b$10$nuM7kFL/89UdLdit8Y3ktu5a71XtIJWXBypgL0uOBYVpl4P4crnKq', '{"nombre": "Enrique Aguilar", "rol": "admin"}'::jsonb),
  ('3d38d73e-f684-4b56-b0f9-ad5ab25541b6', 'antonio.lopez@easconsulting.com.mx', '$2b$10$nuM7kFL/89UdLdit8Y3ktu5a71XtIJWXBypgL0uOBYVpl4P4crnKq', '{"nombre": "Antonio López Labra", "rol": "admin"}'::jsonb),
  ('71070ae7-51af-4baa-8fa9-555a381687f5', 'rodolfo.gonzalez@easconsulting.com.mx', '$2a$10$lvf6a48P.MxLuY2rINOVgerGwzlK1PZs9pC0PcQA7oHn1zHjy4vCO', '{"nombre": "Rodolfo Gonzalez Guerrero", "rol": "director"}'::jsonb),
  ('00000000-0000-0000-0000-000000000014', 'nancy.dolores@easconsulting.com.mx', '$2b$10$nuM7kFL/89UdLdit8Y3ktu5a71XtIJWXBypgL0uOBYVpl4P4crnKq', '{"nombre": "Nancy Dolores", "rol": "tqs_leader"}'::jsonb),
  ('00000000-0000-0000-0000-000000000005', 'andres.castillo@easconsulting.com.mx', '$2b$10$nuM7kFL/89UdLdit8Y3ktu5a71XtIJWXBypgL0uOBYVpl4P4crnKq', '{"nombre": "Andrés Castillo", "rol": "tqs_leader"}'::jsonb),
  ('00000000-0000-0000-0000-000000000011', 'guadalupe.arguelles@easconsulting.com.mx', '$2b$10$nuM7kFL/89UdLdit8Y3ktu5a71XtIJWXBypgL0uOBYVpl4P4crnKq', '{"nombre": "Guadalupe Arguelles", "rol": "tqs_leader"}'::jsonb),
  ('00000000-0000-0000-0000-000000000012', 'hector.medina@easconsulting.com.mx', '$2b$10$nuM7kFL/89UdLdit8Y3ktu5a71XtIJWXBypgL0uOBYVpl4P4crnKq', '{"nombre": "Héctor Medina", "rol": "tqs_leader"}'::jsonb),
  ('00000000-0000-0000-0000-000000000013', 'ivan.jesus@easconsulting.com.mx', '$2b$10$nuM7kFL/89UdLdit8Y3ktu5a71XtIJWXBypgL0uOBYVpl4P4crnKq', '{"nombre": "Iván Jesús", "rol": "tqs_leader"}'::jsonb),
  ('00000000-0000-0000-0000-000000000003', 'guardia_me@easconsulting.com.mx', '$2a$10$ogftYza3vnciTiD.L/fGfeBfX4NT3MJ6FOF9sixBM8nq2Bg7lIPW6', '{"nombre": "Guardia ME", "rol": "guardia"}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash,
  raw_user_meta_data = EXCLUDED.raw_user_meta_data;

INSERT INTO public.tqs_users (id, email, nombre, rol, sistemas, primer_login, activo)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'admin@easconsulting.com.mx', 'Administrador ATLAS', 'admin', ARRAY['S4HANA','BW','PO','SOLMAN','CAR','CRM','BTP','FIORI','ECC'], false, true),
  ('00000000-0000-0000-0000-000000000002', 'enrique.aguilar@easconsulting.com.mx', 'Enrique Aguilar', 'admin', ARRAY['S4HANA','BW','PO','SOLMAN','CAR','CRM','BTP','FIORI','ECC'], false, true),
  ('3d38d73e-f684-4b56-b0f9-ad5ab25541b6', 'antonio.lopez@easconsulting.com.mx', 'Antonio López Labra', 'admin', ARRAY['S4HANA','BW','PO','SOLMAN','CAR','CRM','BTP','FIORI','ECC'], false, true),
  ('71070ae7-51af-4baa-8fa9-555a381687f5', 'rodolfo.gonzalez@easconsulting.com.mx', 'Rodolfo Gonzalez Guerrero', 'director', ARRAY['S4HANA','BW','PO','SOLMAN','CAR','CRM','BTP','FIORI','ECC'], false, true),
  ('00000000-0000-0000-0000-000000000014', 'nancy.dolores@easconsulting.com.mx', 'Nancy Dolores', 'tqs_leader', ARRAY['Dynatrace (KOF)','MS Misión Critica - Azure','MuleSoft','BTP / PaPM','Cloud Connector','Cproc / BOT','Data Lake','Data Provisioning','Data Staging','EWM','Focus Run','SCM','Solman'], false, true),
  ('00000000-0000-0000-0000-000000000005', 'andres.castillo@easconsulting.com.mx', 'Andrés Castillo', 'tqs_leader', ARRAY['AutoPassReset','Code Profiler for SAP','CyberArk','Mid Server','CAS','ECC''s RAP','EP','MDG','NWDI','SLD (OnPremise)','TREX','Sentinel','SIS / ADM SAP Victor Domínguez','Terraform & Ansible IAC','Zscaler'], false, true),
  ('00000000-0000-0000-0000-000000000011', 'guadalupe.arguelles@easconsulting.com.mx', 'Guadalupe Arguelles', 'tqs_leader', ARRAY['CRM', 'PI', 'Data Services', 'ADS', 'MII MX', 'MII BR', 'MII JDV', 'SLD (Azure)'], false, true),
  ('00000000-0000-0000-0000-000000000012', 'hector.medina@easconsulting.com.mx', 'Héctor Medina', 'tqs_leader', ARRAY['ECC''s RVP', 'ECC''s NO Productivos', 'BW HANA Comercial', 'GRC (OnPremise)', 'CAS', 'BW HANA Financiero', 'SLD (OnPremise)', 'GRC (Azure)', 'MDG', 'S/4'], false, true),
  ('00000000-0000-0000-0000-000000000013', 'ivan.jesus@easconsulting.com.mx', 'Iván Jesús', 'tqs_leader', ARRAY['Sistemas Históricos', 'ECC''s RLP', 'PCM', 'FIM', 'WTS', 'Restauraciones No ECC', 'Qlik', 'SLT'], false, true),
  ('00000000-0000-0000-0000-000000000003', 'guardia_me@easconsulting.com.mx', 'Guardia ME', 'guardia', ARRAY[]::text[], false, true)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  nombre = EXCLUDED.nombre,
  rol = EXCLUDED.rol,
  sistemas = EXCLUDED.sistemas,
  activo = true,
  primer_login = false;

-- 10. CATÁLOGO OFICIAL DE 49 SISTEMAS Y TQS LEADERS (SEGUN MATRIZ OFICIAL)
INSERT INTO public.sistemas (nombre, infraestructura, tipo_sap, criticidad, owner_id, backup_id, activo)
VALUES
  -- Carlos Castillo (Titular) / Héctor Medina (Backup) - 17 sistemas
  ('ECC RAP', 'OnPremise', 'SAP', 3, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('BW HANA Comercial', 'OnPremise', 'SAP', 2, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('EP', 'OnPremise', 'SAP', 2, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('TREX', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('NWDI', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('CAS', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('BW HANA Financiero', 'OnPremise', 'SAP', 2, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('SLD', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('MDG', 'Azure', 'SAP', 1, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('Code Profiler for SAP', 'Azure', 'No SAP', 1, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('CyberArk', 'Azure', 'No SAP', 1, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('Sentinel', 'Azure', 'No SAP', 1, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('Mid Server', 'Azure', 'No SAP', 1, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('SIS / ADM SAP Victor Domínguez', 'Azure', 'No SAP', 1, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('AutoPassReset', 'Azure', 'No SAP', 1, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('Terraform & Ansible IAC', 'Azure', 'No SAP', 1, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),
  ('Zscaler', 'Azure', 'No SAP', 1, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012', true),

  -- Guadalupe Arguelles (Titular) / Nancy Dolores (Backup) - 5 sistemas
  ('PI', 'OnPremise', 'SAP', 2, '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000014', true),
  ('BODS', 'OnPremise', 'SAP', 3, '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000014', true),
  ('ADS', 'Azure', 'SAP', 1, '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000014', true),
  ('MII', 'Azure', 'SAP', 3, '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000014', true),
  ('SLD', 'Azure', 'SAP', 1, '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000014', true),

  -- Héctor Medina (Titular) / Iván Jesús (Backup) - 3 sistemas
  ('ECC RVP', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013', true),
  ('ECC NO Productivos', 'OnPremise', 'SAP', 2, '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013', true),
  ('S/4', 'Azure', 'SAP', 3, '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013', true),

  -- Iván Jesús (Titular) / Carlos Castillo (Backup) - 11 sistemas
  ('Sistemas Históricos', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000005', true),
  ('ECC RLP', 'OnPremise', 'SAP', 3, '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000005', true),
  ('CRM', 'OnPremise', 'SAP', 2, '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000005', true),
  ('GRC', 'OnPremise', 'SAP', 2, '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000005', true),
  ('PCM', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000005', true),
  ('FIM', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000005', true),
  ('WTS', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000005', true),
  ('Restauraciones No ECC', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000005', true),
  ('Qlik', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000005', true),
  ('GRC', 'Azure', 'SAP', 2, '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000005', true),
  ('SLT', 'Azure', 'SAP', 3, '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000005', true),

  -- Nancy Dolores (Titular) / Guadalupe Arguelles (Backup) - 13 sistemas
  ('Solman', 'Azure', 'SAP', 1, '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000011', true),
  ('Cloud Connector', 'Azure', 'SAP', 2, '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000011', true),
  ('BTP / PaPM', 'Azure', 'SAP', 1, '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000011', true),
  ('Focus Run', 'Azure', 'SAP', 1, '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000011', true),
  ('Cproc / BOT', 'Azure', 'SAP', 2, '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000011', true),
  ('Data Staging', 'Azure', 'SAP', 1, '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000011', true),
  ('Data Provisioning', 'Azure', 'SAP', 1, '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000011', true),
  ('Data Lake', 'Azure', 'SAP', 1, '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000011', true),
  ('MS Misión Critica - Azure', 'Azure', 'No SAP', 1, '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000011', true),
  ('Dynatrace (KOF)', 'Azure', 'No SAP', 1, '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000011', true),
  ('MuleSoft', 'Azure', 'No SAP', 2, '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000011', true),
  ('EWM', 'Azure', 'SAP', 2, '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000011', true),
  ('SCM', 'Azure', 'SAP', 2, '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000011', true)
ON CONFLICT (nombre, infraestructura) DO UPDATE SET
  tipo_sap = EXCLUDED.tipo_sap,
  criticidad = EXCLUDED.criticidad,
  owner_id = EXCLUDED.owner_id,
  backup_id = EXCLUDED.backup_id,
  activo = true;

-- 11. TABLAS DEL PIPELINE DE TALENTO Y RECLUTAMIENTO
CREATE TABLE IF NOT EXISTS public.vacantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  cliente TEXT DEFAULT 'EAS / KOF',
  departamento TEXT DEFAULT 'Operaciones SAP',
  estado TEXT DEFAULT 'Abierta' CHECK (estado IN ('Abierta', 'En Proceso', 'Cerrada', 'Pausada')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.candidatos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  email TEXT,
  telefono TEXT,
  vacante_id UUID REFERENCES public.vacantes(id) ON DELETE SET NULL,
  vacante_titulo TEXT DEFAULT 'Consultor SAP Senior',
  estado_pipeline TEXT DEFAULT 'CV''s' CHECK (estado_pipeline IN (
    'CV''s',
    'Filtrado',
    'Entrevista Capital Humano',
    'Entrevista Lider',
    'Entrevista Cliente',
    'Examen Psicometrico',
    'Oferta',
    'Contratado',
    'Rechazado',
    'Talent Pool'
  )),
  score_double_check INT DEFAULT 0,
  preguntas_respuestas JSONB DEFAULT '[]'::jsonb,
  cv_url TEXT,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Semillas iniciales de Vacantes
INSERT INTO public.vacantes (titulo, cliente, departamento)
VALUES 
  ('Consultor de Ventas', 'EAS Consulting', 'Ventas & Consultoría'),
  ('Consultor Funcional SAP S/4HANA CO', 'KOF', 'Finanzas SAP'),
  ('Senior Frontend Developer (React)', 'EAS Consulting', 'Desarrollo Web'),
  ('Consultor TQS', 'EAS Consulting', 'Operaciones SAP'),
  ('Consultor SAP S/4HANA Basis Senior', 'KOF', 'Operaciones SAP'),
  ('Líder Técnico SAP BTP & Integration', 'EAS Consulting', 'Cloud SAP'),
  ('Administrador de Sistemas No SAP & Security', 'EAS Consulting', 'Infraestructura Multi-Cloud'),
  ('Consultor SAP ABAP / FIORI Lead', 'KOF', 'Desarrollo SAP')
ON CONFLICT DO NOTHING;

-- Semillas iniciales de Candidatos demo para pruebas del Pipeline
INSERT INTO public.candidatos (nombre, email, telefono, vacante_titulo, estado_pipeline, score_double_check, preguntas_respuestas, notas)
VALUES
  ('Alfonso López', 'alfonso.lopez@example.com', '+52 55 9988 1122', 'Consultor de Ventas', 'CV''s', 82, '[{"pregunta":"¿Nivel en ventas corporativas SAP?","respuesta":"Jr. A - 3 años en prospección y demos técnicas.","score":82}]'::jsonb, 'Alerta Nivel Guía: Nivel Jr. A'),
  ('Carlos Alberto Mendoza', 'carlos.mendoza@example.com', '+52 55 1234 5678', 'Consultor SAP S/4HANA Basis Senior', 'CV''s', 0, '[]'::jsonb, 'CV cargado automáticamente en ingesta inicial'),
  ('Mariana Ríos Gutiérrez', 'mariana.rios@example.com', '+52 81 8765 4321', 'Líder Técnico SAP BTP & Integration', 'Filtrado', 85, '[{"pregunta":"¿Experiencia con BTP Integration Suite?","respuesta":"5 años configurando Cloud Integration y API Management.","score":90}]'::jsonb, 'Perfil sólido en integración Cloud'),
  ('Javier Alejandro Ortiz', 'javier.ortiz@example.com', '+52 33 9988 7766', 'Consultor SAP ABAP / FIORI Lead', 'Entrevista Capital Humano', 78, '[{"pregunta":"¿Disponibilidad para guardia 7x24?","respuesta":"Sí, con rotación semanal previa coordinación.","score":80}]'::jsonb, 'Entrevista inicial aprobada'),
  ('Fernando Castro Vega', 'fernando.castro@example.com', '+52 55 4433 2211', 'Administrador de Sistemas No SAP & Security', 'Entrevista Lider', 92, '[{"pregunta":"¿Conocimiento en CyberArk y Zscaler?","respuesta":"Certificado en CyberArk PAS y administración de Zscaler ZIA.","score":95}]'::jsonb, 'Excelente desempeño técnico en entrevista con Líder'),
  ('Beatriz Elena Morales', 'beatriz.morales@example.com', '+52 81 1122 3344', 'Consultor SAP S/4HANA Basis Senior', 'Talent Pool', 70, '[]'::jsonb, 'Candidata calificada para backlog futuro')
ON CONFLICT DO NOTHING;

-- SINCRO USUARIOS REALES Y SISTEMAS COMPLETOS (10 USUARIOS / 58 SISTEMAS)
-- Clean QA test users and sync exact 10 real users
DELETE FROM public.tqs_users WHERE email LIKE 'qa_prod_test_%';
DELETE FROM public.auth_users WHERE email LIKE 'qa_prod_test_%';

UPDATE public.tqs_users SET activo = false WHERE email = 'enrique.aguilar@easconsulting.com.mx';

INSERT INTO public.auth_users (id, email, password_hash, raw_user_meta_data)
VALUES 
('00000000-0000-0000-0000-000000000001', 'admin@easconsulting.com.mx', '$2a$10$j5AXPzVKJNnO9WOkSezS1.sWlbthmy1W4SmbT1GwRp9rDqIiHmeBu', '{"nombre": "Administrador ATLAS", "rol": "admin"}'::jsonb),
('00000000-0000-0000-0000-000000000002', 'enrique.aguilar@easconsulting.com.mx', '$2a$10$j5AXPzVKJNnO9WOkSezS1.sWlbthmy1W4SmbT1GwRp9rDqIiHmeBu', '{"nombre": "Enrique Aguilar", "rol": "admin"}'::jsonb),
('00000000-0000-0000-0000-000000000003', 'guardia_me@easconsulting.com.mx', '$2a$10$ogftYza3vnciTiD.L/fGfeBfX4NT3MJ6FOF9sixBM8nq2Bg7lIPW6', '{"nombre": "Guardia ME", "rol": "guardia"}'::jsonb),
('00000000-0000-0000-0000-000000000004', 'ivan.jesus@easconsulting.com.mx', '$2a$10$j5AXPzVKJNnO9WOkSezS1.sWlbthmy1W4SmbT1GwRp9rDqIiHmeBu', '{"nombre": "Iván Jesús", "rol": "tqs_leader"}'::jsonb),
('00000000-0000-0000-0000-000000000006', 'hector.medina@easconsulting.com.mx', '$2a$10$j5AXPzVKJNnO9WOkSezS1.sWlbthmy1W4SmbT1GwRp9rDqIiHmeBu', '{"nombre": "Héctor Medina", "rol": "tqs_leader"}'::jsonb),
('00000000-0000-0000-0000-000000000011', 'guadalupe.arguelles@easconsulting.com.mx', '$2a$10$j5AXPzVKJNnO9WOkSezS1.sWlbthmy1W4SmbT1GwRp9rDqIiHmeBu', '{"nombre": "Guadalupe Arguelles", "rol": "tqs_leader"}'::jsonb),
('71070ae7-51af-4baa-8fa9-555a381687f5', 'rodolfo.gonzalez@easconsulting.com.mx', '$2a$10$lvf6a48P.MxLuY2rINOVgerGwzlK1PZs9pC0PcQA7oHn1zHjy4vCO', '{"nombre": "Rodolfo Gonzalez Guerrero", "rol": "director"}'::jsonb),
('3d38d73e-f684-4b56-b0f9-ad5ab25541b6', 'antonio.lopez@easconsulting.com.mx', '$2a$10$j5AXPzVKJNnO9WOkSezS1.sWlbthmy1W4SmbT1GwRp9rDqIiHmeBu', '{"nombre": "Antonio López Labra", "rol": "admin"}'::jsonb)
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, raw_user_meta_data = EXCLUDED.raw_user_meta_data;

INSERT INTO public.tqs_users (id, email, nombre, rol, sistemas, primer_login, activo)
VALUES
('00000000-0000-0000-0000-000000000001', 'admin@easconsulting.com.mx', 'Administrador ATLAS', 'admin', '{}', false, true),
('00000000-0000-0000-0000-000000000002', 'enrique.aguilar@easconsulting.com.mx', 'Enrique Aguilar', 'admin', '{}', false, false),
('00000000-0000-0000-0000-000000000003', 'guardia_me@easconsulting.com.mx', 'Guardia ME', 'guardia', '{}', false, true),
('00000000-0000-0000-0000-000000000004', 'ivan.jesus@easconsulting.com.mx', 'Iván Jesús', 'tqs_leader', ARRAY['CRM','ECC''s RLP','FIM','GRC (Azure)','GRC (OnPremise)','PCM','Qlik','Restauraciones No ECC','SLT','Sistemas Históricos','WTS'], false, true),
('00000000-0000-0000-0000-000000000006', 'hector.medina@easconsulting.com.mx', 'Héctor Medina', 'tqs_leader', ARRAY['BW HANA Comercial','BW HANA Financiero','CAS','ECC''s NO Productivos','ECC''s RVP','GRC (Azure)','GRC (OnPremise)','MDG','S/4','SLD (OnPremise)'], false, true),
('00000000-0000-0000-0000-000000000011', 'guadalupe.arguelles@easconsulting.com.mx', 'Guadalupe Arguelles', 'tqs_leader', ARRAY['ADS','Data Services','CRM','MII','MII AR','MII BR','MII CA','MII CO','MII DEV','MII JDV','MII MX','MII QA','PI','SLD (Azure)'], false, true),
('71070ae7-51af-4baa-8fa9-555a381687f5', 'rodolfo.gonzalez@easconsulting.com.mx', 'Rodolfo Gonzalez Guerrero', 'director', '{}', false, true),
('3d38d73e-f684-4b56-b0f9-ad5ab25541b6', 'antonio.lopez@easconsulting.com.mx', 'Antonio López Labra', 'admin', '{}', false, true)
ON CONFLICT (id) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  rol = EXCLUDED.rol,
  sistemas = EXCLUDED.sistemas,
  activo = EXCLUDED.activo,
  primer_login = EXCLUDED.primer_login;


INSERT INTO public.sistemas (nombre, infraestructura, tipo_sap, criticidad)
VALUES
  ('Integration Suite (BTP)', 'Azure', 'SAP', 2),
  ('FortiGate Firewall (FortiDDNS)', 'OnPremise', 'No SAP', 1)
ON CONFLICT (nombre) DO NOTHING;

-- 11. TABLAS PARA APRENDIZAJE CONTINUO DEL CHATBOT DE IA CON N8N
CREATE TABLE IF NOT EXISTS public.ai_knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pregunta TEXT NOT NULL,
    respuesta TEXT NOT NULL,
    categoria VARCHAR(100) DEFAULT 'general',
    origen VARCHAR(50) DEFAULT 'n8n_learning',
    confianza NUMERIC(3,2) DEFAULT 1.00,
    votos_positivos INT DEFAULT 0,
    votos_negativos INT DEFAULT 0,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_kb_pregunta ON public.ai_knowledge_base (pregunta);
CREATE INDEX IF NOT EXISTS idx_ai_kb_categoria ON public.ai_knowledge_base (categoria);

CREATE TABLE IF NOT EXISTS public.ai_chat_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.auth_users(id) ON DELETE SET NULL,
    query TEXT NOT NULL,
    bot_response TEXT NOT NULL,
    rating INT NOT NULL CHECK (rating IN (1, -1)),
    comentarios TEXT,
    procesado_n8n BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_fb_procesado ON public.ai_chat_feedback (procesado_n8n);

CREATE TABLE IF NOT EXISTS public.ai_knowledge_gaps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tema VARCHAR(255) NOT NULL,
    query_ejemplo TEXT NOT NULL,
    frecuencia INT DEFAULT 1,
    resuelto BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
