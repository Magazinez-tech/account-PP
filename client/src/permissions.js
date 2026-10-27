// Client-side view of the access rules in server/permissions.js. The server is the real gate;
// this only hides menus and pages the user cannot use.

export const MODULES = [
  { key: 'customers', label: 'ลูกค้า', hint: 'รายชื่อลูกค้า' },
  { key: 'sales', label: 'เอกสารขาย', hint: 'ใบเสนอราคา ใบกำกับภาษี รับชำระ ใบเสร็จ' },
  { key: 'purchasing', label: 'จัดซื้อ', hint: 'ผู้ขาย ใบสั่งซื้อ จ่ายชำระ เจ้าหนี้คงค้าง' },
  { key: 'accounting', label: 'บัญชี', hint: 'สมุดรายวัน ค่าใช้จ่าย ผังบัญชี' },
  { key: 'reports', label: 'รายงาน', hint: 'งบการเงิน ภ.พ.30 ลูกหนี้คงค้าง' },
  { key: 'settings', label: 'ข้อมูลบริษัท', hint: 'แก้ไขข้อมูลและตราบริษัท' },
];

export const LEVEL_LABEL = { none: 'ไม่มีสิทธิ์', view: 'ดูอย่างเดียว', edit: 'ดูและแก้ไข' };

export const isAdmin = (user) => user?.role === 'admin';

export function can(user, module, need = 'view') {
  if (!user) return false;
  if (!module || isAdmin(user)) return true;
  const level = user.permissions?.[module] || 'none';
  return need === 'view' ? level === 'view' || level === 'edit' : level === 'edit';
}

// Module that guards each page (first part of the hash route). Pages not listed are open to everyone.
export const SECTION_MODULE = {
  customers: 'customers',
  quotations: 'sales',
  invoices: 'sales',
  receipts: 'sales',
  suppliers: 'purchasing',
  'purchase-orders': 'purchasing',
  payables: 'purchasing',
  journal: 'accounting',
  accounts: 'accounting',
  reports: 'reports',
  aging: 'reports',
  settings: 'settings',
};
