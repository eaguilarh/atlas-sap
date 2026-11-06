const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const dbConfig = {
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:Nosemeolvida01@localhost:5432/postgres'
};

async function testLogin() {
  const pool = new Pool(dbConfig);
  try {
    const emails = ['guadalupe.arguelles@easconsulting.com.mx', 'guadalupe.aguelles@easconsulting.com.mx'];
    const password = 'Nosemeolvida01';

    for (const email of emails) {
      console.log(`Testing login for: ${email}`);
      const userRes = await pool.query(
        `SELECT * FROM public.auth_users WHERE LOWER(email) = LOWER($1)`,
        [email]
      );

      if (userRes.rows.length === 0) {
        console.error(`USER NOT FOUND IN auth_users for ${email}`);
        continue;
      }

      const user = userRes.rows[0];
      const validPassword = await bcrypt.compare(password, user.password_hash);
      const profileRes = await pool.query('SELECT rol, activo FROM public.tqs_users WHERE id = $1', [user.id]);

      if (validPassword && profileRes.rows[0]?.activo) {
        console.log(`=== LOGIN 100% VALID FOR ${email} ===`);
      } else {
        console.error(`Login failed for ${email}! validPassword:`, validPassword, 'activo:', profileRes.rows[0]?.activo);
      }
    }
  } catch (e) {
    console.error('Test error:', e);
  } finally {
    await pool.end();
  }
}

testLogin();
