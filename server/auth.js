import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

const COOKIE = 'sid';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}

// Creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD when no users exist.
export async function seedAdmin(d = db) {
  const row = await d.one('SELECT COUNT(*) AS count FROM users');
  if (row.count > 0) return;
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.warn('No users found. Set ADMIN_EMAIL and ADMIN_PASSWORD, then restart, to create the first admin.');
    return;
  }
  await d.run('INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)',
    [ADMIN_EMAIL, ADMIN_NAME || 'Admin', hashPassword(ADMIN_PASSWORD), 'admin']);
  console.log(`Created admin user ${ADMIN_EMAIL}`);
}

export async function login(email, password) {
  const user = await db.one('SELECT * FROM users WHERE email = $1', [email]);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  const token = randomBytes(32).toString('hex');
  await db.run('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id]);
  return { token, user: publicUser(user) };
}

export async function logout(token) {
  await db.run('DELETE FROM sessions WHERE token = $1', [token]);
}

export function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export function readCookie(req, name) {
  const match = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

// Secure is set in production (HTTPS); local http development needs it off.
export function sessionCookie(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 7}${secure}`;
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function requireAuth(req, res, next) {
  try {
    const token = readCookie(req, COOKIE);
    if (!token) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    const row = await db.one(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`, [token]);
    if (!row) return res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
    req.user = publicUser(row);
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}
