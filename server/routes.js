import { Router } from 'express';
import { db, tx, nextNumber, nextMonthlyNo } from './db.js';
import { requireAuth } from './auth.js';
import { calcTotals, validateItems } from './money.js';
import { postInvoice, postPayment, reverseSource, accountingSummary } from './accounting.js';
import { accounting } from './accounting-routes.js';

export const api = Router();
api.use(requireAuth);
api.use(accounting);

// Company logo / stamp, stored as a data URL so it prints without a file server.
const LOGO_MAX_BYTES = 700 * 1024;
const LOGO_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

api.put('/settings/logo', (req, res) => {
  const data = String(req.body.data || '');
  if (!LOGO_PATTERN.test(data)) return badRequest(res, 'รองรับเฉพาะไฟล์รูป PNG, JPG หรือ WEBP');
  const bytes = Math.floor((data.split(',')[1].length * 3) / 4);
  if (bytes > LOGO_MAX_BYTES) return badRequest(res, 'ไฟล์รูปต้องมีขนาดไม่เกิน 700 KB');
  db.prepare('UPDATE company_settings SET logo = ? WHERE id = 1').run(data);
  res.json({ ok: true });
});

api.delete('/settings/logo', (req, res) => {
  db.prepare('UPDATE company_settings SET logo = NULL WHERE id = 1').run();
  res.json({ ok: true });
});

// ---------- PDF ----------


// ---------- Company settings (printed on documents) ----------

const SETTING_FIELDS = ['name', 'address', 'phone', 'email', 'website', 'tax_id',
  'bank_name', 'bank_account_no', 'bank_account_name', 'approver_name', 'quotation_terms'];

api.get('/settings', (req, res) => {
  res.json(db.prepare('SELECT * FROM company_settings WHERE id = 1').get());
});

api.put('/settings', (req, res) => {
  const values = Object.fromEntries(SETTING_FIELDS.map((f) => [f, String(req.body[f] || '').trim() || null]));
  if (!values.name) return badRequest(res, 'กรุณาระบุชื่อบริษัท');
  db.prepare(`UPDATE company_settings SET ${SETTING_FIELDS.map((f) => `${f} = @${f}`).join(', ')} WHERE id = 1`).run(values);
  res.json({ ok: true });
});

const today = () => new Date().toISOString().slice(0, 10);

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

