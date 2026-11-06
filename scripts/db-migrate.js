const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbConfig = {
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/atlas',
};
const pool = new Pool(dbConfig);

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

const runMigrations = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const executed = await client.query('SELECT filename FROM public.schema_migrations');
    const executedFiles = new Set(executed.rows.map(r => r.filename));

    const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      if (executedFiles.has(file)) {
        console.log(`⏭️  Saltando ${file} (ya ejecutado)`);
        continue;
      }

      console.log(`🔄 Ejecutando migración: ${file}`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO public.schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`✅ ${file} completada`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('✅ Todas las migraciones completadas');
  } catch (err) {
    console.error('❌ Error en migraciones:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

runMigrations().catch(() => process.exit(1));