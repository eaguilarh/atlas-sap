const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:Nosemeolvida01@atlas_postgres:5432/postgres'
});

async function purgeIvanRFCs() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ivanUserId = '00000000-0000-0000-0000-000000000013';

    // 1. Delete/Purge RFCs where owner_id is Ivan Jesus or promotor/ticket is Ivan
    const deleteRes = await client.query(`
      DELETE FROM public.rfcs 
      WHERE owner_id = $1 
         OR promotor ILIKE '%ivan%' 
         OR ticket ILIKE '%ivan%'
    `, [ivanUserId]);

    console.log(`🗑️ Se han depurado/eliminado ${deleteRes.rowCount} RFCs de Iván Jesús.`);

    // 2. Also remove Ivan from tqs_ids array if present in any remaining RFCs
    const arrayCleanupRes = await client.query(`
      UPDATE public.rfcs 
      SET tqs_ids = array_remove(tqs_ids, $1) 
      WHERE $1 = ANY(tqs_ids)
    `, [ivanUserId]);

    console.log(`🧹 Se ha removido a Iván Jesús de tqs_ids en ${arrayCleanupRes.rowCount} RFCs.`);

    await client.query('COMMIT');

    // 3. Verify Breakdown by Owner / TQS Leader
    const breakdownRes = await client.query(`
      SELECT 
        COALESCE(u.nombre, r.promotor, 'Sin Asignar') as lider,
        COUNT(r.id) as total_rfcs
      FROM public.rfcs r
      LEFT JOIN public.tqs_users u ON r.owner_id = u.id
      WHERE r.deleted_at IS NULL
      GROUP BY COALESCE(u.nombre, r.promotor, 'Sin Asignar')
      ORDER BY total_rfcs DESC
    `);

    console.log('\n📊 Breakdown final de RFCs por Líder TQS / Promotor:');
    breakdownRes.rows.forEach(row => {
      console.log(`   - ${row.lider}: ${row.total_rfcs} RFCs`);
    });

    const ivanCheck = await client.query(`
      SELECT COUNT(*) FROM public.rfcs 
      WHERE owner_id = $1 
         OR promotor ILIKE '%ivan%' 
         OR ticket ILIKE '%ivan%'
    `, [ivanUserId]);

    console.log(`\n✅ Verificación final: RFCs activos de Iván Jesús en BD = ${ivanCheck.rows[0].count}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error depurando RFCs de Iván Jesús:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

purgeIvanRFCs().catch(err => {
  console.error(err);
  process.exit(1);
});