// Project, reference and salesperson fields shown on both quotations and tax invoices.
function projectOf(body) {
  const text = (v) => String(v || '').trim() || null;
  return {
    project: text(body.project_name),
    reference: text(body.reference_no),
    salesperson: text(body.salesperson),
  };
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function insertItems(table, parentColumn, parentId, lines) {
  const stmt = db.prepare(`INSERT INTO ${table} (${parentColumn}, description, qty, unit, unit_price, amount, sort)
                           VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const line of lines) {
    stmt.run(parentId, line.description, line.qty, line.unit, line.unit_price, line.amount, line.sort);
  }
}

// ---------- Customers ----------

api.get('/customers', (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const rows = db.prepare(`SELECT * FROM customers
                           WHERE name LIKE ? OR tax_id LIKE ? OR phone LIKE ?
                           ORDER BY name LIMIT 500`).all(q, q, q);
  res.json(rows);
});

api.get('/customers/:id', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'ไม่พบลูกค้า' });
  const invoices = db.prepare(`SELECT id, no, issue_date, status, total, paid FROM invoices
                               WHERE customer_id = ? AND status != 'draft' ORDER BY issue_date DESC`).all(customer.id);
  res.json({ ...customer, invoices });
});

function customerFields(body) {
  return {
    name: String(body.name || '').trim(),
    company_name: String(body.company_name || '').trim() || null,
    tax_id: String(body.tax_id || '').trim() || null,
    branch: String(body.branch || '').trim() || null,
    address: String(body.address || '').trim() || null,
    contact_name: String(body.contact_name || '').trim() || null,
    phone: String(body.phone || '').trim() || null,
    email: String(body.email || '').trim() || null,
    credit_days: Number.isInteger(Number(body.credit_days)) ? Number(body.credit_days) : 30,
    note: String(body.note || '').trim() || null,
  };
}

api.post('/customers', (req, res) => {
  const f = customerFields(req.body);
  if (!f.name) return badRequest(res, 'กรุณาระบุชื่อลูกค้า');
  const info = db.prepare(`INSERT INTO customers (name, company_name, tax_id, branch, address, contact_name, phone, email, credit_days, note)
                           VALUES (@name, @company_name, @tax_id, @branch, @address, @contact_name, @phone, @email, @credit_days, @note)`).run(f);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

api.put('/customers/:id', (req, res) => {
  const f = customerFields(req.body);
  if (!f.name) return badRequest(res, 'กรุณาระบุชื่อลูกค้า');
  db.prepare(`UPDATE customers SET name=@name, company_name=@company_name, tax_id=@tax_id, branch=@branch, address=@address,
              contact_name=@contact_name, phone=@phone, email=@email, credit_days=@credit_days, note=@note
              WHERE id = @id`).run({ ...f, id: req.params.id });
  res.json({ ok: true });
});

api.delete('/customers/:id', (req, res) => {
  const { count } = db.prepare(`SELECT (SELECT COUNT(*) FROM invoices WHERE customer_id = @id)
                                + (SELECT COUNT(*) FROM quotations WHERE customer_id = @id) AS count`).get({ id: req.params.id });
  if (count > 0) return badRequest(res, 'ลบไม่ได้ เพราะลูกค้ารายนี้มีเอกสารแล้ว');
  db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Documents shared logic (quotations & invoices) ----------

function loadDocument(table, itemsTable, parentColumn, id) {
  const doc = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!doc) return null;
  doc.items = db.prepare(`SELECT * FROM ${itemsTable} WHERE ${parentColumn} = ? ORDER BY sort, id`).all(id);
  return doc;
}

// ---------- Quotations ----------

const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected'];

api.get('/quotations', (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.status) {
    where += ' AND q.status = ?';
    params.push(req.query.status);
  }
  const rows = db.prepare(`SELECT q.*, c.name AS customer_name FROM quotations q
                           JOIN customers c ON c.id = q.customer_id
                           WHERE ${where} ORDER BY q.issue_date DESC, q.id DESC LIMIT 500`).all(...params);
  res.json(rows);
});

api.get('/quotations/:id', (req, res) => {
  const doc = loadDocument('quotations', 'quotation_items', 'quotation_id', req.params.id);
  if (!doc) return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
  doc.customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(doc.customer_id);
  res.json(doc);
});

function saveQuotation(id, body) {
  const err = validateItems(body.items);
  if (err) return { error: err };
  const customerId = Number(body.customer_id);
  if (!db.prepare('SELECT id FROM customers WHERE id = ?').get(customerId)) return { error: 'กรุณาเลือกลูกค้า' };
  const totals = calcTotals(body.items, Number(body.discount) || 0);
  const issueDate = body.issue_date || today();
  const validUntil = body.valid_until || addDays(issueDate, 30);
  const note = String(body.note || '').trim() || null;
  const projectFields = projectOf(body);
  const { project, reference, salesperson } = projectFields;

  return tx(() => {
    let quotationId = id;
    if (id) {
      db.prepare(`UPDATE quotations SET customer_id=?, issue_date=?, valid_until=?, discount=?, subtotal=?, vat=?, total=?,
                  note=?, project_name=?, reference_no=?, salesperson=?, updated_at=datetime('now') WHERE id=?`)
        .run(customerId, issueDate, validUntil, totals.discount, totals.subtotal, totals.vat, totals.total,
          note, project, reference, salesperson, id);
      db.prepare('DELETE FROM quotation_items WHERE quotation_id = ?').run(id);
    } else {
      const info = db.prepare(`INSERT INTO quotations (no, customer_id, issue_date, valid_until, discount, subtotal, vat, total,
                               note, project_name, reference_no, salesperson)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(nextMonthlyNo('PP', issueDate), customerId, issueDate, validUntil, totals.discount, totals.subtotal, totals.vat, totals.total,
          note, project, reference, salesperson);
      quotationId = Number(info.lastInsertRowid);
    }
    insertItems('quotation_items', 'quotation_id', quotationId, totals.lines);
    return { id: quotationId };
  });
}

api.post('/quotations', (req, res) => {
  const result = saveQuotation(null, req.body);
  if (result.error) return badRequest(res, result.error);
  res.status(201).json(result);
});

