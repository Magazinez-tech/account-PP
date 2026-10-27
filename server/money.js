// All money is stored as integer satang (1 baht = 100 satang).
// Prices are entered VAT-exclusive; VAT is calculated on the discounted subtotal.

export const VAT_RATE = 7;

export function toSatang(baht) {
  return Math.round(Number(baht) * 100);
}

export function calcTotals(items, discount = 0) {
  const lines = items.map((item, index) => {
    const qty = Number(item.qty);
    const unitPrice = Math.round(Number(item.unit_price));
    return {
      description: String(item.description || '').trim(),
      qty,
      unit: item.unit ? String(item.unit).trim() : null,
      unit_price: unitPrice,
      amount: Math.round(qty * unitPrice),
      sort: index,
    };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const taxable = Math.max(0, subtotal - discount);
  const vat = Math.round((taxable * VAT_RATE) / 100);
  return { lines, subtotal, discount, vat, total: taxable + vat };
}

export function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) return 'ต้องมีรายการสินค้า/บริการอย่างน้อย 1 รายการ';
  for (const item of items) {
    if (!item.description || !String(item.description).trim()) return 'ต้องระบุรายละเอียดทุกรายการ';
    if (!(Number(item.qty) > 0)) return 'จำนวนต้องมากกว่า 0';
    if (!(Number(item.unit_price) >= 0)) return 'ราคาต่อหน่วยไม่ถูกต้อง';
  }
  return null;
}
