// Access control. Staff users get a level per module; admins can do everything, including managing users.
// GET requests need "view", anything that changes data needs "edit". Checked on every /api request.

export const MODULES = ['customers', 'sales', 'purchasing', 'accounting', 'reports', 'settings'];
export const LEVELS = ['none', 'view', 'edit'];

// API path prefix → module. First match wins, so more specific prefixes come first.
const RULES = [
  ['/reports/payables', 'purchasing'],
  ['/reports', 'reports'],
  ['/customers', 'customers'],
  ['/quotations', 'sales'],
  ['/invoices', 'sales'],
  ['/payments', 'sales'],
  ['/receipts', 'sales'],
  ['/suppliers', 'purchasing'],
  ['/purchase-orders', 'purchasing'],
  ['/supplier-payments', 'purchasing'],
  ['/purchase-accounts', 'purchasing'],
  ['/journal', 'accounting'],
  ['/expenses', 'accounting'],
  ['/accounts', 'accounting'],
  ['/settings', 'settings'],
];

export function levelOf(user, module) {
  if (user.role === 'admin') return 'edit';
  return user.permissions?.[module] || 'none';
}

export function allows(user, module, need) {
  const level = levelOf(user, module);
  return need === 'view' ? level === 'view' || level === 'edit' : level === 'edit';
}

// Keeps only known modules and levels, dropping "none".
export function cleanPermissions(input) {
  const out = {};
  for (const module of MODULES) {
    const level = input?.[module];
    if (level === 'view' || level === 'edit') out[module] = level;
  }
  return out;
}

const deny = (res, message) => res.status(403).json({ error: message });

export function checkPermission(req, res, next) {
  const { user } = req;
  const path = req.path;

  if (path === '/users' || path.startsWith('/users/')) {
    return user.role === 'admin' ? next() : deny(res, 'เฉพาะผู้ดูแลระบบเท่านั้น');
  }
  // Every signed-in user: the home dashboard and their own account.
  if (path === '/dashboard' || path === '/me' || path.startsWith('/me/')) return next();

  const need = req.method === 'GET' ? 'view' : 'edit';

  // Reading the company profile is needed to print any document header.
  if (path === '/settings' && need === 'view') return next();
  // Choosing a customer on a sales document needs the customer list.
  if (path === '/customers' && need === 'view' && allows(user, 'sales', 'view')) return next();
  // Ledger links in reports need the chart of accounts.
  if (path === '/accounts' && need === 'view' && allows(user, 'reports', 'view')) return next();

  const rule = RULES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  // Unknown paths are admin-only, so a new endpoint is never open by accident.
  if (!rule) return user.role === 'admin' ? next() : deny(res, 'ไม่มีสิทธิ์เข้าถึง');
  if (allows(user, rule[1], need)) return next();
  return deny(res, need === 'view' ? 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้' : 'ไม่มีสิทธิ์แก้ไขข้อมูลนี้');
}