api.put('/quotations/:id', (req, res) => {
  const current = db.prepare('SELECT status, invoice_id FROM quotations WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
  if (current.status !== 'draft') return badRequest(res, 'แก้ไขได้เฉพาะใบเสนอราคาที่ยังเป็นร่าง');
  const result = saveQuotation(Number(req.params.id), req.body);
  if (result.error) return badRequest(res, result.error);
  res.json(result);
});

api.patch('/quotations/:id/status', (req, res) => {
  const { status } = req.body;
  if (!QUOTATION_STATUSES.includes(status)) return badRequest(res, 'สถานะไม่ถูกต้อง');
  const info = db.prepare(`UPDATE quotations SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
  res.json({ ok: true });
});

api.delete('/quotations/:id', (req, res) => {
  const current = db.prepare('SELECT status, invoice_id FROM quotations WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
  if (current.status !== 'draft' || current.invoice_id) return badRequest(res, 'ลบได้เฉพาะใบเสนอราคาร่างที่ยังไม่ได้แปลงเป็นใบแจ้งหนี้');
  db.prepare('DELETE FROM quotations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Creates a draft invoice copying the quotation's items. Each quotation converts once.
api.post('/quotations/:id/convert', (req, res) => {
  const quotation = loadDocument('quotations', 'quotation_items', 'quotation_id', req.params.id);
  if (!quotation) return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
  if (quotation.invoice_id) return badRequest(res, 'ใบเสนอราคานี้ถูกแปลงเป็นใบแจ้งหนี้แล้ว');
  const customer = db.prepare('SELECT credit_days FROM customers WHERE id = ?').get(quotation.customer_id);
  const issueDate = today();
  const invoiceId = tx(() => {
    // The quotation's details carry over; its number becomes the invoice's reference.
    const info = db.prepare(`INSERT INTO invoices (customer_id, quotation_id, issue_date, due_date, discount, subtotal, vat, total, note,
                             project_name, reference_no, salesperson)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(quotation.customer_id, quotation.id, issueDate, addDays(issueDate, customer.credit_days),
        quotation.discount, quotation.subtotal, quotation.vat, quotation.total, quotation.note,
        quotation.project_name, quotation.no, quotation.salesperson);
    const newId = Number(info.lastInsertRowid);
    insertItems('invoice_items', 'invoice_id', newId, quotation.items.map((i) => ({ ...i })));
    db.prepare(`UPDATE quotations SET invoice_id = ?, status = 'accepted', updated_at = datetime('now') WHERE id = ?`)
      .run(newId, quotation.id);
    return newId;
  });
  res.status(201).json({ id: invoiceId });
});

// ---------- Invoices (ใบกำกับภาษี) ----------

api.get('/invoices', (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.status) {
    where += ' AND i.status = ?';
    params.push(req.query.status);
  }
  if (req.query.customer_id) {
    where += ' AND i.customer_id = ?';
    params.push(req.query.customer_id);
  }
  const rows = db.prepare(`SELECT i.*, c.name AS customer_name FROM invoices i
                           JOIN customers c ON c.id = i.customer_id
                           WHERE ${where} ORDER BY i.issue_date DESC, i.id DESC LIMIT 500`).all(...params);
  res.json(rows);
});

api.get('/invoices/:id', (req, res) => {
  const doc = loadDocument('invoices', 'invoice_items', 'invoice_id', req.params.id);
  if (!doc) return res.status(404).json({ error: 'ไม่พบใบแจ้งหนี้' });
  doc.customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(doc.customer_id);
  doc.payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_date, id').all(doc.id);
  res.json(doc);
});

