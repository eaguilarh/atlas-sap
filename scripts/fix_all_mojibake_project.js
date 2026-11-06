const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const MOJIBAKE_REPLACEMENTS = [
  ['Carlos AndrÃ©s Castillo Barajas', 'Carlos Andrés Castillo Barajas'],
  ['Carlos AndrÃ©s', 'Carlos Andrés'],
  ['AndrÃ©s', 'Andrés'],
  ['IvÃ¡n JesÃºs', 'Iván Jesús'],
  ['IvÃ¡n', 'Iván'],
  ['JesÃºs', 'Jesús'],
  ['HÃ©ctor Medina', 'Héctor Medina'],
  ['HÃ©ctor', 'Héctor'],
  ['Antonio LÃ³pez Labra', 'Antonio López Labra'],
  ['LÃ³pez', 'López'],
  ['DesempeÃ±o', 'Desempeño'],
  ['desempeÃ±o', 'desempeño'],
  ['Ã©xito', 'éxito'],
  ['Ã‰xito', 'Éxito'],
  ['Ã¡', 'á'],
  ['Ã©', 'é'],
  ['Ã­', 'í'],
  ['Ã³', 'ó'],
  ['Ãº', 'ú'],
  ['Ã±', 'ñ'],
  ['Ã1', 'Á'],
  ['Ã‰', 'É'],
  ['ÃI', 'Í'],
  ['ÃÓ', 'Ó'],
  ['ÃÚ', 'Ú'],
  ['ÃÑ', 'Ñ'],
  ['Ã¼', 'ü'],
  ['Ãœ', 'Ü'],
  ['Ã‚', ''],
  ['ï¿½', ''],
  ['Ã¢â‚¬â„¢', "'"],
  ['Ã¢â‚¬â€œ', '–'],
  ['Ã¢â‚¬â€', '—'],
];

function cleanText(text) {
  if (!text) return text;
  let cleaned = text;
  for (const [bad, good] of MOJIBAKE_REPLACEMENTS) {
    cleaned = cleaned.split(bad).join(good);
  }
  return cleaned;
}

// 1. Clean local project files
const filesToClean = [
  'index.html',
  'styles.css',
  'server.js',
  'schema_onpremise.sql',
  'package.json',
  'scripts/db-seed.js',
  'scripts/db-init.js',
  'scripts/import-excel-rfcs.js',
  'scripts/rebalance_tqs_1000_rfcs.js'
];

console.log('🧹 Limpiando Mojibakes en los archivos del proyecto local...');

for (const relPath of filesToClean) {
  const absPath = path.join(__dirname, '..', relPath);
  if (fs.existsSync(absPath)) {
    try {
      const content = fs.readFileSync(absPath, 'utf8');
      const fixed = cleanText(content);
      if (content !== fixed) {
        fs.writeFileSync(absPath, fixed, 'utf8');
        console.log(`  ✅ Corregido: ${relPath}`);
      } else {
        console.log(`  ℹ️ Sin cambios de mojibake: ${relPath}`);
      }
    } catch (e) {
      console.error(`  ❌ Error al procesar ${relPath}:`, e.message);
    }
  }
}

// 2. Clean Database on PostgreSQL
async function cleanDatabaseMojibake() {
  const dbConfig = {
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:Nosemeolvida01@atlas_postgres:5432/postgres',
  };
  const pool = new Pool(dbConfig);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('\n🧹 Limpiando Mojibakes en las tablas de PostgreSQL...');

    const tablesAndColumns = [
      { table: 'public.rfcs', cols: ['ticket', 'sistema_name', 'promotor', 'coordinador_kof', 'descripcion', 'observaciones', 'status'] },
      { table: 'public.tqs_users', cols: ['nombre', 'email', 'rol'] },
      { table: 'public.sistemas', cols: ['nombre', 'infraestructura', 'tipo_sap'] },
      { table: 'public.solicitudes', cols: ['responsable', 'origen', 'estatus', 'sistema_sap'] },
      { table: 'public.log_actividades', cols: ['usuario_email', 'accion', 'resumen'] },
      { table: 'public.log_auditoria', cols: ['usuario_email', 'accion'] }
    ];

    let totalFixed = 0;
    for (const item of tablesAndColumns) {
      for (const col of item.cols) {
        for (const [bad, good] of MOJIBAKE_REPLACEMENTS) {
          const sql = `UPDATE ${item.table} SET "${col}" = REPLACE("${col}"::text, $1, $2) WHERE "${col}"::text LIKE '%' || $1 || '%'`;
          const res = await client.query(sql, [bad, good]);
          if (res.rowCount > 0) {
            console.log(`  ✅ ${item.table} [${col}]: ${res.rowCount} filas corregidas de "${bad}" -> "${good}"`);
            totalFixed += res.rowCount;
          }
        }
      }
    }

    await client.query('COMMIT');
    console.log(`\n🎉 Base de datos limpiada de mojibakes con éxito. (${totalFixed} reemplazos aplicados)`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error limpiando base de datos:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

cleanDatabaseMojibake().catch(console.error);
