// Purchasing: suppliers (ผู้ขาย), purchase orders (ใบสั่งซื้อ / PO) and supplier payments (ใบสำคัญจ่าย).
// PO flow: draft → approved → received (goods in + supplier bill, posts AP) → paid.
import { Router } from 'express';
import { db, tx, nextNumber, nextMonthlyNo } from './db.js';
import { calcTotals, validateItems } from './money.js';
import { postPurchase, postSupplierPayment, reverseSource } from './accounting.js';
import { BizError } from './errors.js';
import { h, today, addDays, text, isDate, projectOf, insertItems, loadDocument, partyFields } from './helpers.js';

export const purchasing = Router();

// ---------- Suppliers ----------

purchasing.get('/suppliers', h(async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  res.json(await db.many(`SELECT * FROM suppliers
                          WHERE name ILIKE $1 OR tax_id ILIKE $1 OR phone ILIKE $1 OR company_name ILIKE $1
                          ORDER BY name LIMIT 500`, [q]));
}));

purchasing.get('/suppliers/:id', h(async (req, res) => {
  const supplier = await db.one('SELECT * FROM suppliers WHERE id = $1', [req.params.id]);
  if (!supplier) return res.status(404).json({ error: 'ไม่พบผู้ขาย' });
  const orders = await db.many(`SELECT id, no, issue_date, status, total, paid FROM purchase_orders
                                WHERE supplier_id = $1 ORDER BY issue_date DESC, id DESC`, [supplier.id]);
  res.json({ ...supplier, orders });
}));

purchasing.post('/suppliers', h(async (req, res) => {
  const f = partyFields(req.body);
  if (!f.name) return res.status(400).json({ error: 'กรุณาระบุชื่อผู้ขาย' });
  const row = await db.one(`INSERT INTO suppliers (name, company_name, tax_id, branch, address, contact_name, phone, email, credit_days, note)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
  [f.name, f.company_name, f.tax_id, f.branch, f.address, f.contact_name, f.phone, f.email, f.credit_days, f.note]);
  res.status(201).json({ id: row.id });
}));

purchasing.put('/suppliers/:id', h(async (req, res) => {
  const f = partyFields(req.body);
  if (!f.name) return res.status(400).json({ error: 'กรุณาระบุชื่อผู้ขาย' });
  await db.run(`UPDATE suppliers SET name=$1, company_name=$2, tax_id=$3, branch=$4, address=$5,
                contact_name=$6, phone=$7, email=$8, credit_days=$9, note=$10 WHERE id = $11`,
  [f.name, f.company_name, f.tax_id, f.branch, f.address, f.contact_name, f.phone, f.email, f.credit_days, f.note, req.params.id]);
  res.json({ ok: true });
}));

purchasing.delete('/suppliers/:id', h(async (req, res) => {
  const row = await db.one('SELECT COUNT(*) AS count FROM purchase_orders WHERE supplier_id = $1', [req.params.id]);
  if (row.count > 0) return res.status(400).json({ error: 'ลบไม่ได้ เพราะผู้ขายรายนี้มีใบสั่งซื้อแล้ว' });
  await db.run('DELETE FROM suppliers WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------- Purchase orders ----------

// Accounts a received PO can be charged to: expense accounts and non-system asset accounts (e.g. equipment).
purchasing.get('/purchase-accounts', h(async (req, res) => {
  res.json(await db.many(`SELECT id, code, name, type FROM accounts
                          WHERE active = 1 AND sys_key IS NULL AND type IN ('expense', 'asset') AND normal = 'debit'
                          ORDER BY code`));
}));

// customer_name is the supplier's name, so the shared document list can show POs without changes.
purchasing.get('/purchase-orders', h(async (req, res) => {
  const params = [];
  let where = 'TRUE';
  if (req.query.status) {
    params.push(req.query.status);
    where += ` AND p.status = $${params.length}`;
  }
  res.json(await db.many(`SELECT p.*, s.name AS customer_name FROM purchase_orders p
                          JOIN suppliers s ON s.id = p.supplier_id
                          WHERE ${where} ORDER BY p.issue_date DESC, p.id DESC LIMIT 500`, params));
}));

purchasing.get('/purchase-orders/:id', h(async (req, res) => {
  const doc = await loadDocument('purchase_orders', 'purchase_order_items', 'purchase_order_id', req.params.id);
  if (!doc) return res.status(404).json({ error: 'ไม่พบใบสั่งซื้อ' });
  doc.customer = await db.one('SELECT * FROM suppliers WHERE id = $1', [doc.supplier_id]);
  doc.customer_id = doc.supplier_id;
  doc.payments = await db.many('SELECT * FROM supplier_payments WHERE purchase_order_id = $1 ORDER BY paid_date, id', [doc.id]);
  doc.account = doc.account_id ? await db.one('SELECT id, code, name FROM accounts WHERE id = $1', [doc.account_id]) : null;
  res.json(doc);
}));

async function savePurchaseOrder(d, id, body) {
  const err = validateItems(body.items);
  if (err) throw new BizError(err);
  const supplierId = Number(body.supplier_id ?? body.customer_id);
  if (!(await d.one('SELECT id FROM suppliers WHERE id = $1', [supplierId]))) throw new BizError('กรุณาเลือกผู้ขาย');
  const totals = calcTotals(body.items, Number(body.discount) || 0);
  const issueDate = body.issue_date || today();
  const expectedDate = body.expected_date || null;
  const note = text(body.note);
  const pf = projectOf(body);

  let poId = id;
  if (id) {
    await d.run(`UPDATE purchase_orders SET supplier_id=$1, issue_date=$2, expected_date=$3, discount=$4, subtotal=$5, vat=$6, total=$7,
                 note=$8, project_name=$9, reference_no=$10, salesperson=$11, updated_at=now() WHERE id=$12`,
    [supplierId, issueDate, expectedDate, totals.discount, totals.subtotal, totals.vat, totals.total,
      note, pf.project, pf.reference, pf.salesperson, id]);
    await d.run('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [id]);
  } else {
    const no = await nextMonthlyNo(d, 'PO', issueDate);
    const row = await d.one(`INSERT INTO purchase_orders (no, supplier_id, issue_date, expected_date, discount, subtotal, vat, total,
                             note, project_name, reference_no, salesperson)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [no, supplierId, issueDate, expectedDate, totals.discount, totals.subtotal, totals.vat, totals.total,
      note, pf.project, pf.reference, pf.salesperson]);
    poId = row.id;
  }
  await insertItems(d, 'purchase_order_items', 'purchase_order_id', poId, totals.lines);
  return { id: poId };
}

purchasing.post('/purchase-orders', h(async (req, res) => {
  res.status(201).json(await tx((d) => savePurchaseOrder(d, null, req.body)));
}));

purchasing.put('/purchase-orders/:id', h(async (req, res) => {
  const current = await db.one('SELECT status FROM purchase_orders WHERE id = $1', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'ไม่พบใบสั่งซื้อ' });
  if (current.status !== 'draft') return res.status(400).json({ error: 'แก้ไขได้เฉพาะใบสั่งซื้อที่ยังเป็นร่าง' });
  res.json(await tx((d) => savePurchaseOrder(d, Number(req.params.id), req.body)));
}));

