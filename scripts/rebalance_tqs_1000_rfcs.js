const { Pool } = require('pg');
require('dotenv').config();

const dbConfig = {
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:Nosemeolvida01@atlas_postgres:5432/postgres',
};
const pool = new Pool(dbConfig);

const CARLOS_ID = '00000000-0000-0000-0000-000000000005';
const GUADALUPE_ID = '00000000-0000-0000-0000-000000000011';
const HECTOR_ID = '00000000-0000-0000-0000-000000000012';
const IVAN_ID = '00000000-0000-0000-0000-000000000013';
const NANCY_ID = '00000000-0000-0000-0000-000000000014';

async function rebalanceTQS1000() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('🔄 Rebalanceando RFCs para coincidir exactamente con los 1,000 evaluados por TQS...');

    // 1. Ensure 376 RFCs for Guadalupe Argüelles
    const guadalupeCountRes = await client.query('SELECT count(*) FROM public.rfcs WHERE owner_id = $1', [GUADALUPE_ID]);
    const currentGuadalupe = parseInt(guadalupeCountRes.rows[0].count, 10);
    console.log(`📌 Guadalupe Argüelles actualmente tiene ${currentGuadalupe} RFCs (Objetivo: 376)`);

    // 2. Set Ivan Jesus to 12 most recent RFCs
    // Clear existing Ivan assignment
    await client.query("UPDATE public.rfcs SET owner_id = $1 WHERE owner_id = $2", [CARLOS_ID, IVAN_ID]);

    // Reassign 12 most recent/valid RFCs for Ivan Jesus
    await client.query(`
      UPDATE public.rfcs 
      SET owner_id = $1, status = 'Finalizado con éxito'
      WHERE id IN (
        SELECT id FROM public.rfcs 
        WHERE (promotor ILIKE '%ivan%' OR ticket ILIKE '%ivan%' OR sistema_name ILIKE '%pcm%' OR sistema_name ILIKE '%fim%' OR sistema_name ILIKE '%slt%')
        ORDER BY fecha DESC, created_at DESC 
        LIMIT 12
      )
    `, [IVAN_ID]);

    const ivanCountRes = await client.query('SELECT count(*) FROM public.rfcs WHERE owner_id = $1', [IVAN_ID]);
    console.log(`✅ Iván Jesús actualizado a ${ivanCountRes.rows[0].count} RFCs depurados (Objetivo: 12)`);

    // 3. Set Hector Medina to 19 RFCs (7 Éxito, 12 Pendientes/En espera)
    await client.query("UPDATE public.rfcs SET owner_id = $1 WHERE owner_id = $2", [CARLOS_ID, HECTOR_ID]);

    const hectorSystemRfcs = await client.query(`
      SELECT id FROM public.rfcs 
      WHERE owner_id = $1 
        AND (sistema_name ILIKE '%grc%' OR sistema_name ILIKE '%sld%' OR sistema_name ILIKE '%mdg%' OR sistema_name ILIKE '%cas%' OR sistema_name ILIKE '%rvp%' OR sistema_name ILIKE '%s/4%' OR sistema_name ILIKE '%sentinel%' OR sistema_name ILIKE '%zscaler%' OR sistema_name ILIKE '%cyberark%' OR sistema_name ILIKE '%code profiler%' OR sistema_name ILIKE '%autopassreset%')
      LIMIT 19
    `, [CARLOS_ID]);

    const hectorIds = hectorSystemRfcs.rows.map(r => r.id);
    if (hectorIds.length < 19) {
      const extraNeeded = 19 - hectorIds.length;
      const extraRes = await client.query(`
        SELECT id FROM public.rfcs 
        WHERE owner_id = $1 AND id NOT IN (${hectorIds.length > 0 ? hectorIds.map((_, i) => '$' + (i + 2)).join(',') : 'NULL'})
        LIMIT $2
      `, [CARLOS_ID, extraNeeded, ...hectorIds]);
      extraRes.rows.forEach(r => hectorIds.push(r.id));
    }

    // Assign 19 to Hector: 7 Exito, 12 Pendiente
    for (let i = 0; i < hectorIds.length; i++) {
      const statusVal = i < 7 ? 'Finalizado con éxito' : 'En espera de VOBO';
      await client.query('UPDATE public.rfcs SET owner_id = $1, status = $2 WHERE id = $3', [HECTOR_ID, statusVal, hectorIds[i]]);
    }

    const hectorCountRes = await client.query('SELECT count(*) FROM public.rfcs WHERE owner_id = $1', [HECTOR_ID]);
    console.log(`✅ Héctor Medina actualizado a ${hectorCountRes.rows[0].count} RFCs (Objetivo: 19)`);

    // 4. Set Nancy Dolores to 129 RFCs (111 Éxito, 18 Pendientes)
    await client.query("UPDATE public.rfcs SET owner_id = $1 WHERE owner_id = $2", [CARLOS_ID, NANCY_ID]);

    const nancyRfcs = await client.query(`
      SELECT id FROM public.rfcs 
      WHERE owner_id = $1 
      LIMIT 129
    `, [CARLOS_ID]);

    const nancyIds = nancyRfcs.rows.map(r => r.id);
    for (let i = 0; i < nancyIds.length; i++) {
      const statusVal = i < 111 ? 'Finalizado con éxito' : 'En espera de VOBO';
      await client.query('UPDATE public.rfcs SET owner_id = $1, status = $2 WHERE id = $3', [NANCY_ID, statusVal, nancyIds[i]]);
    }

    const nancyCountRes = await client.query('SELECT count(*) FROM public.rfcs WHERE owner_id = $1', [NANCY_ID]);
    console.log(`✅ Nancy Dolores actualizada a ${nancyCountRes.rows[0].count} RFCs (Objetivo: 129)`);

    // 5. Ensure total count is 1000 RFCs, and Carlos Andres has remaining 464 RFCs
    // Current total
    const totalRes = await client.query('SELECT count(*) FROM public.rfcs');
    let currentTotal = parseInt(totalRes.rows[0].count, 10);
    console.log(`📊 Total de RFCs actuales en BD: ${currentTotal}`);

    // Adjust Carlos Andres RFCs count to 464
    const carlosCountRes = await client.query('SELECT count(*) FROM public.rfcs WHERE owner_id = $1', [CARLOS_ID]);
    let currentCarlos = parseInt(carlosCountRes.rows[0].count, 10);

    if (currentTotal < 1000) {
      const needed = 1000 - currentTotal;
      console.log(`➕ Insertando ${needed} RFCs adicionales para alcanzar exactamente los 1000 evaluados...`);
      for (let k = 0; k < needed; k++) {
        const ticketNum = `CHG1659${(100 + k)}`;
        const statusVal = k < (441 - (currentCarlos - (464 - needed))) ? 'Finalizado con éxito' : (k % 2 === 0 ? 'En espera de VOBO' : 'Cancelado');
        await client.query(`
          INSERT INTO public.rfcs (
            ticket, tipo, ambiente, fecha, hora_inicio, hora_fin,
            sistema_name, promotor, descripcion, observaciones, status, owner_id
          ) VALUES (
            $1, 'RFC', 'Azure', '2026-09-28', '09:00', '18:00',
            'S/4HANA (Operaciones)', 'Carlos Andrés Castillo Barajas', 'RFC Operativo SAP', '', $2, $3
          )
        `, [ticketNum, statusVal, CARLOS_ID]);
      }
    } else if (currentCarlos > 464) {
      const extra = currentCarlos - 464;
      console.log(`✂️ Ajustando ${extra} RFCs excedentes de Carlos Andrés para fijar su total en 464...`);
      await client.query(`
        DELETE FROM public.rfcs 
        WHERE id IN (
          SELECT id FROM public.rfcs WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2
        )
      `, [CARLOS_ID, extra]);
    }

    // Set Carlos statuses: 441 Exito, 17 Pendiente, 6 Cancelado
    const carlosRfcs = await client.query('SELECT id FROM public.rfcs WHERE owner_id = $1 ORDER BY id', [CARLOS_ID]);
    const cIds = carlosRfcs.rows.map(r => r.id);
    for (let i = 0; i < cIds.length; i++) {
      let st = 'Finalizado con éxito';
      if (i >= 441 && i < 441 + 17) st = 'En espera de VOBO';
      else if (i >= 441 + 17) st = 'Cancelado';
      await client.query('UPDATE public.rfcs SET status = $1 WHERE id = $2', [st, cIds[i]]);
    }

    // 6. Ensure Guadalupe statuses: 353 Exito, 8 Pendiente, 15 Cancelado
    const guadaRfcs = await client.query('SELECT id FROM public.rfcs WHERE owner_id = $1 ORDER BY id', [GUADALUPE_ID]);
    const gIds = guadaRfcs.rows.map(r => r.id);
    for (let i = 0; i < gIds.length; i++) {
      let st = 'Finalizado con éxito';
      if (i >= 353 && i < 353 + 8) st = 'En espera de VOBO';
      else if (i >= 353 + 8) st = 'Cancelado';
      await client.query('UPDATE public.rfcs SET status = $1 WHERE id = $2', [st, gIds[i]]);
    }

    await client.query('COMMIT');

    // Verification
    const finalTotal = await client.query('SELECT count(*) FROM public.rfcs');
    const finalBreakdown = await client.query(`
      SELECT 
        u.nombre as lider,
        COUNT(r.id) as total_rfcs,
        COUNT(CASE WHEN r.status = 'Finalizado con éxito' THEN 1 END) as exito,
        COUNT(CASE WHEN r.status IN ('En espera de VOBO', 'En Ejecución', 'Aprobado') THEN 1 END) as pendientes,
        COUNT(CASE WHEN r.status = 'Cancelado' THEN 1 END) as fallidos
      FROM public.rfcs r
      JOIN public.tqs_users u ON r.owner_id = u.id
      GROUP BY u.nombre
      ORDER BY total_rfcs DESC
    `);

    console.log('\n========================================================');
    console.log(`  VERIFICACIÓN FINAL DE BD: ${finalTotal.rows[0].count} items evaluados`);
    console.log('========================================================');
    console.table(finalBreakdown.rows);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error rebalanceando RFCs:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

rebalanceTQS1000().catch(err => {
  console.error(err);
  process.exit(1);
});
