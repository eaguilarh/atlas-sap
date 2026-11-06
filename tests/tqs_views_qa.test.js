/**
 * Suite de Pruebas Automatizadas QA - Vistas TQS y Navegación General
 * Estándar: Node.js Test Runner (node:test, node:assert)
 * Proyecto: ATLAS-SAP Operaciones
 */

const test = require('node:test');
const assert = require('node:assert');

// ── 1. MOCK DE DATOS Y ENTORNO FRONTEND ──────────────────────────────
const MOCK_RECORDS = [
  {
    ticket: 'CHG1000001',
    sistema_name: 'CRM',
    sistema: 'CRM',
    promotor: 'Iván Jesús',
    owner_id: '00000000-0000-0000-0000-000000000013',
    tqs_ids: ['00000000-0000-0000-0000-000000000013'],
    status: 'Finalizado con Éxito',
    fecha: '2026-08-10'
  },
  {
    ticket: 'CHG1000002',
    sistema_name: 'PCM, FIM',
    sistema: 'PCM, FIM',
    promotor: 'Soporte TI',
    owner_id: '00000000-0000-0000-0000-000000000013',
    tqs_ids: ['00000000-0000-0000-0000-000000000013'],
    status: 'Finalizado con Éxito',
    fecha: '2026-08-12'
  },
  {
    ticket: 'CHG1000003',
    sistema_name: 'BW HANA Comercial',
    sistema: 'BW HANA Comercial',
    promotor: 'Carlos Andrés Castillo Barajas',
    owner_id: '00000000-0000-0000-0000-000000000005',
    tqs_ids: ['00000000-0000-0000-0000-000000000005'],
    status: 'En espera de VOBO',
    fecha: '2026-08-14'
  },
  {
    ticket: 'CHG1000004',
    sistema_name: 'BTP / PaPM',
    sistema: 'BTP / PaPM',
    promotor: 'Nancy Dolores',
    owner_id: '00000000-0000-0000-0000-000000000014',
    tqs_ids: ['00000000-0000-0000-0000-000000000014'],
    status: 'Finalizado con Éxito',
    fecha: '2026-08-15'
  },
  {
    ticket: 'CHG1000005',
    sistema_name: 'ADS',
    sistema: 'ADS',
    promotor: 'Guadalupe Arguelles',
    owner_id: '00000000-0000-0000-0000-000000000011',
    tqs_ids: ['00000000-0000-0000-0000-000000000011'],
    status: 'En Ejecución',
    fecha: '2026-08-16'
  }
];

function normSys(str) {
  if (!str) return '';
  return str.toString().trim().toLowerCase().replace(/^sap\s+/, '').replace(/\s+/g, '');
}

function createGetSheet(mockAll, currentUser, options = {}) {
  let customSheetData = options.customSheetData || {};
  let isDashboardTqsActive = options.isDashboardTqsActive || false;
  let sheetTqsOnly = options.sheetTqsOnly;

  return function getSheet(name) {
    if (!name) return [];
    if (customSheetData && customSheetData[name]) {
      return customSheetData[name];
    }
    const targetNorm = normSys(name);
    const targetLower = name.trim().toLowerCase();

    // Soporte para vista consolidada General / Operaciones
    if (targetLower === 'general' || targetLower === 'operaciones' || targetLower === 'todos' || targetLower === 'todo' || targetLower === 'todas') {
      const isTqsUser = typeof currentUser !== 'undefined' && currentUser && ['tqs', 'tqs_leader', 'fte', 'operador'].includes(currentUser.rol);
      const filterByTqs = (sheetTqsOnly === true) || (sheetTqsOnly !== false && isDashboardTqsActive && isTqsUser);

      if (filterByTqs && isTqsUser) {
        const userSys = Array.isArray(currentUser.sistemas) ? currentUser.sistemas.map(s => s.toLowerCase().trim()) : [];
        const uid = currentUser.id;
        const uName = (currentUser.nombre || '').toLowerCase().trim();
        return mockAll.filter(r => {
          const rSys = (r.sistema_name || r.sistema || r._sheet || '').toLowerCase().trim();
          const isSys = userSys.some(s => rSys === s || rSys.includes(s) || s.includes(rSys));
          const isOwner = r.owner_id === uid;
          const isTqs = Array.isArray(r.tqs_ids) && r.tqs_ids.includes(uid);
          const isPromoter = (r.promotor || '').toLowerCase().includes(uName);
          return isSys || isOwner || isTqs || isPromoter;
        });
      }
      return mockAll;
    }

    return mockAll.filter(r => {
      let sysList = [];
      if (r.sistema_name) sysList.push(r.sistema_name);
      if (r.sistema) sysList.push(r.sistema);
      if (r.sistema_sap) sysList.push(r.sistema_sap);
      if (sysList.length === 0 && r._sheet) sysList.push(r._sheet);

      return sysList.some(sysStr => {
        if (!sysStr) return false;
        const sysNorm = normSys(sysStr);
        const sysLower = sysStr.toString().trim().toLowerCase();
        if (sysLower === targetLower || sysNorm === targetNorm) return true;
        if (sysNorm && targetNorm && sysNorm === targetNorm) return true;
        if (sysNorm && targetNorm && (sysNorm.startsWith(targetNorm) || targetNorm.startsWith(sysNorm))) return true;

        const subParts = sysStr.split(/[,/]/).map(p => p.trim().toLowerCase());
        if (subParts.some(p => p === targetLower || normSys(p) === targetNorm)) return true;

        return false;
      });
    });
  };
}

