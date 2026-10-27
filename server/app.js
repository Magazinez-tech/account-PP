// Express application. Used by the local server (server/index.js) and by the Netlify Function
// (netlify/functions/api.js). It does not start listening itself.
import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { login, logout, sessionCookie, clearCookie, requireAuth, readCookie } from './auth.js';
import { api } from './routes.js';

// Project root = the folder the server is started from. Not import.meta.url: Netlify bundles
// the function as CommonJS, where import.meta.url is undefined.
const root = process.cwd();

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.post('/api/login', async (req, res, next) => {
    try {
      const result = await login(String(req.body.email || '').trim(), String(req.body.password || ''));
      if (!result) return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
      res.setHeader('Set-Cookie', sessionCookie(result.token));
      res.json(result.user);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/logout', async (req, res, next) => {
    try {
      const token = readCookie(req, 'sid');
      if (token) await logout(token);
      res.setHeader('Set-Cookie', clearCookie());
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/me', requireAuth, (req, res) => res.json(req.user));

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'ไม่พบ API นี้' }));

  // Serve the built React app when it exists locally. On Netlify the static files come from the CDN.
  const dist = join(root, 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(join(dist, 'index.html')));
  }

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
  });

  return app;
}
