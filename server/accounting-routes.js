import { Router } from 'express';
import { db, tx } from './db.js';
import { BizError } from './errors.js';
import {
  postEntry, reverseEntry, postExpense, trialBalance, incomeStatement,
  balanceSheet, ledger, vatSummary,
} from './accounting.js';

export const accounting = Router();

const today = () => new Date().toISOString().slice(0, 10);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));
const yearStart = () => `${today().slice(0, 4)}-01-01`;

// Reads the from/to query, defaulting to the current fiscal year to date.
function range(query) {
  const from = isDate(query.from) ? query.from : yearStart();
  const to = isDate(query.to) ? query.to : today();
  return { from, to };
}

// Wraps an async handler so a thrown business error becomes a 400 with the Thai message.
const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof BizError) return res.status(400).json({ error: err.message });
    next(err);
  }
};

accounting.get('/accounts', handle(async (req, res) => {
  res.json(await db.many('SELECT * FROM accounts WHERE active = 1 ORDER BY code'));
}));

// Journal list with lines, newest first.
accounting.get('/journal', handle(async (req, res) => {
  const { from, to } = range(req.query);
  const entries = await db.many(`SELECT * FROM journal_entries WHERE entry_date BETWEEN $1 AND $2
                                 ORDER BY entry_date DESC, id DESC LIMIT 300`, [from, to]);
  const result = [];
  for (const e of entries) {
    const lines = await db.many(`SELECT l.debit, l.credit, l.memo, a.code, a.name
                                 FROM journal_lines l JOIN accounts a ON a.id = l.account_id
                                 WHERE l.entry_id = $1 ORDER BY l.id`, [e.id]);
    result.push({ ...e, lines });
  }
  res.json(result);
}));

// Manual general journal entry.
accounting.post('/journal', handle(async (req, res) => {
  const { date, description, lines } = req.body;
  if (!isDate(date)) return res.status(400).json({ error: 'วันที่ไม่ถูกต้อง' });
  if (!String(description || '').trim()) return res.status(400).json({ error: 'กรุณาระบุคำอธิบายรายการ' });
  const id = await tx((d) => postEntry(d, { date, description: String(description).trim(), source: 'manual', lines: lines || [] }));
  res.status(201).json({ id });
}));

// Simple expense entry: pick the expense account, amount and how it was paid.
accounting.post('/expenses', handle(async (req, res) => {
  const { date, description, account_id, amount, with_vat, pay_from } = req.body;
  if (!isDate(date)) return res.status(400).json({ error: 'วันที่ไม่ถูกต้อง' });
  if (!String(description || '').trim()) return res.status(400).json({ error: 'กรุณาระบุรายการค่าใช้จ่าย' });
  const account = await db.one(`SELECT * FROM accounts WHERE id = $1 AND type = 'expense'`, [account_id]);
  if (!account) return res.status(400).json({ error: 'กรุณาเลือกหมวดค่าใช้จ่าย' });
  const satang = Math.round(Number(amount) * 100);
  if (!(satang > 0)) return res.status(400).json({ error: 'จำนวนเงินต้องมากกว่า 0' });
  if (!['cash', 'bank', 'ap'].includes(pay_from)) return res.status(400).json({ error: 'วิธีจ่ายเงินไม่ถูกต้อง' });
  const id = await tx((d) => postExpense(d, {
    date, description: String(description).trim(), accountId: account.id,
    amount: satang, withVat: Boolean(with_vat), payFrom: pay_from,
  }));
  res.status(201).json({ id });
}));

// Only manual and expense entries can be reversed here. Invoice and receipt entries
// are reversed by cancelling or deleting their source document so the status stays correct.
accounting.post('/journal/:id/reverse', handle(async (req, res) => {
  const entry = await db.one('SELECT source FROM journal_entries WHERE id = $1', [req.params.id]);
  if (!entry) return res.status(404).json({ error: 'ไม่พบรายการบัญชี' });
  if (!['manual', 'expense'].includes(entry.source)) {
    return res.status(400).json({ error: 'รายการนี้มาจากเอกสาร ให้ยกเลิกหรือลบที่เอกสารต้นทางแทน' });
  }
  const date = isDate(req.body.date) ? req.body.date : today();
  const id = await tx((d) => reverseEntry(d, Number(req.params.id), date));
  res.status(201).json({ id });
}));

accounting.get('/reports/trial-balance', handle(async (req, res) => {
  const { from, to } = range(req.query);
  res.json({ from, to, ...(await trialBalance(db, from, to)) });
}));

accounting.get('/reports/income', handle(async (req, res) => {
  const { from, to } = range(req.query);
  res.json({ from, to, ...(await incomeStatement(db, from, to)) });
}));

accounting.get('/reports/balance-sheet', handle(async (req, res) => {
  const to = isDate(req.query.to) ? req.query.to : today();
  res.json({ to, ...(await balanceSheet(db, to)) });
}));

accounting.get('/reports/ledger/:accountId', handle(async (req, res) => {
  const { from, to } = range(req.query);
  const result = await ledger(db, Number(req.params.accountId), from, to);
  if (!result) return res.status(404).json({ error: 'ไม่พบบัญชี' });
  res.json({ from, to, ...result });
}));

accounting.get('/reports/vat', handle(async (req, res) => {
  const { from, to } = range(req.query);
  res.json({ from, to, ...(await vatSummary(db, from, to)) });
}));
