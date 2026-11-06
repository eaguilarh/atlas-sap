import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().default(54321),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url().default('postgres://postgres:postgres@localhost:5432/atlas'),
  JWT_SECRET: z.string().min(32),
  JWT_SECRET_FILE: z.string().optional(),
  ALLOWED_ORIGINS: z.string().default('http://localhost:54321,http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SB_ANON: z.string().optional(),
  JWT_ISSUER: z.string().default('atlas-sap-operations'),
  JWT_AUDIENCE: z.string().default('atlas-api'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  cachedEnv = result.data;
  return cachedEnv;
}

export function getEnv(): Env {
  if (!cachedEnv) return loadEnv();
  return cachedEnv;
}