function saveInvoice(id, body) {
  const err = validateItems(body.items);
  if (err) return { error: err };
  const customerId = Number(body.customer_id);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) return { error: 'กรุณาเลือกลูกค้า' };
  const totals = calcTotals(body.items, Number(body.discount) || 0);
  const issueDate = body.issue_date || today();
  const dueDate = body.due_date || addDays(issueDate, customer.credit_days);
  const note = String(body.note || '').trim() || null;
  const projectFields = projectOf(body);

  return tx(() => {
    let invoiceId = id;
    if (id) {
      db.prepare(`UPDATE invoices SET customer_id=?, issue_date=?, due_date=?, discount=?, subtotal=?, vat=?, total=?,
                  note=?, project_name=?, reference_no=?, salesperson=?, updated_at=datetime('now') WHERE id=?`)
        .run(customerId, issueDate, dueDate, totals.discount, totals.subtotal, totals.vat, totals.total,
          note, projectFields.project, projectFields.reference, projectFields.salesperson, id);
      db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(id);
    } else {
      const info = db.prepare(`INSERT INTO invoices (customer_id, issue_date, due_date, discount, subtotal, vat, total, note,
                               project_name, reference_no, salesperson)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(customerId, issueDate, dueDate, totals.discount, totals.subtotal, totals.vat, totals.total, note,
          projectFields.project, projectFields.reference, projectFields.salesperson);
      invoiceId = Number(info.lastInsertRowid);
    }
    insertItems('invoice_items', 'invoice_id', invoiceId, totals.lines);
    return { id: invoiceId };
  });
}

api.post('/invoices', (req, res) => {
  const result = saveInvoice(null, req.body);
  if (result.error) return badRequest(res, result.error);
  res.status(201).json(result);
});

api.put('/invoices/:id', (req, res) => {
  const current = db.prepare('SELECT status FROM invoices WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'ไม่พบใบแจ้งหนี้' });
  if (current.status !== 'draft') return badRequest(res, 'แก้ไขได้เฉพาะใบแจ้งหนี้ที่ยังเป็นร่าง');
  const result = saveInvoice(Number(req.params.id), req.body);
  if (result.error) return badRequest(res, result.error);
  res.json(result);
});

// Issuing assigns the legal tax-invoice number. After this the document is locked.
api.post('/invoices/:id/issue', (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'ไม่พบใบแจ้งหนี้' });
  if (invoice.status !== 'draft') return badRequest(res, 'ออกเอกสารไปแล้ว');
  const no = tx(() => {
    const number = nextNumber('INV');
    db.prepare(`UPDATE invoices SET status = 'issued', no = ?, updated_at = datetime('now') WHERE id = ?`).run(number, invoice.id);
    postInvoice({ ...invoice, no: number });
    return number;
  });
  res.json({ no });
});

api.post('/invoices/:id/cancel', (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'ไม่พบใบแจ้งหนี้' });
  if (invoice.status === 'draft') {
    db.prepare('DELETE FROM invoices WHERE id = ?').run(invoice.id);
    return res.json({ ok: true });
  }
  if (invoice.status === 'cancelled') return badRequest(res, 'ยกเลิกไปแล้ว');
  if (invoice.paid > 0) return badRequest(res, 'มีการรับชำระแล้ว ต้องลบรายการรับชำระก่อน');
  tx(() => {
    reverseSource('invoice', invoice.id, today());
    db.prepare(`UPDATE invoices SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(invoice.id);
  });
  res.json({ ok: true });
});

// Credit term normally counts from the issue date. Due date can be changed after issuing,
// because it is a payment deadline, not a legal field of the tax invoice.
api.patch('/invoices/:id/due-date', (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'ไม่พบใบแจ้งหนี้' });
  if (invoice.status === 'cancelled') return badRequest(res, 'ใบที่ยกเลิกแล้วแก้วันครบกำหนดไม่ได้');
  const dueDate = String(req.body.due_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(dueDate))) {
    return badRequest(res, 'วันครบกำหนดไม่ถูกต้อง');
  }
  if (dueDate < invoice.issue_date) return badRequest(res, 'วันครบกำหนดต้องไม่ก่อนวันที่ออกใบกำกับภาษี');
  db.prepare(`UPDATE invoices SET due_date = ?, updated_at = datetime('now') WHERE id = ?`).run(dueDate, invoice.id);
  res.json({ ok: true });
});

// ---------- Payments (ใบเสร็จรับเงิน) ----------

api.post('/invoices/:id/payments', (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'ไม่พบใบแจ้งหนี้' });
  if (!['issued', 'paid'].includes(invoice.status)) return badRequest(res, 'รับชำระได้เฉพาะใบแจ้งหนี้ที่ออกแล้ว');
  const amount = Math.round(Number(req.body.amount) * 100);
  const outstanding = invoice.total - invoice.paid;
  if (!(amount > 0)) return badRequest(res, 'จำนวนเงินต้องมากกว่า 0');
  if (amount > outstanding) return badRequest(res, 'จำนวนเงินมากกว่ายอดคงค้าง');
  const receiptNo = nextNumber('RC');
  tx(() => {
    const info = db.prepare(`INSERT INTO payments (invoice_id, receipt_no, paid_date, amount, method, note) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(invoice.id, receiptNo, req.body.paid_date || today(), amount, req.body.method || 'cash',
        String(req.body.note || '').trim() || null);
    const paid = invoice.paid + amount;
    const status = paid >= invoice.total ? 'paid' : 'issued';
    db.prepare(`UPDATE invoices SET paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(paid, status, invoice.id);
    postPayment({ id: Number(info.lastInsertRowid), receipt_no: receiptNo, paid_date: req.body.paid_date || today(),
                  amount, method: req.body.method || 'cash' }, invoice.no);
  });
  res.status(201).json({ receipt_no: receiptNo });
});

