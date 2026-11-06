const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Iniciando transaccion de migracion y depuracion...');

    // 0. Ajustar constraint única para permitir múltiples fechas legítimas de un mismo ticket y sistema
    console.log('0. Ajustando constraint unica en public.rfcs a (ticket, sistema_name, fecha)...');
    await client.query(`
      ALTER TABLE public.rfcs DROP CONSTRAINT IF EXISTS rfcs_ticket_key;
      ALTER TABLE public.rfcs DROP CONSTRAINT IF EXISTS rfcs_ticket_sistema_key;
      ALTER TABLE public.rfcs DROP CONSTRAINT IF EXISTS rfcs_ticket_sistema_fecha_key;
    `);

    // 1. Limpieza y normalización de Horas anómalas (horas de Excel > 23:59)
    console.log('1. Normalizando horas anomalas en public.rfcs...');
    await client.query(`
      CREATE OR REPLACE FUNCTION normalize_rfc_time(t text) RETURNS text AS $$
      DECLARE
        parts text[];
        h_val int;
        m_val int;
      BEGIN
        IF t IS NULL OR trim(t) = '' OR t = '—' OR t = '0' OR t = 'N/A' THEN
          RETURN NULL;
        END IF;
        t := trim(t);
        IF position(':' in t) > 0 THEN
          parts := string_to_array(t, ':');
          h_val := NULLIF(regexp_replace(parts[1], '[^0-9]', '', 'g'), '')::int;
          m_val := COALESCE(NULLIF(regexp_replace(parts[2], '[^0-9]', '', 'g'), '')::int, 0);
          IF h_val IS NOT NULL THEN
            IF h_val >= 24 THEN
              h_val := h_val % 24;
            END IF;
            IF m_val >= 60 THEN
              m_val := m_val % 60;
            END IF;
            RETURN lpad(h_val::text, 2, '0') || ':' || lpad(m_val::text, 2, '0');
          END IF;
        END IF;
        RETURN t;
      END;
      $$ LANGUAGE plpgsql;
    `);

    const fixHoursRes = await client.query(`
      UPDATE public.rfcs
      SET hora_inicio = normalize_rfc_time(hora_inicio),
          hora_fin = normalize_rfc_time(hora_fin),
          hora_fin_retorno = normalize_rfc_time(hora_fin_retorno)
      WHERE (hora_inicio ~ '^[0-9]{3,}:' OR hora_fin ~ '^[0-9]{3,}:' OR hora_fin_retorno ~ '^[0-9]{3,}:')
    `);
    console.log(`   Horas normalizadas en ${fixHoursRes.rowCount} RFCs.`);

    // 2. Migración ECC's RAP -> ECC RAP
    console.log("2. Migrando ECC's RAP -> ECC RAP...");
    const eccRfcRes = await client.query(`
      UPDATE public.rfcs
      SET sistema_name = 'ECC RAP',
          sistema_grupo = 'ECC RAP'
      WHERE sistema_name = 'ECC''s RAP' OR sistema_grupo = 'ECC''s RAP'
    `);
    console.log(`   RFCs migrados de ECC's RAP a ECC RAP: ${eccRfcRes.rowCount}`);

    const delEccSysRes = await client.query(`
      DELETE FROM public.sistemas WHERE nombre = 'ECC''s RAP'
    `);
    console.log(`   Sistema ECC's RAP eliminado de public.sistemas: ${delEccSysRes.rowCount}`);

    // Asegurar que ECC RAP esté asignado a Carlos Andrés Castillo
    await client.query(`
      UPDATE public.sistemas
      SET owner_id = '00000000-0000-0000-0000-000000000005'
      WHERE nombre = 'ECC RAP'
    `);

    // 3. Migración SLD (Azure) -> SLD
    console.log("3. Migrando SLD (Azure) -> SLD...");
    const sldRfcRes = await client.query(`
      UPDATE public.rfcs
      SET sistema_name = 'SLD',
          sistema_grupo = 'SLD'
      WHERE sistema_name ILIKE 'SLD (Azure)%' OR sistema_grupo ILIKE 'SLD (Azure)%'
    `);
    console.log(`   RFCs migrados de SLD (Azure) a SLD: ${sldRfcRes.rowCount}`);

    const delSldSysRes = await client.query(`
      DELETE FROM public.sistemas WHERE nombre ILIKE 'SLD (Azure)%'
    `);
    console.log(`   Sistemas SLD (Azure) eliminados de public.sistemas: ${delSldSysRes.rowCount}`);

    // 4. Migración Mid Server / MID Server -> MID
    console.log("4. Migrando Mid Server -> MID...");
    const midRfcRes = await client.query(`
      UPDATE public.rfcs
      SET sistema_name = 'MID',
          sistema_grupo = 'MID'
      WHERE sistema_name ILIKE 'MID Server%' 
         OR sistema_name ILIKE 'Mid Server%'
         OR sistema_grupo ILIKE 'MID Server%'
         OR sistema_grupo ILIKE 'Mid Server%'
    `);
    console.log(`   RFCs migrados de Mid Server a MID: ${midRfcRes.rowCount}`);

    const delMidSysRes = await client.query(`
      DELETE FROM public.sistemas WHERE nombre ILIKE 'Mid Server%' OR nombre ILIKE 'MID Server%'
    `);
    console.log(`   Sistemas Mid Server eliminados de public.sistemas: ${delMidSysRes.rowCount}`);

    // Asegurar que MID esté asignado a Carlos Andrés Castillo
    await client.query(`
      UPDATE public.sistemas
      SET owner_id = '00000000-0000-0000-0000-000000000005'
      WHERE nombre = 'MID'
    `);

    // Ahora aplicar la constraint única (ticket, sistema_name, fecha)
    await client.query(`
      ALTER TABLE public.rfcs ADD CONSTRAINT rfcs_ticket_sistema_fecha_key UNIQUE (ticket, sistema_name, fecha);
    `);
    console.log("   Constraint rfcs_ticket_sistema_fecha_key creada exitosamente.");

    // 5. Depuración y sincronización de Owner en RFCs según el catálogo de public.sistemas
    console.log("5. Sincronizando owner_id en public.rfcs segun public.sistemas...");
    const syncOwnersRes = await client.query(`
      UPDATE public.rfcs r
      SET owner_id = s.owner_id,
          tqs_ids = ARRAY[s.owner_id]
      FROM public.sistemas s
      WHERE r.sistema_name = s.nombre 
        AND s.owner_id IS NOT NULL 
        AND (r.owner_id IS NULL OR r.owner_id != s.owner_id)
    `);
    console.log(`   RFCs sincronizados con su owner correspondiente: ${syncOwnersRes.rowCount}`);

    // 6. Sincronización de sistemas asignados en public.tqs_users
    console.log("6. Sincronizando arreglos de sistemas en public.tqs_users...");
    const usersRes = await client.query("SELECT id FROM public.tqs_users WHERE rol IN ('admin', 'tqs_leader', 'fte')");
    for (const u of usersRes.rows) {
      const ownedRes = await client.query("SELECT nombre FROM public.sistemas WHERE owner_id = $1 ORDER BY nombre", [u.id]);
      const ownedNames = ownedRes.rows.map(r => r.nombre);
      await client.query("UPDATE public.tqs_users SET sistemas = $1 WHERE id = $2", [ownedNames, u.id]);
    }
    console.log("   Arreglos public.tqs_users.sistemas actualizados fielmente.");

    await client.query("COMMIT");
    console.log("Transaccion de migracion y depuracion finalizada con exito.");
  } catch(err) {
    await client.query("ROLLBACK");
    console.error("Error en migracion:", err);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
