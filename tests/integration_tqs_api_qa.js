/**
 * Test de Integración QA & Testing para Endpoints de Base de Datos y Vistas TQS
 * Proyecto: ATLAS-SAP Operaciones
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:Nosemeolvida01@db:5432/postgres'
});

async function runQaIntegration() {
  console.log('\n============================================================');
  console.log('  QA & TESTING: VALIDACIÓN DE VISTAS TQS EN BASE DE DATOS  ');
  console.log('============================================================\n');

  try {
    // 1. Obtener todos los líderes TQS activos
    const usersRes = await pool.query(
      "SELECT id, nombre, email, rol, sistemas FROM public.tqs_users WHERE activo = true AND rol = 'tqs_leader' ORDER BY nombre ASC;"
    );

    console.log(`[QA-CHECK-1] TQS Leaders Activos Detectados: ${usersRes.rows.length}\n`);

    let totalPassedTests = 0;
    let totalFailedTests = 0;

    for (const user of usersRes.rows) {
      const userId = user.id;
      const userName = user.nombre;
      const userSysArr = Array.isArray(user.sistemas) ? user.sistemas : [];

      // Query de sistemas asignados/backup
      const sysRes = await pool.query(
        'SELECT nombre FROM public.sistemas WHERE owner_id = $1 OR backup_id = $1',
        [userId]
      );
      const sysNamesFromDb = sysRes.rows.map(r => r.nombre);
      const allSysNames = [...new Set([...userSysArr, ...sysNamesFromDb])].map(s => String(s).trim()).filter(Boolean);

      // Simulación idéntica del endpoint /api/rfcs/user-backup-view
      let queryStr = `
        SELECT r.id, r.ticket, r.sistema_name, r.owner_id, r.status, r.fecha
        FROM public.rfcs r
        WHERE r.deleted_at IS NULL
      `;
      const params = [];

      if (allSysNames.length > 0) {
        params.push(allSysNames);
        params.push(userId);
        queryStr += ` AND (r.sistema_name = ANY($1) OR r.sistema_grupo = ANY($1) OR r.owner_id = $2 OR $2 = ANY(r.tqs_ids))`;
      } else {
        params.push(userId);
        queryStr += ` AND (r.owner_id = $1 OR $1 = ANY(r.tqs_ids))`;
      }

      queryStr += ` ORDER BY r.fecha DESC LIMIT 2000`;

      const tStart = process.hrtime.bigint();
      const rfcRes = await pool.query(queryStr, params);
      const tEnd = process.hrtime.bigint();
      const latencyMs = Number(tEnd - tStart) / 1_000_000;

      const count = rfcRes.rows.length;
      const pass = count > 0 && latencyMs < 100.0;

      if (pass) totalPassedTests++;
      else totalFailedTests++;

      console.log(`  -> TQS Leader: ${userName}`);
      console.log(`     Email: ${user.email}`);
      console.log(`     Sistemas Asignados: [${allSysNames.slice(0, 4).join(', ')}${allSysNames.length > 4 ? '...' : ''}] (${allSysNames.length} total)`);
      console.log(`     RFCs Recuperados: ${count} registros`);
      console.log(`     Latencia de Consulta: ${latencyMs.toFixed(2)} ms`);
      console.log(`     Status QA: ${pass ? '[PASS]' : '[FAIL]'}\n`);
    }

    // 2. Comprobar vista General de Operaciones
    const totalAllRes = await pool.query("SELECT COUNT(*) FROM public.rfcs WHERE deleted_at IS NULL;");
    const totalCount = parseInt(totalAllRes.rows[0].count, 10);
    console.log(`[QA-CHECK-2] Total General Operaciones en DB: ${totalCount} RFCs`);
    if (totalCount > 1500) {
      console.log('     Status QA: [PASS] (Dataset consistente con operaciones vigentes)\n');
      totalPassedTests++;
    } else {
      console.log('     Status QA: [FAIL] (Dataset incompleto o no migrado)\n');
      totalFailedTests++;
    }

    console.log('============================================================');
    console.log(`  RESUMEN QA: ${totalPassedTests} PASSED / ${totalFailedTests} FAILED`);
    console.log('============================================================\n');

    await pool.end();
    process.exit(totalFailedTests === 0 ? 0 : 1);
  } catch (err) {
    console.error('[QA-ERROR]', err);
    await pool.end();
    process.exit(1);
  }
}

runQaIntegration();
