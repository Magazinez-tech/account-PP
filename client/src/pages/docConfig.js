// Differences between quotations and tax invoices, kept in one place.
export const CONFIG = {
  quotation: {
    title: 'ใบเสนอราคา',
    api: '/quotations',
    path: 'quotations',
    statuses: ['draft', 'sent', 'accepted', 'rejected'],
    dateLabel: 'วันหมดอายุ',
    dateField: 'valid_until',
  },
  invoice: {
    title: 'ใบกำกับภาษี',
    api: '/invoices',
    path: 'invoices',
    statuses: ['draft', 'issued', 'paid', 'cancelled'],
    dateLabel: 'วันครบกำหนดชำระ',
    dateField: 'due_date',
  },
  po: {
    title: 'ใบสั่งซื้อ',
    api: '/purchase-orders',
    path: 'purchase-orders',
    statuses: ['draft', 'approved', 'received', 'paid', 'cancelled'],
    dateLabel: 'วันที่ต้องการรับสินค้า',
    dateField: 'expected_date',
    partyApi: '/suppliers',
    partyLabel: 'ผู้ขาย',
    personLabel: 'ผู้ขอซื้อ',
  },
};
