const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'Nosemeolvida01',
  database: process.env.POSTGRES_DB || 'postgres',
});

async function applyDbFixes() {
  try {
    console.log("=== Aplicando cambios en Base de Datos PostgreSQL ===");

    // 1. Agregar columna coordinador_kof a rfcs
    await pool.query("ALTER TABLE public.rfcs ADD COLUMN IF NOT EXISTS coordinador_kof TEXT;");
    console.log("✔ Columna coordinador_kof agregada a public.rfcs");

    // 2. Desactivar usuario Enrique Aguilar
    const deactRes = await pool.query("UPDATE public.tqs_users SET activo = false WHERE email ILIKE '%enrique.aguilar%' OR nombre ILIKE '%Enrique Aguilar%';");
    console.log(`✔ Usuario Enrique Aguilar desactivado (filas afectadas: ${deactRes.rowCount})`);

    // 3. Auditoría de conteo de RFCs
    const totalRfcs = await pool.query("SELECT count(*) FROM public.rfcs");
    const activeRfcs = await pool.query("SELECT count(*) FROM public.rfcs WHERE deleted_at IS NULL");
    const deletedRfcs = await pool.query("SELECT count(*) FROM public.rfcs WHERE deleted_at IS NOT NULL");

    console.log("\n=== CONTEO DE RFCs EN BD ===");
    console.log(`Total RFCs registrados: ${totalRfcs.rows[0].count}`);
    console.log(`RFCs Activos (deleted_at IS NULL): ${activeRfcs.rows[0].count}`);
    console.log(`RFCs Eliminados (deleted_at IS NOT NULL): ${deletedRfcs.rows[0].count}`);

    // 4. Corrección de Mojibake en PostgreSQL (reemplazo de secuencias UTF-8 doblemente codificadas)
    const mojibakeReplacements = [
      ['Ã©', 'é'], ['Ã¡', 'á'], ['Ã­', 'í'], ['Ã³', 'ó'], ['Ãº', 'ú'],
      ['Ã±', 'ñ'], ['Ã‰', 'É'], ['Ã\x81', 'Á'], ['Ã\x8d', 'Í'], ['Ã\x93', 'Ó'], ['Ã\x9a', 'Ú'],
      ['Ã\x91', 'Ñ'], ['ï¿½', ''], ['Ã¢â‚¬â„¢', "'"], ['Ã¢â‚¬â—œ', '–'], ['Ã¢â‚¬â—', '—'],
      ['Ã‚', '']
    ];

    console.log("\n=== Limpiando Mojibake en tablas Postgres ===");
    for (const [bad, good] of mojibakeReplacements) {
      await pool.query("UPDATE public.rfcs SET sistema_name = REPLACE(sistema_name, $1, $2) WHERE sistema_name LIKE '%' || $1 || '%';", [bad, good]);
      await pool.query("UPDATE public.rfcs SET status = REPLACE(status, $1, $2) WHERE status LIKE '%' || $1 || '%';", [bad, good]);
      await pool.query("UPDATE public.rfcs SET observaciones = REPLACE(observaciones, $1, $2) WHERE observaciones LIKE '%' || $1 || '%';", [bad, good]);
      await pool.query("UPDATE public.rfcs SET promotor = REPLACE(promotor, $1, $2) WHERE promotor LIKE '%' || $1 || '%';", [bad, good]);
      await pool.query("UPDATE public.rfcs SET descripcion = REPLACE(descripcion, $1, $2) WHERE descripcion LIKE '%' || $1 || '%';", [bad, good]);

      await pool.query("UPDATE public.tqs_users SET nombre = REPLACE(nombre, $1, $2) WHERE nombre LIKE '%' || $1 || '%';", [bad, good]);
      await pool.query("UPDATE public.sistemas SET nombre = REPLACE(nombre, $1, $2) WHERE nombre LIKE '%' || $1 || '%';", [bad, good]);
    }
    console.log("✔ Tablas de Postgres desinfectadas de Mojibake");

  } catch (err) {
    console.error("Error en DB:", err);
  } finally {
    await pool.end();
  }
}

applyDbFixes();
