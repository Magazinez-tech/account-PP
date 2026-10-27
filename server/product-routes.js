// Product / service catalog (รายการสินค้า). Document lines copy name, unit and price from here,
// so editing a product never changes documents already written.
import { Router } from 'express';
import { db } from './db.js';
import { h, text } from './helpers.js';

export const products = Router();

const satang = (v) => Math.max(0, Math.round(Number(v) || 0));

function fields(body) {
  return {
    code: text(body.code),
    name: text(body.name),
    size: text(body.size),
    unit: text(body.unit),
    price: satang(body.price),
    cost: satang(body.cost),
    note: text(body.note),
    active: body.active !== false,
  };
}

products.get('/products', h(async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const onlyActive = req.query.active === '1';
  res.json(await db.many(`SELECT * FROM products
                          WHERE (name ILIKE $1 OR code ILIKE $1 OR size ILIKE $1) AND ($2::boolean = FALSE OR active)
                          ORDER BY code NULLS LAST, name LIMIT 1000`, [q, onlyActive]));
}));

products.post('/products', h(async (req, res) => {
  const f = fields(req.body);
  if (!f.name) return res.status(400).json({ error: 'กรุณาระบุชื่อสินค้า' });
  const row = await db.one(`INSERT INTO products (code, name, unit, price, cost, note, active, size)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
  [f.code, f.name, f.unit, f.price, f.cost, f.note, f.active, f.size]);
  res.status(201).json({ id: row.id });
}));

products.put('/products/:id', h(async (req, res) => {
  const f = fields(req.body);
  if (!f.name) return res.status(400).json({ error: 'กรุณาระบุชื่อสินค้า' });
  await db.run(`UPDATE products SET code=$1, name=$2, unit=$3, price=$4, cost=$5, note=$6, active=$7, size=$8 WHERE id = $9`,
    [f.code, f.name, f.unit, f.price, f.cost, f.note, f.active, f.size, req.params.id]);
  res.json({ ok: true });
}));

products.delete('/products/:id', h(async (req, res) => {
  await db.run('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));
