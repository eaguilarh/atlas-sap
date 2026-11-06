const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function diag() {
  const res = await pool.query("SELECT ticket, fecha, hora_inicio, hora_fin, hora_fin_retorno, sistema_name, owner_id FROM public.rfcs WHERE ticket = 'CHG1672452'");
  console.log("=== CHG1672452 DESPUES DE LA MIGRACION ===");
  console.log(JSON.stringify(res.rows, null, 2));

  const sysOwners = await pool.query("SELECT sistema_name, count(*), u.nombre as owner FROM public.rfcs r LEFT JOIN public.tqs_users u ON r.owner_id = u.id WHERE r.sistema_name IN ('BW HANA Financiero', 'BW HANA Comercial', 'ECC RAP', 'SLD', 'MID') GROUP BY sistema_name, u.nombre ORDER BY sistema_name");
  console.log("=== OWNERS DE RFCS CLAVE ===");
  console.log(JSON.stringify(sysOwners.rows, null, 2));

  pool.end();
}
diag();
