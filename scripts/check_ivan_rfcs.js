const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:Nosemeolvida01@atlas_postgres:5432/postgres'
});

async function main() {
  const totalRes = await pool.query('SELECT COUNT(*) FROM rfcs');
  console.log('TOTAL_RFCS_IN_DB (INCLUDING DELETED):', totalRes.rows[0].count);

  const ivanId = '00000000-0000-0000-0000-000000000013';

  // Check tqs_ids array
  const tqsIdsRes = await pool.query(
    "SELECT COUNT(*) FROM rfcs WHERE $1 = ANY(tqs_ids)",
    [ivanId]
  );
  console.log('RFCS_WITH_IVAN_IN_TQS_IDS:', tqsIdsRes.rows[0].count);

  // Check all columns in DB for 'ivan'
  const searchRes = await pool.query(`
    SELECT id, ticket, promotor, descripcion, tqs_ids, deleted_at FROM rfcs
    WHERE ticket ILIKE '%ivan%'
       OR promotor ILIKE '%ivan%'
       OR descripcion ILIKE '%ivan%'
       OR observaciones ILIKE '%ivan%'
       OR owner_id = $1
       OR $1 = ANY(tqs_ids)
  `, [ivanId]);

  console.log(`TOTAL_MATCHES_ANYWHERE_IN_DB: ${searchRes.rows.length}`);
  searchRes.rows.forEach((r, i) => {
    console.log(`${i+1}. Ticket: ${r.ticket} | Promotor: ${r.promotor} | Deleted: ${r.deleted_at}`);
  });

  // Check tickets starting with CHG-IVAN or similar pattern
  const chgRes = await pool.query("SELECT count(*) FROM rfcs WHERE ticket ILIKE 'CHG-IVAN%' OR ticket ILIKE '%IVAN%'");
  console.log('TICKETS_WITH_IVAN:', chgRes.rows[0].count);

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
