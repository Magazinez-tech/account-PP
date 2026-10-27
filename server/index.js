import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './db.js';
import { seedAdmin, login, logout, sessionCookie, clearCookie, requireAuth } from './auth.js';
import { api } from './routes.js';
import { seedChart, backfill } from './accounting.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(express.json({ limit: '1mb' }));

seedAdmin();
seedChart();
backfill();

app.post('/api/login', (req, res) => {
  const result = login(String(req.body.email || '').trim(), String(req.body.password || ''));
  if (!result) return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  res.setHeader('Set-Cookie', sessionCookie(result.token));
  res.json(result.user);
});

app.post('/api/logout', (req, res) => {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  if (match) logout(match[1]);
  res.setHeader('Set-Cookie', clearCookie());
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json(req.user));

app.use('/api', api);

app.use('/api', (req, res) => res.status(404).json({ error: 'ไม่พบ API นี้' }));

// Serve the built React app in production.
const dist = join(root, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
