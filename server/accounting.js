// General ledger core: chart of accounts, double-entry journal, automatic postings and reports.
//
// Basis: TFRS for NPAEs (มาตรฐานการรายงานทางการเงินสำหรับกิจการที่ไม่มีส่วนได้เสียสาธารณะ)
// issued by the Federation of Accounting Professions (สภาวิชาชีพบัญชี), and the record-keeping
// rules of the Revenue Code (ประมวลรัษฎากร มาตรา 87 และภาษีมูลค่าเพิ่ม).
// The account codes are a common Thai chart of accounts used as a starting point.
// Every function takes `d` (the database handle or a transaction handle) as its first argument.
import { db, tx, nextNumber } from './db.js';
import { VAT_RATE } from './money.js';
import { BizError } from './errors.js';

export const CHART = [
  ['1101', 'เงินสดในมือ', 'asset', 'debit', 'cash'],
  ['1102', 'เงินฝากธนาคาร', 'asset', 'debit', 'bank'],
  ['1103', 'ลูกหนี้การค้า', 'asset', 'debit', 'ar'],
  ['1104', 'ภาษีมูลค่าเพิ่มซื้อ', 'asset', 'debit', 'input_vat'],
  ['1201', 'อุปกรณ์สำนักงาน', 'asset', 'debit', null],
  ['1202', 'ค่าเสื่อมราคาสะสม - อุปกรณ์สำนักงาน', 'asset', 'credit', null],
  ['2101', 'เจ้าหนี้การค้า', 'liability', 'credit', 'ap'],
  ['2102', 'ภาษีมูลค่าเพิ่มขาย', 'liability', 'credit', 'output_vat'],
  ['2103', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย', 'liability', 'credit', null],
  ['2201', 'เงินกู้ยืมระยะยาว', 'liability', 'credit', null],
  ['3101', 'ทุนที่ชำระแล้ว', 'equity', 'credit', 'capital'],
  ['3102', 'กำไร (ขาดทุน) สะสม', 'equity', 'credit', 'retained'],
  ['3103', 'เงินถอนของเจ้าของ', 'equity', 'debit', 'drawings'],
  ['4101', 'รายได้จากการขายสินค้าและการให้บริการ', 'revenue', 'credit', 'revenue'],
  ['4102', 'ส่วนลดจ่ายให้ลูกค้า', 'revenue', 'debit', 'discount'],
  ['4901', 'รายได้อื่น', 'revenue', 'credit', null],
  ['5101', 'ต้นทุนขายและบริการ', 'expense', 'debit', null],
  ['5201', 'ค่าเช่า', 'expense', 'debit', null],
  ['5202', 'ค่าสาธารณูปโภค (ไฟฟ้า น้ำประปา)', 'expense', 'debit', null],
  ['5203', 'ค่าโทรศัพท์และอินเทอร์เน็ต', 'expense', 'debit', null],
  ['5204', 'เงินเดือนและค่าจ้าง', 'expense', 'debit', null],
  ['5205', 'ค่าเดินทาง', 'expense', 'debit', null],
  ['5206', 'ค่าโฆษณาและการตลาด', 'expense', 'debit', null],
  ['5207', 'ค่าซ่อมแซมและบำรุงรักษา', 'expense', 'debit', null],
  ['5208', 'ค่าธรรมเนียมธนาคาร', 'expense', 'debit', null],
  ['5209', 'ค่าเสื่อมราคา', 'expense', 'debit', null],
  ['5210', 'ค่าวัสดุสำนักงาน', 'expense', 'debit', null],
  ['5211', 'ค่าบริการวิชาชีพ (บัญชี กฎหมาย)', 'expense', 'debit', null],
  ['5299', 'ค่าใช้จ่ายอื่น', 'expense', 'debit', null],
  ['6101', 'ดอกเบี้ยจ่าย', 'expense', 'debit', null],
];

// Inserts any missing standard accounts. Safe to run on every start.
export async function seedChart(d = db) {
  for (const row of CHART) {
    await d.run(`INSERT INTO accounts (code, name, type, normal, sys_key) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (code) DO NOTHING`, row);
  }
}

export async function sysAccount(d, key) {
  const row = await d.one('SELECT id FROM accounts WHERE sys_key = $1', [key]);
  if (!row) throw new BizError(`ไม่พบบัญชีระบบ: ${key}`);
  return row.id;
}

// Writes one balanced journal entry.
export async function postEntry(d, { date, description, source, sourceId = null, reversedOf = null, lines }) {
  const clean = lines
    .map((l) => ({
      account_id: Number(l.account_id),
      debit: Math.round(Number(l.debit) || 0),
      credit: Math.round(Number(l.credit) || 0),
      memo: l.memo || null,
    }))
    .filter((l) => l.debit > 0 || l.credit > 0);

  if (clean.length < 2) throw new BizError('รายการบัญชีต้องมีอย่างน้อย 2 บรรทัดที่มียอด');
  if (clean.some((l) => l.debit < 0 || l.credit < 0)) throw new BizError('ยอดเงินต้องไม่ติดลบ');
  if (clean.some((l) => l.debit > 0 && l.credit > 0)) throw new BizError('แต่ละบรรทัดต้องเป็นเดบิตหรือเครดิตอย่างใดอย่างหนึ่ง');

  const debit = clean.reduce((sum, l) => sum + l.debit, 0);
  const credit = clean.reduce((sum, l) => sum + l.credit, 0);
  if (debit !== credit) throw new BizError('ยอดเดบิตและเครดิตไม่เท่ากัน');

  for (const l of clean) {
    const account = await d.one('SELECT active FROM accounts WHERE id = $1', [l.account_id]);
    if (!account) throw new BizError('ไม่พบบัญชีที่เลือก');
    if (!account.active) throw new BizError('บัญชีนี้ถูกปิดใช้งานแล้ว');
  }

  const entryNo = await nextNumber(d, 'JV');
  const entry = await d.one(
    `INSERT INTO journal_entries (entry_no, entry_date, description, source, source_id, reversed_of)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [entryNo, date, description, source, sourceId, reversedOf],
  );
  for (const l of clean) {
    await d.run('INSERT INTO journal_lines (entry_id, account_id, debit, credit, memo) VALUES ($1, $2, $3, $4, $5)',
      [entry.id, l.account_id, l.debit, l.credit, l.memo]);
  }
  return entry.id;
}

// Reverses an entry by posting the opposite lines. An entry can be reversed only once.
export async function reverseEntry(d, entryId, date) {
  const entry = await d.one('SELECT * FROM journal_entries WHERE id = $1', [entryId]);
  if (!entry) throw new BizError('ไม่พบรายการบัญชี');
  if (entry.reversed_of) throw new BizError('รายการกลับบัญชีไม่สามารถกลับซ้ำได้');
  if (await d.one('SELECT id FROM journal_entries WHERE reversed_of = $1', [entryId])) {
    throw new BizError('รายการนี้ถูกกลับบัญชีแล้ว');
  }
  const lines = await d.many('SELECT account_id, debit, credit, memo FROM journal_lines WHERE entry_id = $1', [entryId]);
  return postEntry(d, {
    date,
    description: `กลับรายการ ${entry.entry_no}: ${entry.description}`,
    source: 'reversal',
    sourceId: entry.id,
    reversedOf: entry.id,
    lines: lines.map((l) => ({ account_id: l.account_id, debit: l.credit, credit: l.debit, memo: l.memo })),
  });
}

// Reverses the original entry of a source document, if it exists and has not been reversed.
export async function reverseSource(d, source, sourceId, date) {
  const entry = await d.one(`SELECT id FROM journal_entries
                             WHERE source = $1 AND source_id = $2 AND reversed_of IS NULL`, [source, sourceId]);
  if (entry && !(await d.one('SELECT id FROM journal_entries WHERE reversed_of = $1', [entry.id]))) {
    await reverseEntry(d, entry.id, date);
  }
}

// Issued tax invoice: Dr receivable (total) + Dr discount, Cr revenue (subtotal) + Cr output VAT.
export async function postInvoice(d, inv) {
  return postEntry(d, {
    date: inv.issue_date,
    description: `ใบกำกับภาษี ${inv.no}`,
    source: 'invoice',
    sourceId: inv.id,
    lines: [
      { account_id: await sysAccount(d, 'ar'), debit: inv.total },
      { account_id: await sysAccount(d, 'discount'), debit: inv.discount },
      { account_id: await sysAccount(d, 'revenue'), credit: inv.subtotal },
      { account_id: await sysAccount(d, 'output_vat'), credit: inv.vat },
    ],
  });
}

// Receipt: Dr cash or bank, Cr receivable.
export async function postPayment(d, payment, invoiceNo) {
  const cash = payment.method === 'cash' ? 'cash' : 'bank';
  return postEntry(d, {
    date: payment.paid_date,
    description: `รับชำระ ${payment.receipt_no} ตาม ${invoiceNo}`,
    source: 'payment',
    sourceId: payment.id,
    lines: [
      { account_id: await sysAccount(d, cash), debit: payment.amount },
      { account_id: await sysAccount(d, 'ar'), credit: payment.amount },
    ],
  });
}

// Expense paid now (cash/bank) or on credit (ap). Input VAT is recorded separately so it can be claimed.
export async function postExpense(d, { date, description, accountId, amount, withVat, payFrom }) {
  const vat = withVat ? Math.round((amount * VAT_RATE) / 100) : 0;
  const payKey = payFrom === 'ap' ? 'ap' : payFrom === 'bank' ? 'bank' : 'cash';
  return postEntry(d, {
    date,
    description,
    source: 'expense',
    lines: [
      { account_id: accountId, debit: amount },
      { account_id: await sysAccount(d, 'input_vat'), debit: vat },
      { account_id: await sysAccount(d, payKey), credit: amount + vat },
    ],
  });
}

// Creates journal entries for issued invoices and receipts recorded before the ledger existed.
export async function backfill() {
  const invoices = await db.many(`SELECT * FROM invoices WHERE status IN ('issued', 'paid')
                                  AND id NOT IN (SELECT source_id FROM journal_entries WHERE source = 'invoice' AND source_id IS NOT NULL)`);
  const payments = await db.many(`SELECT p.*, i.no AS invoice_no FROM payments p JOIN invoices i ON i.id = p.invoice_id
                                  WHERE p.id NOT IN (SELECT source_id FROM journal_entries WHERE source = 'payment' AND source_id IS NOT NULL)`);
  if (invoices.length === 0 && payments.length === 0) return;
  await tx(async (d) => {
    for (const inv of invoices) await postInvoice(d, inv);
    for (const p of payments) await postPayment(d, p, p.invoice_no);
  });
  console.log(`Backfilled ledger: ${invoices.length} invoices, ${payments.length} receipts`);
}

// ---------- Reports ----------

// Sums debit and credit per account for entries dated within [from, to].
async function activity(d, from, to) {
  const rows = await d.many(`SELECT a.id, a.code, a.name, a.type, a.normal, a.sys_key,
                               COALESCE(SUM(l.debit), 0) AS dr, COALESCE(SUM(l.credit), 0) AS cr
                             FROM accounts a
                             LEFT JOIN journal_lines l ON l.account_id = a.id
                             LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.entry_date BETWEEN $1 AND $2
                             GROUP BY a.id, a.code, a.name, a.type, a.normal, a.sys_key
                             ORDER BY a.code`, [from, to]);
  return rows.map((row) => ({
    ...row,
    dr: Number(row.dr),
    cr: Number(row.cr),
    net: Number(row.dr) - Number(row.cr),
    // Signed balance as shown on statements. Assets and expenses use debit minus credit;
    // liabilities, equity and revenue use credit minus debit. Contra accounts go negative.
    amount: ['asset', 'expense'].includes(row.type) ? Number(row.dr) - Number(row.cr) : Number(row.cr) - Number(row.dr),
  }));
}

export async function trialBalance(d, from, to) {
  const rows = (await activity(d, from, to)).filter((r) => r.dr || r.cr);
  const totalDebit = rows.reduce((s, r) => s + (r.net > 0 ? r.net : 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (r.net < 0 ? -r.net : 0), 0);
  return {
    rows: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, debit: r.net > 0 ? r.net : 0, credit: r.net < 0 ? -r.net : 0 })),
    totalDebit,
    totalCredit,
    balanced: totalDebit === totalCredit,
  };
}

export async function incomeStatement(d, from, to) {
  const rows = await activity(d, from, to);
  const revenue = rows.filter((r) => r.type === 'revenue');
  const expense = rows.filter((r) => r.type === 'expense');
  const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expense.reduce((s, r) => s + r.amount, 0);
  return {
    revenue: revenue.filter((r) => r.amount).map((r) => ({ id: r.id, code: r.code, name: r.name, amount: r.amount })),
    expense: expense.filter((r) => r.amount).map((r) => ({ id: r.id, code: r.code, name: r.name, amount: r.amount })),
    totalRevenue,
    totalExpense,
    netProfit: totalRevenue - totalExpense,
  };
}

// Balance sheet as of `to`. Profit from all periods up to `to` is shown inside equity
// because the books are not closed to retained earnings yet.
export async function balanceSheet(d, to) {
  const rows = (await activity(d, '1900-01-01', to)).filter((r) => r.amount);
  const group = (type) => rows.filter((r) => r.type === type)
    .map((r) => ({ id: r.id, code: r.code, name: r.name, amount: r.amount }));
  const sumOf = (list) => list.reduce((s, r) => s + r.amount, 0);
  const assets = group('asset');
  const liabilities = group('liability');
  const equity = group('equity');
  const profit = rows.filter((r) => r.type === 'revenue').reduce((s, r) => s + r.amount, 0)
    - rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const totalAssets = sumOf(assets);
  const totalLiabilities = sumOf(liabilities);
  const totalEquity = sumOf(equity) + profit;
  return {
    assets, liabilities, equity,
    currentProfit: profit,
    totalAssets, totalLiabilities, totalEquity,
    difference: totalAssets - (totalLiabilities + totalEquity),
  };
}

export async function ledger(d, accountId, from, to) {
  const account = await d.one('SELECT * FROM accounts WHERE id = $1', [accountId]);
  if (!account) return null;
  const sign = (dr, cr) => (account.normal === 'debit' ? dr - cr : cr - dr);
  const before = await d.one(`SELECT COALESCE(SUM(l.debit), 0) AS dr, COALESCE(SUM(l.credit), 0) AS cr
                              FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
                              WHERE l.account_id = $1 AND e.entry_date < $2`, [accountId, from]);
  let running = sign(Number(before.dr), Number(before.cr));
  const rows = await d.many(`SELECT e.id AS entry_id, e.entry_no, e.entry_date, e.description, l.debit, l.credit, l.memo
                             FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
                             WHERE l.account_id = $1 AND e.entry_date BETWEEN $2 AND $3
                             ORDER BY e.entry_date, e.id, l.id`, [accountId, from, to]);
  const lines = rows.map((l) => {
    running += sign(l.debit, l.credit);
    return { ...l, balance: running };
  });
  return { account, opening: sign(Number(before.dr), Number(before.cr)), lines, closing: running };
}

// Output VAT (ภาษีขาย) and input VAT (ภาษีซื้อ) for a period, as used for the ภ.พ.30 form.
export async function vatSummary(d, from, to) {
  const rows = await activity(d, from, to);
  const pick = (key) => rows.find((r) => r.sys_key === key)?.amount || 0;
  const outputVat = pick('output_vat');
  const inputVat = pick('input_vat');
  const sales = rows.filter((r) => r.type === 'revenue').reduce((s, r) => s + r.amount, 0);
  return { sales, outputVat, inputVat, payable: outputVat - inputVat };
}

// Figures for the home dashboard.
export async function accountingSummary(d) {
  const today = new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const rows = await activity(d, '1900-01-01', today);
  const cash = rows.filter((r) => r.sys_key === 'cash' || r.sys_key === 'bank').reduce((s, r) => s + r.amount, 0);
  const pnl = await incomeStatement(d, `${year}-01-01`, today);
  const sheet = await balanceSheet(d, today);
  return {
    cashAndBank: cash,
    netProfitYtd: pnl.netProfit,
    balanced: sheet.difference === 0,
  };
}