purchasing.post('/purchase-orders/:id/approve', h(async (req, res) => {
  const result = await db.run(`UPDATE purchase_orders SET status = 'approved', updated_at = now()
                               WHERE id = $1 AND status = 'draft'`, [req.params.id]);
  if (result.rowCount === 0) return res.status(400).json({ error: 'อนุมัติได้เฉพาะใบสั่งซื้อที่ยังเป็นร่าง' });
  res.json({ ok: true });
}));

// Goods or services received and the supplier's tax invoice recorded. This is when the payable is booked.
purchasing.post('/purchase-orders/:id/receive', h(async (req, res) => {
  const { received_date: receivedDate, bill_no: billNo, account_id: accountId, due_date: dueDateInput } = req.body;
  if (!isDate(receivedDate)) return res.status(400).json({ error: 'วันที่รับสินค้าไม่ถูกต้อง' });
  await tx(async (d) => {
    const po = await d.one('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!po) throw new BizError('ไม่พบใบสั่งซื้อ');
    if (po.status !== 'approved') throw new BizError('รับสินค้าได้เฉพาะใบสั่งซื้อที่อนุมัติแล้ว');
    const account = await d.one(`SELECT id FROM accounts WHERE id = $1 AND active = 1 AND sys_key IS NULL
                                 AND type IN ('expense', 'asset') AND normal = 'debit'`, [accountId]);
    if (!account) throw new BizError('กรุณาเลือกบัญชีที่จะบันทึกการซื้อ');
    const supplier = await d.one('SELECT credit_days FROM suppliers WHERE id = $1', [po.supplier_id]);
    const dueDate = isDate(dueDateInput) ? dueDateInput : addDays(receivedDate, supplier.credit_days);
    if (dueDate < receivedDate) throw new BizError('วันครบกำหนดจ่ายต้องไม่ก่อนวันที่รับสินค้า');
    await d.run(`UPDATE purchase_orders SET status = 'received', received_date = $1, due_date = $2, bill_no = $3,
                 account_id = $4, updated_at = now() WHERE id = $5`,
    [receivedDate, dueDate, text(billNo), account.id, po.id]);
    await postPurchase(d, { ...po, received_date: receivedDate, bill_no: text(billNo) }, account.id);
  });
  res.json({ ok: true });
}));

// Draft: deleted. Approved: cancelled. Received with no payments: cancelled and its AP entry reversed.
purchasing.post('/purchase-orders/:id/cancel', h(async (req, res) => {
  await tx(async (d) => {
    const po = await d.one('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!po) throw new BizError('ไม่พบใบสั่งซื้อ');
    if (po.status === 'draft') {
      await d.run('DELETE FROM purchase_orders WHERE id = $1', [po.id]);
      return;
    }
    if (po.status === 'cancelled') throw new BizError('ยกเลิกไปแล้ว');
    if (po.paid > 0) throw new BizError('มีการจ่ายชำระแล้ว ต้องลบรายการจ่ายชำระก่อน');
    if (po.status === 'received') await reverseSource(d, 'purchase', po.id, today());
    await d.run(`UPDATE purchase_orders SET status = 'cancelled', updated_at = now() WHERE id = $1`, [po.id]);
  });
  res.json({ ok: true });
}));

// ---------- Supplier payments (ใบสำคัญจ่าย) ----------

purchasing.post('/purchase-orders/:id/payments', h(async (req, res) => {
  const paymentNo = await tx(async (d) => {
    // Lock the PO so two payments cannot both pass the outstanding check.
    const po = await d.one('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!po) throw new BizError('ไม่พบใบสั่งซื้อ');
    if (!['received', 'paid'].includes(po.status)) throw new BizError('จ่ายชำระได้เฉพาะใบสั่งซื้อที่รับสินค้าแล้ว');
    const amount = Math.round(Number(req.body.amount) * 100);
    if (!(amount > 0)) throw new BizError('จำนวนเงินต้องมากกว่า 0');
    if (amount > po.total - po.paid) throw new BizError('จำนวนเงินมากกว่ายอดค้างจ่าย');

    const no = await nextNumber(d, 'PV');
    const paidDate = isDate(req.body.paid_date) ? req.body.paid_date : today();
    const method = req.body.method || 'transfer';
    const row = await d.one(`INSERT INTO supplier_payments (purchase_order_id, payment_no, paid_date, amount, method, note)
                             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [po.id, no, paidDate, amount, method, text(req.body.note)]);
    const paid = po.paid + amount;
    await d.run(`UPDATE purchase_orders SET paid = $1, status = $2, updated_at = now() WHERE id = $3`,
      [paid, paid >= po.total ? 'paid' : 'received', po.id]);
    await postSupplierPayment(d, { id: row.id, payment_no: no, paid_date: paidDate, amount, method }, po.no);
    return no;
  });
  res.status(201).json({ payment_no: paymentNo });
}));

purchasing.delete('/supplier-payments/:id', h(async (req, res) => {
  await tx(async (d) => {
    const payment = await d.one('SELECT * FROM supplier_payments WHERE id = $1', [req.params.id]);
    if (!payment) throw new BizError('ไม่พบรายการจ่ายชำระ');
    const po = await d.one('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [payment.purchase_order_id]);
    await reverseSource(d, 'supplier_payment', payment.id, today());
    await d.run('DELETE FROM supplier_payments WHERE id = $1', [payment.id]);
    const paid = po.paid - payment.amount;
    await d.run(`UPDATE purchase_orders SET paid = $1, status = $2, updated_at = now() WHERE id = $3`,
      [paid, paid >= po.total ? 'paid' : 'received', po.id]);
  });
  res.json({ ok: true });
}));

// Outstanding payables by due date, for the dashboard and the payables report.
purchasing.get('/reports/payables', h(async (req, res) => {
  const items = await db.many(`SELECT p.id, p.no, p.bill_no, p.received_date, p.due_date, p.total, p.paid,
                                 p.total - p.paid AS outstanding, s.name AS supplier_name
                               FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
                               WHERE p.status = 'received' AND p.total > p.paid
                               ORDER BY p.due_date`);
  res.json({ total: items.reduce((sum, r) => sum + r.outstanding, 0), items });
}));