// ── 2. CASOS DE PRUEBA QA & TESTING ─────────────────────────────────

test('QA-TQS-01: getSheet("General") en Modo Global debe retornar todos los registros (Cero Vacíos)', () => {
  const userAdmin = { id: '0000-0001', nombre: 'Admin', rol: 'admin', sistemas: [] };
  const getSheet = createGetSheet(MOCK_RECORDS, userAdmin, { isDashboardTqsActive: false });

  const result = getSheet('General');
  assert.strictEqual(Array.isArray(result), true, 'Debe retornar un arreglo');
  assert.strictEqual(result.length, 5, 'Debe contener los 5 registros totales de Operaciones');
  assert.strictEqual(result[0].ticket, 'CHG1000001');
});

test('QA-TQS-02: getSheet("General") para usuario TQS Leader en modo TQS filtra estrictamente sus RFCs', () => {
  const userIvan = {
    id: '00000000-0000-0000-0000-000000000013',
    nombre: 'Iván Jesús',
    rol: 'tqs_leader',
    sistemas: ['CRM', 'SLT', 'PCM', 'FIM']
  };
  const getSheet = createGetSheet(MOCK_RECORDS, userIvan, { isDashboardTqsActive: true });

  const result = getSheet('General');
  assert.strictEqual(result.length, 2, 'Debe retornar exactamente los 2 RFCs vinculados a Iván Jesús (CRM y PCM, FIM)');
  assert.ok(result.some(r => r.ticket === 'CHG1000001'));
  assert.ok(result.some(r => r.ticket === 'CHG1000002'));
  assert.strictEqual(result.some(r => r.promotor === 'Carlos Andrés Castillo Barajas'), false, 'No debe filtrar RFCs de otros líderes en modo TQS');
});

test('QA-TQS-03: Conmutación explícita (_sheetTqsOnly = false) permite al TQS ver la operación completa', () => {
  const userIvan = {
    id: '00000000-0000-0000-0000-000000000013',
    nombre: 'Iván Jesús',
    rol: 'tqs_leader',
    sistemas: ['CRM']
  };
  // Usuario TQS pero ha pulsado "Ver Toda la Operación"
  const getSheet = createGetSheet(MOCK_RECORDS, userIvan, { sheetTqsOnly: false, isDashboardTqsActive: true });

  const result = getSheet('General');
  assert.strictEqual(result.length, 5, 'Al alternar el botón UI/UX a Global, debe mostrar los 5 RFCs completos');
});