api.delete('/payments/:id', (req, res) => {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'ไม่พบรายการรับชำระ' });
  tx(() => {
    reverseSource('payment', payment.id, today());
    db.prepare('DELETE FROM payments WHERE id = ?').run(payment.id);
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(payment.invoice_id);
    const paid = invoice.paid - payment.amount;
    const status = paid >= invoice.total ? 'paid' : 'issued';
    db.prepare(`UPDATE invoices SET paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(paid, status, invoice.id);
  });
  res.json({ ok: true });
});

// ---------- Receipts (ใบเสร็จรับเงิน): one receipt per payment ----------

api.get('/receipts', (req, res) => {
  const rows = db.prepare(`SELECT p.id, p.receipt_no, p.paid_date, p.amount, p.method,
                             i.id AS invoice_id, i.no AS invoice_no, c.name AS customer_name
                           FROM payments p
                           JOIN invoices i ON i.id = p.invoice_id
                           JOIN customers c ON c.id = i.customer_id
                           ORDER BY p.paid_date DESC, p.id DESC LIMIT 500`).all();
  res.json(rows);
});

// Builds the receipt in the same shape as a quotation or invoice so the shared paper layout can print it.
function receiptOf(id) {
  const p = db.prepare(`SELECT p.*, i.no AS invoice_no, i.total AS invoice_total, i.vat AS invoice_vat, i.paid AS invoice_paid,
                          i.customer_id, i.project_name, i.salesperson, i.status AS invoice_status
                        FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = ?`).get(id);
  if (!p) return null;
  // The amount received includes VAT. Its VAT share follows the invoice's VAT ratio,
  // so a partial payment shows the same tax split as the tax invoice.
  const vat = p.invoice_total > 0 ? Math.round((p.amount * p.invoice_vat) / p.invoice_total) : 0;
  const subtotal = p.amount - vat;
  return {
    id: p.id,
    no: p.receipt_no,
    issue_date: p.paid_date,
    customer: db.prepare('SELECT * FROM customers WHERE id = ?').get(p.customer_id),
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

api.get('/receipts/:id', (req, res) => {
  const doc = receiptOf(req.params.id);
  if (!doc) return res.status(404).json({ error: 'ไม่พบใบเสร็จรับเงิน' });
  res.json(doc);
});


// ---------- Dashboard & reports ----------

api.get('/dashboard', (req, res) => {
  const month = today().slice(0, 7);
  const sales = db.prepare(`SELECT COALESCE(SUM(total), 0) AS total FROM invoices
                            WHERE status IN ('issued','paid') AND substr(issue_date, 1, 7) = ?`).get(month);
  const outstanding = db.prepare(`SELECT COALESCE(SUM(total - paid), 0) AS total FROM invoices WHERE status = 'issued'`).get();
  const overdue = db.prepare(`SELECT COALESCE(SUM(total - paid), 0) AS total, COUNT(*) AS count FROM invoices
                              WHERE status = 'issued' AND due_date < ?`).get(today());
  const openQuotations = db.prepare(`SELECT COUNT(*) AS count FROM quotations WHERE status IN ('draft','sent')`).get();
  const collected = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments
                                WHERE substr(paid_date, 1, 7) = ?`).get(month);
  const upcoming = db.prepare(`SELECT i.id, i.no, i.due_date, i.total, i.paid, c.name AS customer_name
                               FROM invoices i JOIN customers c ON c.id = i.customer_id
                               WHERE i.status = 'issued' AND i.total > i.paid
                               ORDER BY i.due_date LIMIT 8`).all();
  const dueThisMonth = db.prepare(`SELECT due_date, total, paid FROM invoices
                                   WHERE status = 'issued' AND total > paid AND substr(due_date, 1, 7) = ?`).all(month);
  res.json({ salesThisMonth: sales.total, outstanding: outstanding.total, overdue: overdue.total,
             overdueCount: overdue.count, openQuotations: openQuotations.count,
             collectedThisMonth: collected.total, upcoming, dueThisMonth, today: today(),
             accounting: accountingSummary() });
});

api.get('/reports/aging', (req, res) => {
  const rows = db.prepare(`SELECT i.id, i.no, i.issue_date, i.due_date, i.total, i.paid, c.name AS customer_name
                           FROM invoices i JOIN customers c ON c.id = i.customer_id
                           WHERE i.status = 'issued' AND i.total > i.paid ORDER BY i.due_date`).all();
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
});
