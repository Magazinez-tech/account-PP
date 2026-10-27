// PostgreSQL access (Supabase in production). Every query goes through `db` or a transaction handle.
import pg from 'pg';

// int8 (COUNT, SUM of int4) and numeric come back as numbers, not strings. Amounts stay well within range.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL is not set. Set it to the Supabase connection string (Transaction pooler).');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase requires SSL. Set DATABASE_SSL=false only for a local test database.
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 5,
});

function handle(querier) {
  return {
    async one(text, params = []) {
      const res = await querier.query(text, params);
      return res.rows[0] ?? null;
    },
    async many(text, params = []) {
      const res = await querier.query(text, params);
      return res.rows;
    },
    async run(text, params = []) {
      return querier.query(text, params);
    },
  };
}

export const db = handle(pool);

// Runs fn inside one transaction. fn receives a handle bound to that transaction.
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(handle(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Gapless running number per key, e.g. INV-2026-0001. Atomic under concurrency.
export async function nextNumber(d, prefix) {
  const key = `${prefix}-${new Date().getFullYear()}`;
  return `${key}-${String(await nextCounter(d, key)).padStart(4, '0')}`;
}

// Running number without year, e.g. EST00024.
export async function nextRunningNo(d, prefix, width = 5) {
  return `${prefix}${String(await nextCounter(d, prefix)).padStart(width, '0')}`;
}

// Quotation number PP-MM-NNNN: MM is the month of the issue date, NNNN restarts every month.
export async function nextMonthlyNo(d, prefix, issueDate) {
  const [year, month] = issueDate.split('-');
  const value = await nextCounter(d, `${prefix}-${year}-${month}`);
  return `${prefix}-${month}-${String(value).padStart(4, '0')}`;
}

async function nextCounter(d, key) {
  const row = await d.one(
    `INSERT INTO counters (key, value) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
    [key],
  );
  return row.value;
}

// Tables and indexes. Safe to run on every start. RLS is enabled so the public Supabase API
// (anon key) cannot read the tables; this server connects as the table owner, which bypasses RLS.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Per-module access for staff users, e.g. {"sales": "edit", "reports": "view"}. Admins have everything.
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  company_name TEXT,
  tax_id TEXT,
  branch TEXT,
  address TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  credit_days INTEGER NOT NULL DEFAULT 30,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotations (
  id SERIAL PRIMARY KEY,
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
  project_name TEXT,
  reference_no TEXT,
  salesperson TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id SERIAL PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty DOUBLE PRECISION NOT NULL,
  unit TEXT,
  unit_price INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
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
  project_name TEXT,
  reference_no TEXT,
  salesperson TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty DOUBLE PRECISION NOT NULL,
  unit TEXT,
  unit_price INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  receipt_no TEXT NOT NULL UNIQUE,
  paid_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  normal TEXT NOT NULL,
  sys_key TEXT UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id SERIAL PRIMARY KEY,
  entry_no TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id INTEGER,
  reversed_of INTEGER REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit INTEGER NOT NULL DEFAULT 0,
  credit INTEGER NOT NULL DEFAULT 0,
  memo TEXT
);

CREATE TABLE IF NOT EXISTS company_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT, address TEXT, phone TEXT, email TEXT, website TEXT, tax_id TEXT,
  bank_name TEXT, bank_account_no TEXT, bank_account_name TEXT,
  approver_name TEXT, quotation_terms TEXT, logo TEXT
);

-- Purchasing: suppliers, purchase orders (PO), and payments made to suppliers.
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  company_name TEXT,
  tax_id TEXT,
  branch TEXT,
  address TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  credit_days INTEGER NOT NULL DEFAULT 30,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  no TEXT UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  issue_date TEXT NOT NULL,
  expected_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  discount INTEGER NOT NULL DEFAULT 0,
  subtotal INTEGER NOT NULL DEFAULT 0,
  vat INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  project_name TEXT,
  reference_no TEXT,
  salesperson TEXT,
  received_date TEXT,
  due_date TEXT,
  bill_no TEXT,
  account_id INTEGER REFERENCES accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty DOUBLE PRECISION NOT NULL,
  unit TEXT,
  unit_price INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id SERIAL PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  payment_no TEXT NOT NULL UNIQUE,
  paid_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'transfer',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Product / service catalog picked from when writing document lines. Prices in satang, before VAT.
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  code TEXT,
  name TEXT NOT NULL,
  unit TEXT,
  price INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE products ADD COLUMN IF NOT EXISTS size TEXT;
-- Size (ขนาด) is typed per document line.
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS size TEXT;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS size TEXT;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS size TEXT;

CREATE INDEX IF NOT EXISTS idx_lines_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_entries_source ON journal_entries(source, source_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

INSERT INTO company_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
`;

// Creates tables if they do not exist yet.
export async function migrate() {
  await pool.query(SCHEMA);
}
