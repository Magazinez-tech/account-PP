// Small helpers shared by the sales routes (routes.js) and purchasing routes (purchase-routes.js).
import { db } from './db.js';
import { BizError } from './errors.js';

// Wraps async handlers: business errors become 400, everything else goes to the error handler (500).
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch((err) => {
  if (err instanceof BizError) return res.status(400).json({ error: err.message });
  next(err);
});

export const today = () => new Date().toISOString().slice(0, 10);

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export const text = (v) => String(v || '').trim() || null;

export const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));

// Project, reference and person fields shown on quotations, tax invoices and purchase orders.
export function projectOf(body) {
  return { project: text(body.project_name), reference: text(body.reference_no), salesperson: text(body.salesperson) };
}

export async function insertItems(d, table, parentColumn, parentId, lines) {
  for (const line of lines) {
    await d.run(`INSERT INTO ${table} (${parentColumn}, description, qty, unit, unit_price, amount, sort, size)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [parentId, line.description, line.qty, line.unit, line.unit_price, line.amount, line.sort, line.size || null]);
  }
}

export async function loadDocument(table, itemsTable, parentColumn, id) {
  const doc = await db.one(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (!doc) return null;
  if (doc.created_by) {
    const creator = await db.one('SELECT name, email FROM users WHERE id = $1', [doc.created_by]);
    doc.created_by_name = creator ? creator.name || creator.email : null;
  }
  doc.items = await db.many(`SELECT * FROM ${itemsTable} WHERE ${parentColumn} = $1 ORDER BY sort, id`, [id]);
  return doc;
}

// Contact fields shared by customers and suppliers.
export function partyFields(body) {
  return {
    name: String(body.name || '').trim(),
    company_name: text(body.company_name),
    tax_id: text(body.tax_id),
    branch: text(body.branch),
    address: text(body.address),
    contact_name: text(body.contact_name),
    phone: text(body.phone),
    email: text(body.email),
    credit_days: Number.isInteger(Number(body.credit_days)) ? Number(body.credit_days) : 30,
    note: text(body.note),
  };
}
