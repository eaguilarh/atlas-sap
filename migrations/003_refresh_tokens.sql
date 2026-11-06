-- Migración: Tabla de Refresh Tokens para rotación segura
-- Ejecutar con: npm run db:migrate

-- Tabla de refresh tokens con rotación y revocación
CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL, -- SHA256 hash del token
  expires_at TIMESTAMPTZ NOT NULL,
  created_ip TEXT,
  revoked_at TIMESTAMPTZ,
  revoked_ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON public.refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON public.refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON public.refresh_tokens(expires_at) WHERE revoked_at IS NULL;

-- Trigger para limpieza automática de tokens expirados/revocados (opcional, ejecutar via cron)
-- DELETE FROM public.refresh_tokens WHERE expires_at < NOW() OR revoked_at IS NOT NULL;