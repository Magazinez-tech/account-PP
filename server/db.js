import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'data'), { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || join(root, 'data', 'app.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  tax_id TEXT,
  branch TEXT,
  address TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  credit_days INTEGER NOT NULL DEFAULT 30,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotations (
  id INTEGER PRIMARY KEY,
  no TEXT UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  issue_date TEXT NOT NULL,
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  discount INTEGER NOT NULL DEFAULT 0,
  subtotal INTEGER NOT NULL DEFAULT 0,
  vat INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  invoice_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id INTEGER PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty REAL NOT NULL,
  unit TEXT,
  unit_price INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  no TEXT UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  quotation_id INTEGER REFERENCES quotations(id),
  issue_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  discount INTEGER NOT NULL DEFAULT 0,
  subtotal INTEGER NOT NULL DEFAULT 0,
  vat INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty REAL NOT NULL,
  unit TEXT,
  unit_price INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  receipt_no TEXT NOT NULL UNIQUE,
  paid_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- General ledger: chart of accounts, journal entries (double entry) and their lines.
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,            -- asset | liability | equity | revenue | expense
  normal TEXT NOT NULL,          -- debit | credit (side that increases the account)
  sys_key TEXT UNIQUE,           -- used by automatic postings, e.g. 'ar', 'bank'
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY,
  entry_no TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT NOT NULL,          -- manual | expense | invoice | payment | reversal
  source_id INTEGER,
  reversed_of INTEGER REFERENCES journal_entries(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit INTEGER NOT NULL DEFAULT 0,
  credit INTEGER NOT NULL DEFAULT 0,
  memo TEXT
);

CREATE INDEX IF NOT EXISTS idx_lines_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_entries_source ON journal_entries(source, source_id);

-- Company profile printed on quotations and tax invoices (single row).
CREATE TABLE IF NOT EXISTS company_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT, address TEXT, phone TEXT, email TEXT, website TEXT, tax_id TEXT,
  bank_name TEXT, bank_account_no TEXT, bank_account_name TEXT,
  approver_name TEXT, quotation_terms TEXT
);
INSERT OR IGNORE INTO company_settings (id) VALUES (1);
`);

// Adds a column to databases created before it existed.
function addColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('customers', 'company_name', 'TEXT');
addColumn('quotations', 'project_name', 'TEXT');
addColumn('quotations', 'reference_no', 'TEXT');
addColumn('quotations', 'salesperson', 'TEXT');
addColumn('invoices', 'project_name', 'TEXT');
addColumn('invoices', 'reference_no', 'TEXT');
addColumn('invoices', 'salesperson', 'TEXT');

// Runs fn inside a transaction; rolls back on any thrown error.
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Gapless running number without year, e.g. EST00024 for quotations.
export function nextRunningNo(prefix, width = 5) {
  db.prepare(`INSERT INTO counters (key, value) VALUES (?, 1)
              ON CONFLICT(key) DO UPDATE SET value = value + 1`).run(prefix);
  const { value } = db.prepare('SELECT value FROM counters WHERE key = ?').get(prefix);
  return `${prefix}${String(value).padStart(width, '0')}`;
}

// Quotation number PP-MM-NNNN: MM is the month of the issue date, NNNN restarts every month.
// Example: PP-01-0001 is the first quotation issued in January.
export function nextMonthlyNo(prefix, issueDate) {
  const [year, month] = issueDate.split('-');
  const key = `${prefix}-${year}-${month}`;
  db.prepare(`INSERT INTO counters (key, value) VALUES (?, 1)
              ON CONFLICT(key) DO UPDATE SET value = value + 1`).run(key);
  const { value } = db.prepare('SELECT value FROM counters WHERE key = ?').get(key);
  return `${prefix}-${month}-${String(value).padStart(4, '0')}`;
}

// Quotations created before numbering existed get a number now.
for (const row of db.prepare('SELECT id, issue_date FROM quotations WHERE no IS NULL ORDER BY id').all()) {
  db.prepare('UPDATE quotations SET no = ? WHERE id = ?').run(nextMonthlyNo('PP', row.issue_date), row.id);
}

// Gapless running number per prefix and year, e.g. INV-2026-0001.
export function nextNumber(prefix) {
  const key = `${prefix}-${new Date().getFullYear()}`;
  db.prepare(`INSERT INTO counters (key, value) VALUES (?, 1)
              ON CONFLICT(key) DO UPDATE SET value = value + 1`).run(key);
  const { value } = db.prepare('SELECT value FROM counters WHERE key = ?').get(key);
  return `${key}-${String(value).padStart(4, '0')}`;
}
