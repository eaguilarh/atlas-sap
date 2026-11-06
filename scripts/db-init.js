const { Pool } = require('pg');
require('dotenv').config();

const dbConfig = {
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/atlas',
};
const pool = new Pool(dbConfig);

const initDatabaseSchema = async () => {
  const client = await pool.connect();
  try {
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.auth_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.tqs_users (
        id UUID PRIMARY KEY REFERENCES public.auth_users(id) ON DELETE CASCADE,
        email TEXT NOT NULL UNIQUE,
        nombre TEXT NOT NULL,
        rol TEXT NOT NULL DEFAULT 'fte' CHECK (rol IN ('admin','tqs_leader','fte','director','guardia')),
        sistemas TEXT[] DEFAULT '{}',
        siguiendo_tqs UUID[] DEFAULT '{}',
        backup_tqs_id UUID REFERENCES public.tqs_users(id) ON DELETE SET NULL,
        primer_login BOOLEAN DEFAULT TRUE,
        activo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.sistemas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre TEXT NOT NULL UNIQUE,
        infraestructura TEXT DEFAULT 'OnPremise' CHECK (infraestructura IN ('OnPremise', 'Azure', 'Ambos')),
        tipo_sap TEXT DEFAULT 'SAP' CHECK (tipo_sap IN ('SAP', 'No SAP')),
        criticidad INT DEFAULT 1 CHECK (criticidad IN (1, 2, 3)),
        owner_id UUID REFERENCES public.tqs_users(id) ON DELETE SET NULL,
        backup_id UUID REFERENCES public.tqs_users(id) ON DELETE SET NULL,
        activo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE public.sistemas DROP CONSTRAINT IF EXISTS sistemas_infraestructura_check;
      ALTER TABLE public.sistemas ADD CONSTRAINT sistemas_infraestructura_check CHECK (infraestructura IN ('OnPremise', 'Azure', 'Ambos'));
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.rfcs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket TEXT NOT NULL UNIQUE,
        tipo TEXT,
        ambiente TEXT,
        infraestructura TEXT DEFAULT 'OnPremise',
        fecha DATE,
        fecha_fin DATE,
        fecha_fin_retorno DATE,
        sistema_name TEXT,
        sistema_grupo TEXT,
        sid TEXT,
        promotor TEXT,
        coordinador_kof TEXT,
        descripcion TEXT,
        observaciones TEXT,
        status TEXT DEFAULT 'En espera de VOBO',
        hora_inicio TEXT,
        hora_fin TEXT,
        hora_fin_retorno TEXT,
        owner_id UUID NOT NULL REFERENCES public.tqs_users(id) ON DELETE CASCADE,
        tqs_ids UUID[] DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      ALTER TABLE public.rfcs ADD COLUMN IF NOT EXISTS infraestructura TEXT DEFAULT 'OnPremise';
      ALTER TABLE public.rfcs ADD COLUMN IF NOT EXISTS coordinador_kof TEXT;
      ALTER TABLE public.rfcs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      UPDATE public.rfcs SET infraestructura = ambiente WHERE ambiente IS NOT NULL AND (infraestructura IS NULL OR infraestructura = 'OnPremise');
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.solicitudes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tipo TEXT NOT NULL CHECK (tipo IN ('KIT', 'Incidente', 'RCA', 'Requerimiento')),
        origen TEXT DEFAULT 'DXC' CHECK (origen IN ('DXC', 'KOF')),
        fecha_inicio DATE NOT NULL,
        sistema_sap TEXT,
        responsable TEXT,
        estatus TEXT DEFAULT 'En espera de autorización' CHECK (estatus IN ('En espera de autorización','Aprobado','En proceso','Re-asignado','Cerrado','Cancelado')),
        tqs_ids UUID[] DEFAULT '{}',
        action_items JSONB DEFAULT '[]'::jsonb,
        bitacora JSONB DEFAULT '[]'::jsonb,
        owner_id UUID NOT NULL REFERENCES public.tqs_users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.log_sincronizacion (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fecha TIMESTAMPTZ DEFAULT NOW(),
        tipo_error TEXT NOT NULL,
        detalle TEXT
      );
      CREATE TABLE IF NOT EXISTS public.log_aplicacion (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fecha TIMESTAMPTZ DEFAULT NOW(),
        nivel TEXT NOT NULL DEFAULT 'INFO' CHECK (nivel IN ('INFO', 'WARN', 'ERROR', 'FATAL')),
        modulo TEXT NOT NULL DEFAULT 'SERVER',
        mensaje TEXT NOT NULL,
        stack_trace TEXT,
        request_info JSONB DEFAULT '{}'::jsonb
      );
      CREATE TABLE IF NOT EXISTS public.log_auditoria (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fecha TIMESTAMPTZ DEFAULT NOW(),
        usuario_id UUID REFERENCES public.tqs_users(id) ON DELETE SET NULL,
        usuario_email TEXT,
        ip_address TEXT,
        accion TEXT NOT NULL,
        modulo TEXT NOT NULL DEFAULT 'AUTH',
        nivel TEXT NOT NULL DEFAULT 'INFO' CHECK (nivel IN ('INFO', 'WARN', 'CRITICAL')),
        detalles JSONB DEFAULT '{}'::jsonb
      );
      CREATE TABLE IF NOT EXISTS public.log_actividades (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fecha TIMESTAMPTZ DEFAULT NOW(),
        usuario_id UUID REFERENCES public.tqs_users(id) ON DELETE SET NULL,
        usuario_email TEXT,
        entidad TEXT NOT NULL,
        entidad_id TEXT,
        accion TEXT NOT NULL,
        resumen TEXT NOT NULL,
        cambios JSONB DEFAULT '{}'::jsonb
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.vacantes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        titulo TEXT NOT NULL,
        cliente TEXT DEFAULT 'DXC / KOF',
        departamento TEXT DEFAULT 'Operaciones SAP',
        estado TEXT DEFAULT 'Abierta' CHECK (estado IN ('Abierta', 'En Proceso', 'Cerrada', 'Pausada')),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.candidatos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre TEXT NOT NULL,
        email TEXT,
        telefono TEXT,
        vacante_id UUID REFERENCES public.vacantes(id) ON DELETE SET NULL,
        vacante_titulo TEXT,
        estado_pipeline TEXT DEFAULT 'CVs',
        notas TEXT,
        cv_url TEXT,
        score_double_check INT,
        preguntas_respuestas JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE public.rfcs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      ALTER TABLE public.solicitudes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

      CREATE INDEX IF NOT EXISTS idx_rfcs_ticket ON public.rfcs(ticket);
      CREATE INDEX IF NOT EXISTS idx_rfcs_owner_id ON public.rfcs(owner_id);
      CREATE INDEX IF NOT EXISTS idx_rfcs_sistema_name ON public.rfcs(sistema_name);
      CREATE INDEX IF NOT EXISTS idx_rfcs_fecha ON public.rfcs(fecha);
      CREATE INDEX IF NOT EXISTS idx_rfcs_deleted_at ON public.rfcs(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_solicitudes_owner_id ON public.solicitudes(owner_id);
      CREATE INDEX IF NOT EXISTS idx_solicitudes_fecha_inicio ON public.solicitudes(fecha_inicio);
      CREATE INDEX IF NOT EXISTS idx_solicitudes_tipo ON public.solicitudes(tipo);
      CREATE INDEX IF NOT EXISTS idx_solicitudes_deleted_at ON public.solicitudes(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_tqs_users_email ON public.tqs_users(email);
      CREATE INDEX IF NOT EXISTS idx_tqs_users_rol ON public.tqs_users(rol);
      CREATE INDEX IF NOT EXISTS idx_sistemas_nombre ON public.sistemas(nombre);
      CREATE INDEX IF NOT EXISTS idx_log_auditoria_fecha ON public.log_auditoria(fecha);
      CREATE INDEX IF NOT EXISTS idx_log_actividades_fecha ON public.log_actividades(fecha);
      CREATE INDEX IF NOT EXISTS idx_log_aplicacion_fecha ON public.log_aplicacion(fecha);
    `);

    console.log('✅ Esquema de base de datos inicializado correctamente');
  } catch (err) {
    console.error('❌ Error inicializando esquema:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

initDatabaseSchema().catch(() => process.exit(1));