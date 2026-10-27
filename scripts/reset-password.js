// Sets a new password for an existing user, or creates the user as admin if the email does not exist.
// Usage (PowerShell, with DATABASE_URL set):
//   node scripts/reset-password.js admin@localhost "new password"
// With no arguments it only lists the users in the database.
import { db, pool } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const [email, password] = process.argv.slice(2);

try {
  const users = await db.many('SELECT email, role FROM users ORDER BY id');
  console.log('Users:', users.length ? users.map((u) => `${u.email} (${u.role})`).join(', ') : '(none)');

  if (email && password) {
    if (password.length < 8) throw new Error('Password must be at least 8 characters');
    const updated = await db.run('UPDATE users SET password_hash = $1 WHERE email = $2', [hashPassword(password), email]);
    if (updated.rowCount === 0) {
      await db.run('INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)',
        [email, 'Admin', hashPassword(password), 'admin']);
      console.log(`Created admin ${email}`);
    } else {
      // Log out everywhere so the old password's sessions stop working.
      await db.run('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)', [email]);
      console.log(`Password updated for ${email}`);
    }
  }
} catch (err) {
  console.log('ERR', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
