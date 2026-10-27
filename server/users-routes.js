// User management (admin only, enforced in permissions.js) and changing your own password.
import { Router } from 'express';
import { db, tx } from './db.js';
import { hashPassword, verifyPassword, publicUser } from './auth.js';
import { cleanPermissions } from './permissions.js';
import { BizError } from './errors.js';
import { h, text } from './helpers.js';

export const users = Router();

const EMAIL = /^[^\s@]+@[^\s@]+$/;
const MIN_PASSWORD = 8;

function checkPassword(password) {
  if (String(password || '').length < MIN_PASSWORD) throw new BizError(`รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD} ตัวอักษร`);
}

// At least one active admin must always remain, or nobody could manage users again.
async function assertAdminRemains(d, exceptId) {
  const row = await d.one(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active AND id != $1`, [exceptId]);
  if (row.count === 0) throw new BizError('ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน');
}

users.get('/users', h(async (req, res) => {
  const rows = await db.many('SELECT * FROM users ORDER BY id');
  res.json(rows.map((u) => ({ ...publicUser(u), created_at: u.created_at })));
}));

users.post('/users', h(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) throw new BizError('อีเมลไม่ถูกต้อง');
  checkPassword(req.body.password);
  const role = req.body.role === 'admin' ? 'admin' : 'staff';
  const exists = await db.one('SELECT id FROM users WHERE lower(email) = $1', [email]);
  if (exists) throw new BizError('อีเมลนี้มีผู้ใช้แล้ว');
  const row = await db.one(`INSERT INTO users (email, name, password_hash, role, permissions)
                            VALUES ($1, $2, $3, $4, $5) RETURNING id`,
  [email, text(req.body.name) || email, hashPassword(req.body.password), role, cleanPermissions(req.body.permissions)]);
  res.status(201).json({ id: row.id });
}));

users.put('/users/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  await tx(async (d) => {
    const user = await d.one('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id]);
    if (!user) throw new BizError('ไม่พบผู้ใช้');
    const role = req.body.role === 'admin' ? 'admin' : 'staff';
    const active = req.body.active !== false;
    if (id === req.user.id && (role !== 'admin' || !active)) {
      throw new BizError('ไม่สามารถลดสิทธิ์หรือปิดการใช้งานบัญชีของตัวเองได้');
    }
    if (user.role === 'admin' && (role !== 'admin' || !active)) await assertAdminRemains(d, id);
    await d.run('UPDATE users SET name = $1, role = $2, permissions = $3, active = $4 WHERE id = $5',
      [text(req.body.name) || user.email, role, cleanPermissions(req.body.permissions), active, id]);
    // A deactivated user is signed out immediately.
    if (!active) await d.run('DELETE FROM sessions WHERE user_id = $1', [id]);
  });
  res.json({ ok: true });
}));

// Admin sets a new password for someone (e.g. they forgot it). Signs them out everywhere.
users.post('/users/:id/password', h(async (req, res) => {
  checkPassword(req.body.password);
  const result = await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(req.body.password), req.params.id]);
  if (result.rowCount === 0) throw new BizError('ไม่พบผู้ใช้');
  await db.run('DELETE FROM sessions WHERE user_id = $1 AND token != $2', [req.params.id, req.token]);
  res.json({ ok: true });
}));

users.delete('/users/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new BizError('ไม่สามารถลบบัญชีของตัวเองได้');
  await tx(async (d) => {
    const user = await d.one('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id]);
    if (!user) throw new BizError('ไม่พบผู้ใช้');
    if (user.role === 'admin') await assertAdminRemains(d, id);
    await d.run('DELETE FROM users WHERE id = $1', [id]);
  });
  res.json({ ok: true });
}));

// Any signed-in user changes their own password; other sessions are signed out.
users.post('/me/password', h(async (req, res) => {
  const user = await db.one('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!verifyPassword(String(req.body.current_password || ''), user.password_hash)) {
    throw new BizError('รหัสผ่านปัจจุบันไม่ถูกต้อง');
  }
  checkPassword(req.body.new_password);
  await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(req.body.new_password), user.id]);
  await db.run('DELETE FROM sessions WHERE user_id = $1 AND token != $2', [user.id, req.token]);
  res.json({ ok: true });
}));
