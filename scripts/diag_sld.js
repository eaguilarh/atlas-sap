const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function diag() {
  const res = await pool.query(`
    SELECT ticket, count(*), array_agg(sistema_name) as sNames, array_agg(fecha::text) as fechas
    FROM public.rfcs 
    WHERE sistema_name ILIKE 'SLD (Azure)%'
    GROUP BY ticket 
    HAVING count(*) > 1
  `);
  console.log("=== TICKETS CON MULTIPLES SLD (AZURE) ===");
  console.log(JSON.stringify(res.rows, null, 2));

  const resMid = await pool.query(`
    SELECT ticket, count(*), array_agg(sistema_name) as sNames, array_agg(fecha::text) as fechas
    FROM public.rfcs 
    WHERE sistema_name ILIKE '%Mid Server%' OR sistema_name ILIKE '%MID Server%'
    GROUP BY ticket 
    HAVING count(*) > 1
  `);
  console.log("=== TICKETS CON MULTIPLES MID SERVER ===");
  console.log(JSON.stringify(resMid.rows, null, 2));
  pool.end();
}
diag();
