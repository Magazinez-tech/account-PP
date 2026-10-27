import { Router } from 'express';
import { db, tx } from './db.js';
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

function bad(res, message) {
  return res.status(400).json({ error: message });
}

function run(res, fn) {
  try {
    return fn();
  } catch (err) {
    return bad(res, err.message);
  }
}

accounting.get('/accounts', (req, res) => {
  res.json(db.prepare('SELECT * FROM accounts WHERE active = 1 ORDER BY code').all());
});

// Journal list with lines, newest first.
accounting.get('/journal', (req, res) => {
  const { from, to } = range(req.query);
  const entries = db.prepare(`SELECT * FROM journal_entries WHERE entry_date BETWEEN ? AND ?
                              ORDER BY entry_date DESC, id DESC LIMIT 300`).all(from, to);
  const lineStmt = db.prepare(`SELECT l.debit, l.credit, l.memo, a.code, a.name
                               FROM journal_lines l JOIN accounts a ON a.id = l.account_id
                               WHERE l.entry_id = ? ORDER BY l.id`);
  res.json(entries.map((e) => ({ ...e, lines: lineStmt.all(e.id) })));
});

// Manual general journal entry.
accounting.post('/journal', (req, res) => {
  const { date, description, lines } = req.body;
  if (!isDate(date)) return bad(res, 'วันที่ไม่ถูกต้อง');
  if (!String(description || '').trim()) return bad(res, 'กรุณาระบุคำอธิบายรายการ');
  return run(res, () => {
    const id = tx(() => postEntry({ date, description: String(description).trim(), source: 'manual', lines: lines || [] }));
    res.status(201).json({ id });
  });
});

// Simple expense entry: pick the expense account, amount and how it was paid.
accounting.post('/expenses', (req, res) => {
  const { date, description, account_id, amount, with_vat, pay_from } = req.body;
  if (!isDate(date)) return bad(res, 'วันที่ไม่ถูกต้อง');
  if (!String(description || '').trim()) return bad(res, 'กรุณาระบุรายการค่าใช้จ่าย');
  const account = db.prepare(`SELECT * FROM accounts WHERE id = ? AND type = 'expense'`).get(account_id);
  if (!account) return bad(res, 'กรุณาเลือกหมวดค่าใช้จ่าย');
  const satang = Math.round(Number(amount) * 100);
  if (!(satang > 0)) return bad(res, 'จำนวนเงินต้องมากกว่า 0');
  if (!['cash', 'bank', 'ap'].includes(pay_from)) return bad(res, 'วิธีจ่ายเงินไม่ถูกต้อง');
  return run(res, () => {
    const id = tx(() => postExpense({
      date, description: String(description).trim(), accountId: account.id,
      amount: satang, withVat: Boolean(with_vat), payFrom: pay_from,
    }));
    res.status(201).json({ id });
  });
});

// Only manual and expense entries can be reversed here. Invoice and receipt entries
// are reversed by cancelling or deleting their source document so the status stays correct.
accounting.post('/journal/:id/reverse', (req, res) => {
  const entry = db.prepare('SELECT source FROM journal_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'ไม่พบรายการบัญชี' });
  if (!['manual', 'expense'].includes(entry.source)) {
    return bad(res, 'รายการนี้มาจากเอกสาร ให้ยกเลิกหรือลบที่เอกสารต้นทางแทน');
  }
  const date = isDate(req.body.date) ? req.body.date : today();
  return run(res, () => {
    const id = tx(() => reverseEntry(Number(req.params.id), date));
    res.status(201).json({ id });
  });
});

accounting.get('/reports/trial-balance', (req, res) => {
  const { from, to } = range(req.query);
  res.json({ from, to, ...trialBalance(from, to) });
});

accounting.get('/reports/income', (req, res) => {
  const { from, to } = range(req.query);
  res.json({ from, to, ...incomeStatement(from, to) });
});

accounting.get('/reports/balance-sheet', (req, res) => {
  const to = isDate(req.query.to) ? req.query.to : today();
  res.json({ to, ...balanceSheet(to) });
});

accounting.get('/reports/ledger/:accountId', (req, res) => {
  const { from, to } = range(req.query);
  const result = ledger(Number(req.params.accountId), from, to);
  if (!result) return res.status(404).json({ error: 'ไม่พบบัญชี' });
  res.json({ from, to, ...result });
});

accounting.get('/reports/vat', (req, res) => {
  const { from, to } = range(req.query);
  res.json({ from, to, ...vatSummary(from, to) });
});
