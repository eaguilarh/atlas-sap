const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const dbConfig = {
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:Nosemeolvida01@localhost:5432/postgres'
};

async function unlockGuadalupe() {
  const pool = new Pool(dbConfig);
  try {
    console.log('--- UNLOCK GUADALUPE USER ---');
    const defaultPassword = process.env.DEFAULT_USER_PASSWORD || 'Nosemeolvida01';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    const checkUsers = await pool.query(
      `SELECT id, email, activo, primer_login FROM public.tqs_users WHERE email LIKE '%guadalupe%'`
    );
    console.log('Current tqs_users matching guadalupe:', checkUsers.rows);

    // 1. Update primary user: guadalupe.arguelles@easconsulting.com.mx
    const primaryId = '00000000-0000-0000-0000-000000000011';
    const primaryEmail = 'guadalupe.arguelles@easconsulting.com.mx';

    await pool.query(
      `INSERT INTO public.auth_users (id, email, password_hash, raw_user_meta_data)
       VALUES ($1, $2, $3, '{"nombre": "Guadalupe Arguelles", "rol": "tqs_leader"}'::jsonb)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash`,
      [primaryId, primaryEmail, passwordHash]
    );

    await pool.query(
      `INSERT INTO public.tqs_users (id, email, nombre, rol, sistemas, primer_login, activo)
       VALUES ($1, $2, 'Guadalupe Arguelles', 'tqs_leader', ARRAY['CRM', 'PI', 'Data Services', 'ADS', 'MII MX', 'MII BR', 'MII JDV', 'SLD (Azure)'], false, true)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, activo = true, primer_login = false`,
      [primaryId, primaryEmail]
    );

    // 2. Also create/update alias without 'r' (guadalupe.aguelles@easconsulting.com.mx)
    const aliasId = '00000000-0000-0000-0000-000000000099';
    const aliasEmail = 'guadalupe.aguelles@easconsulting.com.mx';

    await pool.query(
      `INSERT INTO public.auth_users (id, email, password_hash, raw_user_meta_data)
       VALUES ($1, $2, $3, '{"nombre": "Guadalupe Arguelles", "rol": "tqs_leader"}'::jsonb)
       ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [aliasId, aliasEmail, passwordHash]
    );

    await pool.query(
      `INSERT INTO public.tqs_users (id, email, nombre, rol, sistemas, primer_login, activo)
       VALUES ($1, $2, 'Guadalupe Arguelles', 'tqs_leader', ARRAY['CRM', 'PI', 'Data Services', 'ADS', 'MII MX', 'MII BR', 'MII JDV', 'SLD (Azure)'], false, true)
       ON CONFLICT (id) DO UPDATE SET activo = true, primer_login = false`,
      [aliasId, aliasEmail]
    );

    // 3. Clear any locked state and ensure password_hash is active for both
    await pool.query(
      `UPDATE public.tqs_users SET activo = true, primer_login = false WHERE email LIKE '%guadalupe%'`
    );
    await pool.query(
      `UPDATE public.auth_users SET password_hash = $1 WHERE email LIKE '%guadalupe%'`,
      [passwordHash]
    );

    console.log('SUCCESS: Guadalupe account fully unlocked and password reset to default.');
    const resultCheck = await pool.query(
      `SELECT id, email, activo, primer_login FROM public.tqs_users WHERE email LIKE '%guadalupe%'`
    );
    console.log('Updated tqs_users:', resultCheck.rows);

  } catch (err) {
    console.error('ERROR unlocking Guadalupe user:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

unlockGuadalupe();
