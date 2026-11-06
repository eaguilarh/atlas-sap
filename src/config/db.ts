import { Pool, PoolConfig } from 'pg';
import { getEnv } from './env.js';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;

  const env = getEnv();
  const config: PoolConfig = {
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  pool = new Pool(config);

  pool.on('error', (err) => {
    console.error('[PG_POOL_ERROR]', err.message);
  });

  return pool;
}

export async function warmupPool(): Promise<void> {
  const p = getPool();
  await p.query('SELECT 1');
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}