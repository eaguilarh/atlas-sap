const XLSX = require('xlsx');
const { Pool } = require('pg');
require('dotenv').config();

const dbConfig = {
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:Nosemeolvida01@atlas_postgres:5432/postgres',
};
const pool = new Pool(dbConfig);

function getField(row, fieldNames, defaultVal = '') {
  const rowKeys = Object.keys(row);
  for (const name of fieldNames) {
    // Direct match
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') {
      return String(row[name]).trim();
    }
    // Match with asterisk or spaces stripped
    const cleanName = name.replace(/\*/g, '').trim().toLowerCase();
    const matchedKey = rowKeys.find(k => k.replace(/\*/g, '').trim().toLowerCase() === cleanName);
    if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null && String(row[matchedKey]).trim() !== '') {
      return String(row[matchedKey]).trim();
    }
  }
  return defaultVal;
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const dmy = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const num = parseFloat(str);
  if (!isNaN(num) && num > 30000 && num < 60000) {
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
    return date.toISOString().split('T')[0];
  }
  return null;
}

async function importExcelRFCs() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log('📥 Leyendo archivo Excel de RFCs Julio 2026...');
    const workbook = XLSX.readFile('ATLAS_Plantilla_Carga_RFCs IJO JULIO 2026 v1.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    const existingCountRes = await client.query("SELECT COUNT(*) FROM public.rfcs WHERE deleted_at IS NULL");
    const existingCount = parseInt(existingCountRes.rows[0]?.count || 0, 10);
    if (existingCount >= 100) {
      console.log(`ℹ️ La base de datos ya contiene ${existingCount} RFCs (datos de usuario preservados). Omitiendo re-inicialización por semilla.`);
      await client.query('COMMIT');
      return;
    }

    console.log(`📊 ${jsonData.length} filas encontradas en el Excel de semilla`);
    
    const ownerRes = await client.query("SELECT id FROM public.tqs_users WHERE rol = 'admin' LIMIT 1");
    const defaultOwnerId = ownerRes.rows[0]?.id || '00000000-0000-0000-0000-000000000001';
    
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    
    for (let index = 0; index < jsonData.length; index++) {
      const row = jsonData[index];
      try {
        const ticket = getField(row, ['Ticket (RFC)', 'Ticket', 'RFC'], `RFC-${Date.now()}-${index}`);
        const tipo = getField(row, ['Tipo'], 'RFC');
        const ambiente = getField(row, ['Ambiente'], 'PRD');
        const fechaRaw = getField(row, ['Fecha inicio (yyyy-mm-dd)', 'Fecha inicio', 'Fecha']);
        const fecha_finRaw = getField(row, ['Fecha fin sin retorno(yyyy-mm-dd)', 'Fecha fin sin retorno', 'Fecha fin']);
        const fecha_fin_retornoRaw = getField(row, ['Fecha fin con plan de retorno (yyyy-mm-dd)', 'Fecha fin con retorno (yyyy-mm-dd)', 'Fecha fin con plan de retorno', 'Fecha fin con retorno', 'Fecha retorno']);
        const sistema_name = getField(row, ['Sistema/Grupo', 'Sistema', 'Grupo'], 'SAP General');
        const promotor = getField(row, ['Promotor', 'Solicitante'], 'Importación Excel');
        const descripcion = getField(row, ['Descripción', 'Descripcion'], 'RFC importado desde Excel Julio 2026');
        const observaciones = getField(row, ['Observaciones'], '');
        const status = getField(row, ['Status', 'Estatus'], 'Finalizado con éxito');
        const hora_inicio = getField(row, ['Hora inicio (hh:mm)', 'Hora inicio'], '00:00');
        const hora_fin = getField(row, ['Hora fin (hh:mm)', 'Hora fin'], '23:59');
        const hora_fin_retorno = getField(row, ['Hora fin retorno (hh:mm)', 'Hora retorno'], '');
        
        let fecha = parseDate(fechaRaw);
        if (!fecha) {
          fecha = new Date().toISOString().split('T')[0]; // Default to current date if missing/unparseable
        }
        const fecha_fin = parseDate(fecha_finRaw) || fecha;
        const fecha_fin_retorno = parseDate(fecha_fin_retornoRaw) || null;
        
        const checkRes = await client.query(
          'SELECT id FROM public.rfcs WHERE ticket = $1',
          [ticket]
        );
        
        if (checkRes.rows.length > 0) {
          await client.query(
            `UPDATE public.rfcs SET
              tipo = $1, ambiente = $2, fecha = $3, fecha_fin = $4, fecha_fin_retorno = $5,
              sistema_name = $6, promotor = $7, descripcion = $8, observaciones = $9,
              status = $10, hora_inicio = $11, hora_fin = $12, hora_fin_retorno = $13,
              updated_at = NOW()
            WHERE ticket = $14`,
            [tipo, ambiente, fecha, fecha_fin, fecha_fin_retorno, sistema_name, promotor, descripcion, observaciones, status, hora_inicio, hora_fin, hora_fin_retorno, ticket]
          );
          updatedCount++;
        } else {
          await client.query(
            `INSERT INTO public.rfcs (
              ticket, tipo, ambiente, fecha, fecha_fin, fecha_fin_retorno,
              sistema_name, promotor, descripcion, observaciones, status,
              hora_inicio, hora_fin, hora_fin_retorno, owner_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [ticket, tipo, ambiente, fecha, fecha_fin, fecha_fin_retorno, sistema_name, promotor, descripcion, observaciones, status, hora_inicio, hora_fin, hora_fin_retorno, defaultOwnerId]
          );
          insertedCount++;
        }
      } catch (rowErr) {
        console.error(`❌ Error procesando fila ${index}: ${rowErr.message}`);
        skippedCount++;
      }
    }
    
    await client.query('COMMIT');
    
    console.log('✅ Importación completada:');
    console.log(`   - Insertados: ${insertedCount}`);
    console.log(`   - Actualizados: ${updatedCount}`);
    console.log(`   - Saltados: ${skippedCount}`);
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en importación:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

importExcelRFCs().catch(() => process.exit(1));