// Money is stored as satang (integer). Display converts to baht.
export function money(satang) {
  return (Number(satang || 0) / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function toSatang(baht) {
  return Math.round(Number(baht || 0) * 100);
}

export function date(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export const STATUS_LABEL = {
  draft: 'ร่าง',
  sent: 'ส่งแล้ว',
  accepted: 'อนุมัติ',
  rejected: 'ปฏิเสธ',
  issued: 'ออกแล้ว (ค้างชำระ)',
  approved: 'อนุมัติแล้ว',
  received: 'รับสินค้าแล้ว (ค้างจ่าย)',
  paid: 'ชำระครบแล้ว',
  cancelled: 'ยกเลิก',
};

export const METHOD_LABEL = { cash: 'เงินสด', transfer: 'โอนเงิน', cheque: 'เช็ค', card: 'บัตร' };
