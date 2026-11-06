const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
require('dotenv').config();

const dbConfig = {
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/atlas',
};
const pool = new Pool(dbConfig);

const seedDatabase = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const defaultPassword = process.env.DEFAULT_USER_PASSWORD || 'Nosemeolvida01';
    const guardiaPassword = process.env.GUARDIA_PASSWORD || 'guardiatqs01';
    const rodolfoPassword = process.env.RODOLFO_PASSWORD || 'Atl@sTQS01';
    
    const defaultHash = await bcrypt.hash(defaultPassword, 12);
    const guardiaHash = await bcrypt.hash(guardiaPassword, 12);
    const rodolfoHash = await bcrypt.hash(rodolfoPassword, 12);

    console.log('🔐 Hashes generados para usuarios por defecto');

    await client.query(`
      DELETE FROM public.auth_users WHERE id IN (
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
        NULL,
        '00000000-0000-0000-0000-000000000011',
        '00000000-0000-0000-0000-000000000012',
        '00000000-0000-0000-0000-000000000013',
        NULL,
        '71070ae7-51af-4baa-8fa9-555a381687f5',
        '3d38d73e-f684-4b56-b0f9-ad5ab25541b6'
      ) OR email IN (
        'admin@easconsulting.com.mx',
        'enrique.aguilar@easconsulting.com.mx',
        'guardia_me@easconsulting.com.mx',
        'guadalupe.arguelles@easconsulting.com.mx',
        'hector.medina@easconsulting.com.mx',
        'ivan.jesus@easconsulting.com.mx',
        'nancy.dolores@easconsulting.com.mx',
        'andres.castillo@easconsulting.com.mx',
        'rodolfo.gonzalez@easconsulting.com.mx',
        'antonio.lopez@easconsulting.com.mx'
      );
    `);

    await client.query(`
      INSERT INTO public.auth_users (id, email, password_hash, raw_user_meta_data)
      VALUES 
        ('00000000-0000-0000-0000-000000000001', 'admin@easconsulting.com.mx', $1, '{"nombre": "Administrador ATLAS", "rol": "admin"}'::jsonb),
        ('00000000-0000-0000-0000-000000000002', 'enrique.aguilar@easconsulting.com.mx', $1, '{"nombre": "Enrique Aguilar", "rol": "admin"}'::jsonb),
        ('3d38d73e-f684-4b56-b0f9-ad5ab25541b6', 'antonio.lopez@easconsulting.com.mx', $1, '{"nombre": "Antonio López Labra", "rol": "admin"}'::jsonb),
        ('71070ae7-51af-4baa-8fa9-555a381687f5', 'rodolfo.gonzalez@easconsulting.com.mx', $3, '{"nombre": "Rodolfo Gonzalez Guerrero", "rol": "director"}'::jsonb),
        ('00000000-0000-0000-0000-000000000014', 'nancy.dolores@easconsulting.com.mx', $1, '{"nombre": "Nancy Dolores", "rol": "tqs_leader"}'::jsonb),
        ('00000000-0000-0000-0000-000000000005', 'andres.castillo@easconsulting.com.mx', $1, '{"nombre": "Andrés Castillo", "rol": "tqs_leader"}'::jsonb),
        ('00000000-0000-0000-0000-000000000011', 'guadalupe.arguelles@easconsulting.com.mx', $1, '{"nombre": "Guadalupe Arguelles", "rol": "tqs_leader"}'::jsonb),
        ('00000000-0000-0000-0000-000000000099', 'guadalupe.aguelles@easconsulting.com.mx', $1, '{"nombre": "Guadalupe Arguelles", "rol": "tqs_leader"}'::jsonb),
        ('00000000-0000-0000-0000-000000000012', 'hector.medina@easconsulting.com.mx', $1, '{"nombre": "Héctor Medina", "rol": "tqs_leader"}'::jsonb),
        ('00000000-0000-0000-0000-000000000013', 'ivan.jesus@easconsulting.com.mx', $1, '{"nombre": "Iván Jesús", "rol": "tqs_leader"}'::jsonb),
        ('00000000-0000-0000-0000-000000000003', 'guardia_me@easconsulting.com.mx', $2, '{"nombre": "Guardia ME", "rol": "guardia"}'::jsonb)
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, raw_user_meta_data = EXCLUDED.raw_user_meta_data;
    `, [defaultHash, guardiaHash, rodolfoHash]);

    await client.query(`
      INSERT INTO public.tqs_users (id, email, nombre, rol, sistemas, primer_login, activo)
      VALUES
        ('00000000-0000-0000-0000-000000000001', 'admin@easconsulting.com.mx', 'Administrador ATLAS', 'admin', ARRAY[]::text[], false, true),
        ('00000000-0000-0000-0000-000000000002', 'enrique.aguilar@easconsulting.com.mx', 'Enrique Aguilar', 'admin', ARRAY['S4HANA','BW','PO','SOLMAN','CAR','CRM','BTP','FIORI','ECC'], false, true),
        ('3d38d73e-f684-4b56-b0f9-ad5ab25541b6', 'antonio.lopez@easconsulting.com.mx', 'Antonio López Labra', 'admin', ARRAY['S4HANA','BW','PO','SOLMAN','CAR','CRM','BTP','FIORI','ECC'], false, true),
        ('71070ae7-51af-4baa-8fa9-555a381687f5', 'rodolfo.gonzalez@easconsulting.com.mx', 'Rodolfo Gonzalez Guerrero', 'director', ARRAY['S4HANA','BW','PO','SOLMAN','CAR','CRM','BTP','FIORI','ECC'], false, true),
        ('00000000-0000-0000-0000-000000000014', 'nancy.dolores@easconsulting.com.mx', 'Nancy Dolores', 'tqs_leader', ARRAY['Dynatrace (KOF)','MS Misión Critica - Azure','MuleSoft','BTP / PaPM','Cloud Connector','Cproc / BOT','Data Lake','Data Provisioning','Data Staging','EWM','Focus Run','SCM','Solman'], false, true),
        ('00000000-0000-0000-0000-000000000005', 'andres.castillo@easconsulting.com.mx', 'Andrés Castillo', 'tqs_leader', ARRAY['AutoPassReset','Code Profiler for SAP','CyberArk','Mid Server','CAS','ECC''s RAP','EP','MDG','NWDI','SLD (OnPremise)','TREX','Sentinel','SIS / ADM SAP Victor Domínguez','Terraform & Ansible IAC','Zscaler'], false, true),
        ('00000000-0000-0000-0000-000000000011', 'guadalupe.arguelles@easconsulting.com.mx', 'Guadalupe Arguelles', 'tqs_leader', ARRAY['CRM', 'PI', 'Data Services', 'ADS', 'MII MX', 'MII BR', 'MII JDV', 'SLD (Azure)'], false, true),
        ('00000000-0000-0000-0000-000000000099', 'guadalupe.aguelles@easconsulting.com.mx', 'Guadalupe Arguelles', 'tqs_leader', ARRAY['CRM', 'PI', 'Data Services', 'ADS', 'MII MX', 'MII BR', 'MII JDV', 'SLD (Azure)'], false, true),
        ('00000000-0000-0000-0000-000000000012', 'hector.medina@easconsulting.com.mx', 'Héctor Medina', 'tqs_leader', ARRAY['ECC''s RVP', 'ECC''s NO Productivos', 'BW HANA Comercial', 'GRC (OnPremise)', 'CAS', 'BW HANA Financiero', 'SLD (OnPremise)', 'GRC (Azure)', 'MDG', 'S/4'], false, true),
        ('00000000-0000-0000-0000-000000000013', 'ivan.jesus@easconsulting.com.mx', 'Iván Jesús', 'tqs_leader', ARRAY['Sistemas Históricos', 'ECC''s RLP', 'PCM', 'FIM', 'WTS', 'Restauraciones No ECC', 'Qlik', 'SLT'], false, true),
        ('00000000-0000-0000-0000-000000000015', 'mario.reyes@easconsulting.com.mx', 'Mario Reyes', 'tqs_leader', ARRAY[]::text[], false, true),
        ('00000000-0000-0000-0000-000000000016', 'gerardo.arteaga@easconsulting.com.mx', 'Gerardo Arteaga', 'tqs_leader', ARRAY[]::text[], false, true),
        ('00000000-0000-0000-0000-000000000003', 'guardia_me@easconsulting.com.mx', 'Guardia ME', 'guardia', ARRAY[]::text[], false, true)
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, nombre = EXCLUDED.nombre, rol = EXCLUDED.rol, sistemas = EXCLUDED.sistemas, activo = EXCLUDED.activo;
    `);

    await client.query(`
      INSERT INTO public.sistemas (nombre, infraestructura, tipo_sap, criticidad, owner_id, backup_id)
      VALUES
        ('ECC''s RAP', 'OnPremise', 'SAP', 3, NULL, '00000000-0000-0000-0000-000000000012'),
        ('TREX', 'OnPremise', 'SAP', 1, NULL, '00000000-0000-0000-0000-000000000012'),
        ('NWDI', 'OnPremise', 'SAP', 1, NULL, '00000000-0000-0000-0000-000000000012'),
        ('Code Profiler for SAP', 'Azure', 'No SAP', 1, NULL, '00000000-0000-0000-0000-000000000012'),
        ('CyberArk', 'Azure', 'No SAP', 1, NULL, '00000000-0000-0000-0000-000000000012'),
        ('Sentinel', 'Azure', 'No SAP', 1, NULL, '00000000-0000-0000-0000-000000000012'),
        ('Mid Server', 'Azure', 'No SAP', 1, NULL, '00000000-0000-0000-0000-000000000012'),
        ('SIS / ADM SAP Victor Domínguez', 'Azure', 'No SAP', 1, NULL, '00000000-0000-0000-0000-000000000012'),
        ('AutoPassReset', 'Azure', 'No SAP', 1, NULL, '00000000-0000-0000-0000-000000000012'),
        ('Terraform & Ansible IAC', 'Azure', 'No SAP', 1, NULL, '00000000-0000-0000-0000-000000000012'),
        ('Zscaler', 'Azure', 'No SAP', 1, NULL, '00000000-0000-0000-0000-000000000012'),
        ('CRM', 'OnPremise', 'SAP', 2, '00000000-0000-0000-0000-000000000011', NULL),
        ('PI', 'OnPremise', 'SAP', 2, '00000000-0000-0000-0000-000000000011', NULL),
        ('Data Services', 'OnPremise', 'SAP', 3, '00000000-0000-0000-0000-000000000011', NULL),
        ('ADS', 'Azure', 'SAP', 1, '00000000-0000-0000-0000-000000000011', NULL),
        ('MII MX', 'Azure', 'SAP', 3, '00000000-0000-0000-0000-000000000011', NULL),
        ('MII BR', 'Azure', 'SAP', 3, '00000000-0000-0000-0000-000000000011', NULL),
        ('MII JDV', 'Azure', 'SAP', 2, '00000000-0000-0000-0000-000000000011', NULL),
        ('SLD (Azure)', 'Azure', 'SAP', 1, '00000000-0000-0000-0000-000000000011', NULL),
        ('Solman', 'Azure', 'SAP', 1, NULL, '00000000-0000-0000-0000-000000000011'),
        ('ECC''s RVP', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013'),
        ('ECC''s NO Productivos', 'OnPremise', 'SAP', 2, '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013'),
        ('BW HANA Comercial', 'OnPremise', 'SAP', 2, '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000005'),
        ('GRC (OnPremise)', 'OnPremise', 'SAP', 2, '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013'),
        ('CAS', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013'),
        ('BW HANA Financiero', 'OnPremise', 'SAP', 2, '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000005'),
        ('SLD (OnPremise)', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013'),
        ('GRC (Azure)', 'Azure', 'SAP', 2, '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013'),
        ('MDG', 'Azure', 'SAP', 1, '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013'),
        ('S/4', 'Azure', 'SAP', 3, '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013'),
        ('Sistemas Históricos', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000013', NULL),
        ('ECC''s RLP', 'OnPremise', 'SAP', 3, '00000000-0000-0000-0000-000000000013', NULL),
        ('PCM', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000013', NULL),
        ('FIM', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000013', NULL),
        ('WTS', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000013', NULL),
        ('Restauraciones No ECC', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000013', NULL),
        ('Qlik', 'OnPremise', 'SAP', 1, '00000000-0000-0000-0000-000000000013', NULL),
        ('SLT', 'Azure', 'SAP', 3, '00000000-0000-0000-0000-000000000013', NULL),
        ('MII CA', 'Azure', 'SAP', 2, '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012'),
        ('MII QA', 'Azure', 'SAP', 2, '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012'),
        ('MII DEV', 'Azure', 'SAP', 2, '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012'),
        ('MII AR', 'Azure', 'SAP', 2, '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012'),
        ('MII CO', 'Azure', 'SAP', 3, '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012'),
        ('Cloud Connector', 'Azure', 'SAP', 1, NULL, '00000000-0000-0000-0000-000000000011'),
        ('BTP / PaPM', 'Azure', 'SAP', 1, '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012'),
        ('Focus Run', 'Azure', 'SAP', 1, NULL, '00000000-0000-0000-0000-000000000011'),
        ('Cproc / BOT', 'Azure', 'SAP', 2, NULL, '00000000-0000-0000-0000-000000000011'),
        ('Data Staging', 'Azure', 'SAP', 1, NULL, '00000000-0000-0000-0000-000000000011'),
        ('Data Provisioning', 'Azure', 'SAP', 1, NULL, '00000000-0000-0000-0000-000000000011'),
        ('Data Lake', 'Azure', 'SAP', 1, NULL, '00000000-0000-0000-0000-000000000011'),
        ('MS Misión Critica - Azure', 'Azure', 'No SAP', 1, '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012'),
        ('Dynatrace (KOF)', 'Azure', 'No SAP', 1, '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012'),
        ('MuleSoft', 'Azure', 'No SAP', 2, '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012'),
        ('EWM', 'Azure', 'SAP', 2, NULL, '00000000-0000-0000-0000-000000000011'),
        ('SCM', 'Azure', 'SAP', 2, NULL, '00000000-0000-0000-0000-000000000011'),
        ('Integration Suite (BTP)', 'Azure', 'SAP', 2, NULL, '00000000-0000-0000-0000-000000000011'),
        ('FortiGate Firewall (FortiDDNS)', 'OnPremise', 'No SAP', 1, NULL, '00000000-0000-0000-0000-000000000012')
      ON CONFLICT (nombre) DO UPDATE SET
        infraestructura = EXCLUDED.infraestructura,
        tipo_sap = EXCLUDED.tipo_sap,
        criticidad = EXCLUDED.criticidad,
        owner_id = EXCLUDED.owner_id,
        backup_id = EXCLUDED.backup_id;
    `);


    // Seed Log de Auditoría
    await client.query(`
      INSERT INTO public.log_auditoria (usuario_email, ip_address, accion, modulo, nivel, detalles)
      VALUES
        ('admin@easconsulting.com.mx', '127.0.0.1', 'INICIO_SESION_EXITOSO', 'AUTH', 'INFO', '{"motivo": "Autenticación exitosa vía JWT"}'::jsonb),
        ('enrique.aguilar@easconsulting.com.mx', '127.0.0.1', 'CARGA_MASIVA_EXCEL_RFC', 'RFCS', 'INFO', '{"origen": "ATLAS_Plantilla_Carga_RFCs IJO JULIO 2026 v1.xlsx"}'::jsonb)
      ON CONFLICT DO NOTHING;
    `);

    // Seed Log de Actividades
    await client.query(`
      INSERT INTO public.log_actividades (usuario_email, entidad, accion, resumen)
      VALUES
        ('admin@easconsulting.com.mx', 'Sistemas', 'CONFIGURACION_INICIAL', 'Inicialización de infraestructura de 54 sistemas SAP y No SAP'),
        ('hector.medina@easconsulting.com.mx', 'RFCs', 'APROBACION_VOBO', 'Aprobación de VOBO para mantenimiento BW HANA Comercial')
      ON CONFLICT DO NOTHING;
    `);

    await client.query('COMMIT');
    
    console.log('✅ Datos semilla insertados correctamente');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error insertando datos semilla:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

seedDatabase().catch(() => process.exit(1));