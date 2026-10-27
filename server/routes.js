import { Router } from 'express';
import { db, tx, nextNumber, nextMonthlyNo } from './db.js';
import { requireAuth } from './auth.js';
import { calcTotals, validateItems } from './money.js';
import { postInvoice, postPayment, reverseSource, accountingSummary } from './accounting.js';
import { accounting } from './accounting-routes.js';
import { BizError } from './errors.js';

export const api = Router();
api.use(requireAuth);
api.use(accounting);

// Wraps async handlers: business errors become 400, everything else goes to the error handler (500).
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch((err) => {
  if (err instanceof BizError) return res.status(400).json({ error: err.message });
  next(err);
});

const today = () => new Date().toISOString().slice(0, 10);

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

const text = (v) => String(v || '').trim() || null;

// Project, reference and salesperson fields shown on both quotations and tax invoices.
function projectOf(body) {
  return { project: text(body.project_name), reference: text(body.reference_no), salesperson: text(body.salesperson) };
}

async function insertItems(d, table, parentColumn, parentId, lines) {
  for (const line of lines) {
    await d.run(`INSERT INTO ${table} (${parentColumn}, description, qty, unit, unit_price, amount, sort)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [parentId, line.description, line.qty, line.unit, line.unit_price, line.amount, line.sort]);
  }
}

async function loadDocument(table, itemsTable, parentColumn, id) {
  const doc = await db.one(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (!doc) return null;
  doc.items = await db.many(`SELECT * FROM ${itemsTable} WHERE ${parentColumn} = $1 ORDER BY sort, id`, [id]);
  return doc;
}

// ---------- Customers ----------

api.get('/customers', h(async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  res.json(await db.many(`SELECT * FROM customers
                          WHERE name ILIKE $1 OR tax_id ILIKE $1 OR phone ILIKE $1
                          ORDER BY name LIMIT 500`, [q]));
}));

api.get('/customers/:id', h(async (req, res) => {
  const customer = await db.one('SELECT * FROM customers WHERE id = $1', [req.params.id]);
  if (!customer) return res.status(404).json({ error: 'ไม่พบลูกค้า' });
  const invoices = await db.many(`SELECT id, no, issue_date, status, total, paid FROM invoices
                                  WHERE customer_id = $1 AND status != 'draft' ORDER BY issue_date DESC`, [customer.id]);
  res.json({ ...customer, invoices });
}));

function customerFields(body) {
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

api.post('/customers', h(async (req, res) => {
  const f = customerFields(req.body);
  if (!f.name) return res.status(400).json({ error: 'กรุณาระบุชื่อลูกค้า' });
  const row = await db.one(`INSERT INTO customers (name, company_name, tax_id, branch, address, contact_name, phone, email, credit_days, note)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
  [f.name, f.company_name, f.tax_id, f.branch, f.address, f.contact_name, f.phone, f.email, f.credit_days, f.note]);
  res.status(201).json({ id: row.id });
}));

api.put('/customers/:id', h(async (req, res) => {
  const f = customerFields(req.body);
  if (!f.name) return res.status(400).json({ error: 'กรุณาระบุชื่อลูกค้า' });
  await db.run(`UPDATE customers SET name=$1, company_name=$2, tax_id=$3, branch=$4, address=$5,
                contact_name=$6, phone=$7, email=$8, credit_days=$9, note=$10 WHERE id = $11`,
  [f.name, f.company_name, f.tax_id, f.branch, f.address, f.contact_name, f.phone, f.email, f.credit_days, f.note, req.params.id]);
  res.json({ ok: true });
}));

