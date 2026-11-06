const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'Nosemeolvida01',
  database: process.env.POSTGRES_DB || 'postgres',
});

async function run() {
  try {
    const totalRes = await pool.query("SELECT count(*) FROM public.rfcs");
    console.log("Total RFCs in DB:", totalRes.rows[0].count);

    const activeRes = await pool.query("SELECT count(*) FROM public.rfcs WHERE deleted_at IS NULL");
    console.log("Active RFCs (deleted_at IS NULL):", activeRes.rows[0].count);

    const deletedRes = await pool.query("SELECT count(*) FROM public.rfcs WHERE deleted_at IS NOT NULL");
    console.log("Deleted RFCs (deleted_at IS NOT NULL):", deletedRes.rows[0].count);

    const userRes = await pool.query("SELECT id, nombre, email, activo, rol FROM public.tqs_users WHERE email ILIKE '%aguilar%' OR nombre ILIKE '%Aguilar%'");
    console.log("\nUser Enrique Aguilar in DB:", userRes.rows);

    const mojibakeRfcs = await pool.query(`
      SELECT id, rfc_id, sistema, status, observaciones, promotor 
      FROM public.rfcs 
      WHERE rfc_id ~ '[ÃÂâ]' 
         OR sistema ~ '[ÃÂâ]' 
         OR observaciones ~ '[ÃÂâ]' 
         OR promotor ~ '[ÃÂâ]' 
         OR status ~ '[ÃÂâ]'
      LIMIT 10
    `);
    console.log(`\nSample RFCs with Mojibake (${mojibakeRfcs.rows.length} found):`);
    mojibakeRfcs.rows.forEach(r => console.log(r));

    const mojibakeUsers = await pool.query("SELECT id, nombre, email FROM public.tqs_users WHERE nombre ~ '[ÃÂâ]' OR email ~ '[ÃÂâ]'");
    console.log(`\nUsers with Mojibake (${mojibakeUsers.rows.length} found):`, mojibakeUsers.rows);

    const mojibakeSistemas = await pool.query("SELECT id, nombre FROM public.sistemas WHERE nombre ~ '[ÃÂâ]'");
    console.log(`\nSistemas with Mojibake (${mojibakeSistemas.rows.length} found):`, mojibakeSistemas.rows);

  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    await pool.end();
  }
}

run();
