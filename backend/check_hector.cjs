const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'Nosemeolvida01',
  database: process.env.POSTGRES_DB || 'postgres',
});

async function run() {
  try {
    console.log('=== BUSCANDO USUARIOS CON HECTOR / MEDINA ===');
    const users = await pool.query("SELECT * FROM public.tqs_users WHERE email ILIKE '%hector%' OR email ILIKE '%medina%' OR nombre ILIKE '%hector%' OR nombre ILIKE '%medina%'");
    console.log('Usuarios encontrados:', users.rows);

    console.log('\n=== BUSCANDO RFCs CON HECTOR / MEDINA EN CUALQUIER CAMPO ===');
    const rfcs = await pool.query(`
      SELECT * FROM public.rfcs 
      WHERE promotor ILIKE '%hector%' 
         OR promotor ILIKE '%medina%' 
         OR email_contacto ILIKE '%hector%' 
         OR observaciones ILIKE '%hector%'
         OR observaciones ILIKE '%medina%'
    `);
    console.log(`RFCs encontrados en public.rfcs (${rfcs.rows.length}):`);
    console.dir(rfcs.rows, { depth: null });

    const allRfcs = await pool.query("SELECT id, rfc_id, sistema, status, promotor, observaciones, created_at FROM public.rfcs ORDER BY id DESC LIMIT 50");
    console.log(`\n=== MUESTRA DE RFCs EN LA BD (Total: ${allRfcs.rows.length}) ===`);
    console.dir(allRfcs.rows, { depth: null });

    // Revisar todas las tablas
    const tablesRes = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    const tables = tablesRes.rows.map(r => r.table_name);
    console.log('\nTodas las tablas disponibles en PostgreSQL:', tables);

    for (const table of tables) {
      if (table === 'rfcs' || table === 'tqs_users') continue;
      try {
        const colsRes = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${table}'`);
        const textCols = colsRes.rows.filter(c => ['text', 'character varying', 'varchar'].includes(c.data_type)).map(c => c.column_name);
        if (textCols.length > 0) {
          const whereClause = textCols.map(col => `"${col}" ILIKE '%hector%' OR "${col}" ILIKE '%medina%'`).join(' OR ');
          const matchRes = await pool.query(`SELECT * FROM public."${table}" WHERE ${whereClause}`);
          if (matchRes.rows.length > 0) {
            console.log(`\n=== Coincidencias en tabla '${table}' (${matchRes.rows.length}): ===`);
            console.dir(matchRes.rows, { depth: null });
          }
        }
      } catch (err) {
        // ignore per-table errors
      }
    }

  } catch (err) {
    console.error('Error BD:', err);
  } finally {
    await pool.end();
  }
}

run();