api.delete('/customers/:id', h(async (req, res) => {
  const row = await db.one(`SELECT (SELECT COUNT(*) FROM invoices WHERE customer_id = $1)
                            + (SELECT COUNT(*) FROM quotations WHERE customer_id = $1) AS count`, [req.params.id]);
  if (row.count > 0) return res.status(400).json({ error: 'ลบไม่ได้ เพราะลูกค้ารายนี้มีเอกสารแล้ว' });
  await db.run('DELETE FROM customers WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- Quotations ----------

const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected'];

api.get('/quotations', h(async (req, res) => {
  const params = [];
  let where = 'TRUE';
  if (req.query.status) {
    params.push(req.query.status);
    where += ` AND q.status = $${params.length}`;
  }
  res.json(await db.many(`SELECT q.*, c.name AS customer_name FROM quotations q
                          JOIN customers c ON c.id = q.customer_id
                          WHERE ${where} ORDER BY q.issue_date DESC, q.id DESC LIMIT 500`, params));
}));

api.get('/quotations/:id', h(async (req, res) => {
  const doc = await loadDocument('quotations', 'quotation_items', 'quotation_id', req.params.id);
  if (!doc) return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
  doc.customer = await db.one('SELECT * FROM customers WHERE id = $1', [doc.customer_id]);
  res.json(doc);
}));

async function saveQuotation(d, id, body) {
  const err = validateItems(body.items);
  if (err) throw new BizError(err);
  const customerId = Number(body.customer_id);
  if (!(await d.one('SELECT id FROM customers WHERE id = $1', [customerId]))) throw new BizError('กรุณาเลือกลูกค้า');
  const totals = calcTotals(body.items, Number(body.discount) || 0);
  const issueDate = body.issue_date || today();
  const validUntil = body.valid_until || addDays(issueDate, 30);
  const note = text(body.note);
  const pf = projectOf(body);

  let quotationId = id;
  if (id) {
    await d.run(`UPDATE quotations SET customer_id=$1, issue_date=$2, valid_until=$3, discount=$4, subtotal=$5, vat=$6, total=$7,
                 note=$8, project_name=$9, reference_no=$10, salesperson=$11, updated_at=now() WHERE id=$12`,
    [customerId, issueDate, validUntil, totals.discount, totals.subtotal, totals.vat, totals.total, note, pf.project, pf.reference, pf.salesperson, id]);
    await d.run('DELETE FROM quotation_items WHERE quotation_id = $1', [id]);
  } else {
    const no = await nextMonthlyNo(d, 'PP', issueDate);
    const row = await d.one(`INSERT INTO quotations (no, customer_id, issue_date, valid_until, discount, subtotal, vat, total,
                             note, project_name, reference_no, salesperson)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [no, customerId, issueDate, validUntil, totals.discount, totals.subtotal, totals.vat, totals.total,
      note, pf.project, pf.reference, pf.salesperson]);
    quotationId = row.id;
  }
  await insertItems(d, 'quotation_items', 'quotation_id', quotationId, totals.lines);
  return { id: quotationId };
}

api.post('/quotations', h(async (req, res) => {
  const result = await tx((d) => saveQuotation(d, null, req.body));
  res.status(201).json(result);
}));

api.put('/quotations/:id', h(async (req, res) => {
  const current = await db.one('SELECT status FROM quotations WHERE id = $1', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
  if (current.status !== 'draft') return res.status(400).json({ error: 'แก้ไขได้เฉพาะใบเสนอราคาที่ยังเป็นร่าง' });
  res.json(await tx((d) => saveQuotation(d, Number(req.params.id), req.body)));
}));

api.patch('/quotations/:id/status', h(async (req, res) => {
  const { status } = req.body;
  if (!QUOTATION_STATUSES.includes(status)) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
  const result = await db.run(`UPDATE quotations SET status = $1, updated_at = now() WHERE id = $2`, [status, req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
  res.json({ ok: true });
}));

api.delete('/quotations/:id', h(async (req, res) => {
  const current = await db.one('SELECT status, invoice_id FROM quotations WHERE id = $1', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
  if (current.status !== 'draft' || current.invoice_id) {
    return res.status(400).json({ error: 'ลบได้เฉพาะใบเสนอราคาร่างที่ยังไม่ได้แปลงเป็นใบแจ้งหนี้' });
  }
  await db.run('DELETE FROM quotations WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// Creates a draft invoice copying the quotation's items. Each quotation converts once.
api.post('/quotations/:id/convert', h(async (req, res) => {
  const quotation = await loadDocument('quotations', 'quotation_items', 'quotation_id', req.params.id);
  if (!quotation) return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
  if (quotation.invoice_id) return res.status(400).json({ error: 'ใบเสนอราคานี้ถูกแปลงเป็นใบแจ้งหนี้แล้ว' });
  const customer = await db.one('SELECT credit_days FROM customers WHERE id = $1', [quotation.customer_id]);
  const issueDate = today();
  // The quotation's details carry over; its number becomes the invoice's reference.
  const id = await tx(async (d) => {
    const row = await d.one(`INSERT INTO invoices (customer_id, quotation_id, issue_date, due_date, discount, subtotal, vat, total, note,
                             project_name, reference_no, salesperson)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [quotation.customer_id, quotation.id, issueDate, addDays(issueDate, customer.credit_days),
      quotation.discount, quotation.subtotal, quotation.vat, quotation.total, quotation.note,
      quotation.project_name, quotation.no, quotation.salesperson]);
    await insertItems(d, 'invoice_items', 'invoice_id', row.id, quotation.items);
    await d.run(`UPDATE quotations SET invoice_id = $1, status = 'accepted', updated_at = now() WHERE id = $2`, [row.id, quotation.id]);
    return row.id;
  });
  res.status(201).json({ id });
}));

// ---------- Invoices (ใบกำกับภาษี) ----------

api.get('/invoices', h(async (req, res) => {
  const params = [];
  let where = 'TRUE';
  if (req.query.status) {
    params.push(req.query.status);
    where += ` AND i.status = $${params.length}`;
  }
  if (req.query.customer_id) {
    params.push(req.query.customer_id);
    where += ` AND i.customer_id = $${params.length}`;
  }
  res.json(await db.many(`SELECT i.*, c.name AS customer_name FROM invoices i
                          JOIN customers c ON c.id = i.customer_id
                          WHERE ${where} ORDER BY i.issue_date DESC, i.id DESC LIMIT 500`, params));
}));

api.get('/invoices/:id', h(async (req, res) => {
  const doc = await loadDocument('invoices', 'invoice_items', 'invoice_id', req.params.id);
  if (!doc) return res.status(404).json({ error: 'ไม่พบใบแจ้งหนี้' });
  doc.customer = await db.one('SELECT * FROM customers WHERE id = $1', [doc.customer_id]);
  doc.payments = await db.many('SELECT * FROM payments WHERE invoice_id = $1 ORDER BY paid_date, id', [doc.id]);
  res.json(doc);
}));

async function saveInvoice(d, id, body) {
  const err = validateItems(body.items);
  if (err) throw new BizError(err);
  const customerId = Number(body.customer_id);
  const customer = await d.one('SELECT * FROM customers WHERE id = $1', [customerId]);
  if (!customer) throw new BizError('กรุณาเลือกลูกค้า');
  const totals = calcTotals(body.items, Number(body.discount) || 0);
  const issueDate = body.issue_date || today();
  const dueDate = body.due_date || addDays(issueDate, customer.credit_days);
  const note = text(body.note);
  const pf = projectOf(body);

  let invoiceId = id;
  if (id) {
    await d.run(`UPDATE invoices SET customer_id=$1, issue_date=$2, due_date=$3, discount=$4, subtotal=$5, vat=$6, total=$7,
                 note=$8, project_name=$9, reference_no=$10, salesperson=$11, updated_at=now() WHERE id=$12`,
    [customerId, issueDate, dueDate, totals.discount, totals.subtotal, totals.vat, totals.total,
      note, pf.project, pf.reference, pf.salesperson, id]);
    await d.run('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);
  } else {
    const row = await d.one(`INSERT INTO invoices (customer_id, issue_date, due_date, discount, subtotal, vat, total, note,
                             project_name, reference_no, salesperson)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [customerId, issueDate, dueDate, totals.discount, totals.subtotal, totals.vat, totals.total, note,
      pf.project, pf.reference, pf.salesperson]);
    invoiceId = row.id;
  }
  await insertItems(d, 'invoice_items', 'invoice_id', invoiceId, totals.lines);
  return { id: invoiceId };
}

api.post('/invoices', h(async (req, res) => {
  res.status(201).json(await tx((d) => saveInvoice(d, null, req.body)));
}));

api.put('/invoices/:id', h(async (req, res) => {
  const current = await db.one('SELECT status FROM invoices WHERE id = $1', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'ไม่พบใบแจ้งหนี้' });
  if (current.status !== 'draft') return res.status(400).json({ error: 'แก้ไขได้เฉพาะใบแจ้งหนี้ที่ยังเป็นร่าง' });
  res.json(await tx((d) => saveInvoice(d, Number(req.params.id), req.body)));
}));

// Issuing assigns the legal tax-invoice number. After this the document is locked.
api.post('/invoices/:id/issue', h(async (req, res) => {
  const no = await tx(async (d) => {
    const invoice = await d.one('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!invoice) throw new BizError('ไม่พบใบแจ้งหนี้');
    if (invoice.status !== 'draft') throw new BizError('ออกเอกสารไปแล้ว');
    const number = await nextNumber(d, 'INV');
    await d.run(`UPDATE invoices SET status = 'issued', no = $1, updated_at = now() WHERE id = $2`, [number, invoice.id]);
    await postInvoice(d, { ...invoice, no: number });
    return number;
  });
  res.json({ no });
}));

api.post('/invoices/:id/cancel', h(async (req, res) => {
  await tx(async (d) => {
    const invoice = await d.one('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!invoice) throw new BizError('ไม่พบใบแจ้งหนี้');
    if (invoice.status === 'draft') {
      await d.run('DELETE FROM invoices WHERE id = $1', [invoice.id]);
      return;
    }
    if (invoice.status === 'cancelled') throw new BizError('ยกเลิกไปแล้ว');
    if (invoice.paid > 0) throw new BizError('มีการรับชำระแล้ว ต้องลบรายการรับชำระก่อน');
    await reverseSource(d, 'invoice', invoice.id, today());
    await d.run(`UPDATE invoices SET status = 'cancelled', updated_at = now() WHERE id = $1`, [invoice.id]);
  });
  res.json({ ok: true });
}));

// Credit term normally counts from the issue date. Due date can be changed after issuing,
// because it is a payment deadline, not a legal field of the tax invoice.
api.patch('/invoices/:id/due-date', h(async (req, res) => {
  const invoice = await db.one('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
  if (!invoice) return res.status(404).json({ error: 'ไม่พบใบแจ้งหนี้' });
  if (invoice.status === 'cancelled') return res.status(400).json({ error: 'ใบที่ยกเลิกแล้วแก้วันครบกำหนดไม่ได้' });
  const dueDate = String(req.body.due_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(dueDate))) {
    return res.status(400).json({ error: 'วันครบกำหนดไม่ถูกต้อง' });
  }
  if (dueDate < invoice.issue_date) return res.status(400).json({ error: 'วันครบกำหนดต้องไม่ก่อนวันที่ออกใบกำกับภาษี' });
  await db.run(`UPDATE invoices SET due_date = $1, updated_at = now() WHERE id = $2`, [dueDate, invoice.id]);
  res.json({ ok: true });
}));

// ---------- Payments (ใบเสร็จรับเงิน) ----------

api.post('/invoices/:id/payments', h(async (req, res) => {
  const receiptNo = await tx(async (d) => {
    // Lock the invoice row so two receipts cannot both pass the outstanding-balance check.
    const invoice = await d.one('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!invoice) throw new BizError('ไม่พบใบแจ้งหนี้');
    if (!['issued', 'paid'].includes(invoice.status)) throw new BizError('รับชำระได้เฉพาะใบแจ้งหนี้ที่ออกแล้ว');
    const amount = Math.round(Number(req.body.amount) * 100);
    const outstanding = invoice.total - invoice.paid;
    if (!(amount > 0)) throw new BizError('จำนวนเงินต้องมากกว่า 0');
    if (amount > outstanding) throw new BizError('จำนวนเงินมากกว่ายอดคงค้าง');

    const no = await nextNumber(d, 'RC');
    const paidDate = req.body.paid_date || today();
    const method = req.body.method || 'cash';
    const note = text(req.body.note);
    const row = await d.one(`INSERT INTO payments (invoice_id, receipt_no, paid_date, amount, method, note)
                             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [invoice.id, no, paidDate, amount, method, note]);
    const paid = invoice.paid + amount;
    const status = paid >= invoice.total ? 'paid' : 'issued';
    await d.run(`UPDATE invoices SET paid = $1, status = $2, updated_at = now() WHERE id = $3`, [paid, status, invoice.id]);
    await postPayment(d, { id: row.id, receipt_no: no, paid_date: paidDate, amount, method }, invoice.no);
    return no;
  });
  res.status(201).json({ receipt_no: receiptNo });
}));