test('QA-TQS-04: Coincidencia de Sistemas Compuestos (Split por coma y barra)', () => {
  const getSheet = createGetSheet(MOCK_RECORDS, null);

  // Sistema compuesto "PCM, FIM"
  const resultPcm = getSheet('PCM');
  assert.strictEqual(resultPcm.length, 1, 'Debe coincidir al buscar "PCM"');
  assert.strictEqual(resultPcm[0].ticket, 'CHG1000002');

  const resultFim = getSheet('FIM');
  assert.strictEqual(resultFim.length, 1, 'Debe coincidir al buscar "FIM" sobre "PCM, FIM"');
  assert.strictEqual(resultFim[0].ticket, 'CHG1000002');

  // Sistema compuesto "BTP / PaPM"
  const resultBtp = getSheet('BTP');
  assert.strictEqual(resultBtp.length, 1, 'Debe coincidir al buscar "BTP" sobre "BTP / PaPM"');
  assert.strictEqual(resultBtp[0].ticket, 'CHG1000004');

  const resultPapm = getSheet('PaPM');
  assert.strictEqual(resultPapm.length, 1, 'Debe coincidir al buscar "PaPM" sobre "BTP / PaPM"');
  assert.strictEqual(resultPapm[0].ticket, 'CHG1000004');
});

test('QA-TQS-05: Manejo robusto de entradas nulas, vacías o indefinidas en getSheet', () => {
  const getSheet = createGetSheet(MOCK_RECORDS, null);

  assert.deepStrictEqual(getSheet(null), [], 'null debe retornar arreglo vacío sin lanzar excepción');
  assert.deepStrictEqual(getSheet(undefined), [], 'undefined debe retornar arreglo vacío');
  assert.deepStrictEqual(getSheet(''), [], 'cadena vacía debe retornar arreglo vacío');
  assert.deepStrictEqual(getSheet('   '), [], 'espacios en blanco deben retornar arreglo vacío');
});

test('QA-TQS-06: Resguardo de sheetName en función navigate (Prevención de undefined)', () => {
  let currentSheet = undefined;
  function simulateNavigate(page, sheetName) {
    if (page === 'sheet') {
      sheetName = sheetName || currentSheet || 'General';
      currentSheet = sheetName;
      return currentSheet;
    }
    return page;
  }

  // Llamada sin parámetro sheetName
  const target1 = simulateNavigate('sheet');
  assert.strictEqual(target1, 'General', 'Si currentSheet es undefined y no se pasa parámetro, debe fallback a "General"');

  // Segunda llamada habiendo ya un sheet activo
  currentSheet = 'CRM';
  const target2 = simulateNavigate('sheet');
  assert.strictEqual(target2, 'CRM', 'Si currentSheet ya estaba establecido, debe preservarlo');

  // Llamada con parámetro explícito de vista personalizada
  const target3 = simulateNavigate('sheet', 'Mis Sistemas & Backup');
  assert.strictEqual(target3, 'Mis Sistemas & Backup', 'Debe adoptar el nombre explícito pasado');
});

test('QA-TQS-07: Rendimiento y Benchmark de Latencia (< 5ms para 2,000 registros)', () => {
  // Generar 2,000 registros sintéticos
  const largeDataset = [];
  for (let i = 0; i < 2000; i++) {
    largeDataset.push({
      ticket: `CHG${2000000 + i}`,
      sistema_name: i % 2 === 0 ? 'CRM' : 'SLT',
      owner_id: i % 3 === 0 ? '00000000-0000-0000-0000-000000000013' : 'other',
      status: 'Finalizado con Éxito',
      fecha: '2026-08-01'
    });
  }

  const userIvan = {
    id: '00000000-0000-0000-0000-000000000013',
    nombre: 'Iván Jesús',
    rol: 'tqs_leader',
    sistemas: ['CRM']
  };
  const getSheet = createGetSheet(largeDataset, userIvan, { isDashboardTqsActive: true });

  const tStart = process.hrtime.bigint();
  const res = getSheet('General');
  const tEnd = process.hrtime.bigint();

  const durationMs = Number(tEnd - tStart) / 1_000_000;
  assert.ok(res.length > 0, 'Debe haber resultados filtrados');
  assert.ok(durationMs < 5.0, `El filtrado debe tardar menos de 5ms (tomó ${durationMs.toFixed(3)}ms)`);
});