api.delete('/payments/:id', h(async (req, res) => {
  await tx(async (d) => {
    const payment = await d.one('SELECT * FROM payments WHERE id = $1', [req.params.id]);
    if (!payment) throw new BizError('ไม่พบรายการรับชำระ');
    const invoice = await d.one('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [payment.invoice_id]);
    await reverseSource(d, 'payment', payment.id, today());
    await d.run('DELETE FROM payments WHERE id = $1', [payment.id]);
    const paid = invoice.paid - payment.amount;
    const status = paid >= invoice.total ? 'paid' : 'issued';
    await d.run(`UPDATE invoices SET paid = $1, status = $2, updated_at = now() WHERE id = $3`, [paid, status, invoice.id]);
  });
  res.json({ ok: true });
}));

// ---------- Receipts (ใบเสร็จรับเงิน): one receipt per payment ----------

api.get('/receipts', h(async (req, res) => {
  res.json(await db.many(`SELECT p.id, p.receipt_no, p.paid_date, p.amount, p.method,
                            i.id AS invoice_id, i.no AS invoice_no, c.name AS customer_name
                          FROM payments p
                          JOIN invoices i ON i.id = p.invoice_id
                          JOIN customers c ON c.id = i.customer_id
                          ORDER BY p.paid_date DESC, p.id DESC LIMIT 500`));
}));

// Builds the receipt in the same shape as a quotation or invoice so the shared paper layout can print it.
async function receiptOf(id) {
  const p = await db.one(`SELECT p.*, i.no AS invoice_no, i.total AS invoice_total, i.vat AS invoice_vat, i.paid AS invoice_paid,
                            i.customer_id, i.project_name, i.salesperson, i.status AS invoice_status
                          FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = $1`, [id]);
  if (!p) return null;
  // The amount received includes VAT. Its VAT share follows the invoice's VAT ratio,
  // so a partial payment shows the same tax split as the tax invoice.
  const vat = p.invoice_total > 0 ? Math.round((p.amount * p.invoice_vat) / p.invoice_total) : 0;
  const subtotal = p.amount - vat;
  return {
    id: p.id,
    no: p.receipt_no,
    issue_date: p.paid_date,
    customer: await db.one('SELECT * FROM customers WHERE id = $1', [p.customer_id]),
    items: [{
      description: `ชำระค่าสินค้า/บริการตามใบกำกับภาษีเลขที่ ${p.invoice_no}`,
      qty: 1, unit: null, unit_price: subtotal, amount: subtotal,
    }],
    subtotal,
    discount: 0,
    vat,
    total: p.amount,
    method: p.method,
    note: p.note,
    invoice_id: p.invoice_id,
    invoice_no: p.invoice_no,
    invoice_outstanding: p.invoice_total - p.invoice_paid,
    project_name: p.project_name,
    reference_no: p.invoice_no,
    salesperson: p.salesperson,
    status: 'paid',
  };
}

api.get('/receipts/:id', h(async (req, res) => {
  const doc = await receiptOf(req.params.id);
  if (!doc) return res.status(404).json({ error: 'ไม่พบใบเสร็จรับเงิน' });
  res.json(doc);
}));

// ---------- Company settings (printed on documents) ----------

const SETTING_FIELDS = ['name', 'address', 'phone', 'email', 'website', 'tax_id',
  'bank_name', 'bank_account_no', 'bank_account_name', 'approver_name', 'quotation_terms'];

api.get('/settings', h(async (req, res) => {
  res.json(await db.one('SELECT * FROM company_settings WHERE id = 1'));
}));

api.put('/settings', h(async (req, res) => {
  const values = SETTING_FIELDS.map((f) => text(req.body[f]));
  if (!values[0]) return res.status(400).json({ error: 'กรุณาระบุชื่อบริษัท' });
  await db.run(`UPDATE company_settings SET ${SETTING_FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ')} WHERE id = 1`, values);
  res.json({ ok: true });
}));

// Company logo / stamp, stored as a data URL so it prints without a file server.
const LOGO_MAX_BYTES = 700 * 1024;
const LOGO_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

api.put('/settings/logo', h(async (req, res) => {
  const data = String(req.body.data || '');
  if (!LOGO_PATTERN.test(data)) return res.status(400).json({ error: 'รองรับเฉพาะไฟล์รูป PNG, JPG หรือ WEBP' });
  const bytes = Math.floor((data.split(',')[1].length * 3) / 4);
  if (bytes > LOGO_MAX_BYTES) return res.status(400).json({ error: 'ไฟล์รูปต้องมีขนาดไม่เกิน 700 KB' });
  await db.run('UPDATE company_settings SET logo = $1 WHERE id = 1', [data]);
  res.json({ ok: true });
}));

api.delete('/settings/logo', h(async (req, res) => {
  await db.run('UPDATE company_settings SET logo = NULL WHERE id = 1');
  res.json({ ok: true });
}));

// ---------- Dashboard & reports ----------

api.get('/dashboard', h(async (req, res) => {
  const month = today().slice(0, 7);
  const sales = await db.one(`SELECT COALESCE(SUM(total), 0) AS total FROM invoices
                              WHERE status IN ('issued','paid') AND left(issue_date, 7) = $1`, [month]);
  const outstanding = await db.one(`SELECT COALESCE(SUM(total - paid), 0) AS total FROM invoices WHERE status = 'issued'`);
  const overdue = await db.one(`SELECT COALESCE(SUM(total - paid), 0) AS total, COUNT(*) AS count FROM invoices
                                WHERE status = 'issued' AND due_date < $1`, [today()]);
  const openQuotations = await db.one(`SELECT COUNT(*) AS count FROM quotations WHERE status IN ('draft','sent')`);
  const collected = await db.one(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE left(paid_date, 7) = $1`, [month]);
  const upcoming = await db.many(`SELECT i.id, i.no, i.due_date, i.total, i.paid, c.name AS customer_name
                                  FROM invoices i JOIN customers c ON c.id = i.customer_id
                                  WHERE i.status = 'issued' AND i.total > i.paid
                                  ORDER BY i.due_date LIMIT 8`);
  const dueThisMonth = await db.many(`SELECT due_date, total, paid FROM invoices
                                      WHERE status = 'issued' AND total > paid AND left(due_date, 7) = $1`, [month]);
  res.json({
    salesThisMonth: sales.total,
    outstanding: outstanding.total,
    overdue: overdue.total,
    overdueCount: overdue.count,
    openQuotations: openQuotations.count,
    collectedThisMonth: collected.total,
    upcoming,
    dueThisMonth,
    today: today(),
    accounting: await accountingSummary(db),
  });
}));

api.get('/reports/aging', h(async (req, res) => {
  const rows = await db.many(`SELECT i.id, i.no, i.issue_date, i.due_date, i.total, i.paid, c.name AS customer_name
                              FROM invoices i JOIN customers c ON c.id = i.customer_id
                              WHERE i.status = 'issued' AND i.total > i.paid ORDER BY i.due_date`);
  const now = new Date(today());
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  const items = rows.map((row) => {
    const days = Math.floor((now - new Date(row.due_date)) / 86400000);
    const outstanding = row.total - row.paid;
    const key = days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90plus';
    buckets[key] += outstanding;
    return { ...row, outstanding, days_overdue: Math.max(0, days) };
  });
  res.json({ buckets, items });
}));
