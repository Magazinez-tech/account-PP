import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { money, toSatang } from '../format.js';
import { CONFIG } from './docConfig.js';

const VAT_RATE = 7;
const blankItem = () => ({ description: '', size: '', qty: 1, unit: '', price: '' });
const today = () => new Date().toISOString().slice(0, 10);

// Mirrors server/money.js so the user sees totals before saving. The server recalculates.
function totalsOf(items, discountBaht) {
  const subtotal = items.reduce((sum, i) => sum + toSatang((Number(i.qty) || 0) * (Number(i.price) || 0)), 0);
  const discount = toSatang(discountBaht);
  const taxable = Math.max(0, subtotal - discount);
  const vat = Math.round((taxable * VAT_RATE) / 100);
  return { subtotal, discount, vat, total: taxable + vat };
}

export default function DocumentEditor({ kind, id }) {
  const cfg = CONFIG[kind];
  const isEdit = Boolean(id);
  const preselected = new URLSearchParams(window.location.hash.split('?')[1] || '').get('customer') || '';

  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({
    customer_id: preselected,
    issue_date: today(),
    [cfg.dateField]: '',
    discount: '',
    note: '',
    project_name: '',
    reference_no: '',
    salesperson: '',
  });
  const [items, setItems] = useState([blankItem()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!isEdit);

  useEffect(() => {
    api('GET', cfg.partyApi || '/customers').then(setCustomers).catch((e) => setError(e.message));
    api('GET', '/products?active=1').then(setProducts).catch(() => setProducts([]));
    if (!isEdit) return;
    api('GET', `${cfg.api}/${id}`).then((doc) => {
      setForm({
        customer_id: String(doc.customer_id),
        issue_date: doc.issue_date,
        [cfg.dateField]: doc[cfg.dateField] || '',
        discount: doc.discount ? String(doc.discount / 100) : '',
        note: doc.note || '',
        project_name: doc.project_name || '',
        reference_no: doc.reference_no || '',
        salesperson: doc.salesperson || '',
      });
      setItems(doc.items.map((i) => ({ description: i.description, size: i.size || '', qty: i.qty, unit: i.unit || '', price: String(i.unit_price / 100) })));
      setLoaded(true);
    }).catch((e) => setError(e.message));
  }, [kind, id]);

  const totals = useMemo(() => totalsOf(items, form.discount), [items, form.discount]);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  function setItem(index, key, value) {
    setItems(items.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  }

  // Typing or picking a catalog name/code fills in the line. POs use the cost price when one is set.
  function setDescription(index, value) {
    const p = products.find((x) => x.name === value || (x.code && x.code === value));
    if (!p) return setItem(index, 'description', value);
    const price = kind === 'po' && p.cost ? p.cost : p.price;
    setItems(items.map((item, i) => (i === index
      ? { ...item, description: p.name, unit: p.unit || item.unit, price: price ? String(price / 100) : item.price }
      : item)));
  }

  async function save() {
    setError('');
    setBusy(true);
    const payload = {
      ...form,
      customer_id: Number(form.customer_id),
      discount: toSatang(form.discount),
      items: items.map((i) => ({ description: i.description, size: i.size, qty: Number(i.qty), unit: i.unit, unit_price: toSatang(i.price) })),
    };
    try {
      const result = isEdit
        ? await api('PUT', `${cfg.api}/${id}`, payload)
        : await api('POST', cfg.api, payload);
      window.location.hash = `#/${cfg.path}/${result.id || id}`;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <p>กำลังโหลด...</p>;

  return (
    <div>
      <div className="page-head">
        <h1>{isEdit ? `แก้ไข${cfg.title}` : `สร้าง${cfg.title}`}</h1>
      </div>

      <div className="card form-grid">
        <label className="span-2">{cfg.partyLabel || 'ลูกค้า'} *
          <select value={form.customer_id} onChange={set('customer_id')} required>
            <option value="">-- เลือก{cfg.partyLabel || 'ลูกค้า'} --</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.company_name ? `${c.company_name} (${c.name})` : c.name}</option>
            ))}
          </select>
        </label>
        <label>วันที่ออกเอกสาร<input type="date" value={form.issue_date} onChange={set('issue_date')} /></label>
        <label>{cfg.dateLabel}<input type="date" value={form[cfg.dateField]} onChange={set(cfg.dateField)} /></label>
          <>
            <label>ชื่อโปรเจกต์<input value={form.project_name} onChange={set('project_name')} /></label>
            <label>เลขที่อ้างอิง<input value={form.reference_no} onChange={set('reference_no')} /></label>
            <label>{cfg.personLabel || 'ชื่อผู้ขาย'}<input value={form.salesperson} onChange={set('salesperson')} /></label>
          </>
        <label className="span-2">หมายเหตุ<input value={form.note} onChange={set('note')} /></label>
      </div>

      <h2>รายการสินค้า / บริการ</h2>
      <div className="card table-wrap">
        <table className="items">
          <thead>
            <tr>
              <th>รายละเอียด</th><th>ขนาด</th><th className="num">จำนวน</th><th>หน่วย</th>
              <th className="num">ราคาต่อหน่วย (บาท, ไม่รวม VAT)</th><th className="num">รวม (บาท)</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={index}>
                <td>
                  <input list="product-list" value={item.description} placeholder="พิมพ์หรือเลือกจากรายการสินค้า"
                    onChange={(e) => setDescription(index, e.target.value)} />
                </td>
                <td><input value={item.size} placeholder="เช่น 60x120 ซม." onChange={(e) => setItem(index, 'size', e.target.value)} /></td>
                <td><input className="num" type="number" min="0" step="any" value={item.qty} onChange={(e) => setItem(index, 'qty', e.target.value)} /></td>
                <td><input value={item.unit} onChange={(e) => setItem(index, 'unit', e.target.value)} /></td>
                <td><input className="num" type="number" min="0" step="0.01" value={item.price} onChange={(e) => setItem(index, 'price', e.target.value)} /></td>
                <td className="num">{money(toSatang((Number(item.qty) || 0) * (Number(item.price) || 0)))}</td>
                <td>
                  <button className="ghost danger" disabled={items.length === 1}
                    onClick={() => setItems(items.filter((_, i) => i !== index))}>ลบ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="product-list">
          {products.map((p) => (
            <option key={p.id} value={p.name}>
              {[p.code, p.unit, money(kind === 'po' && p.cost ? p.cost : p.price)].filter(Boolean).join(' · ')}
            </option>
          ))}
        </datalist>
        <button className="ghost" onClick={() => setItems([...items, blankItem()])}>+ เพิ่มรายการ</button>
      </div>

      <div className="card totals">
        <label>ส่วนลดท้ายบิล (บาท)
          <input className="num" type="number" min="0" step="0.01" value={form.discount} onChange={set('discount')} />
        </label>
        <div><span>รวมเป็นเงิน</span><span>{money(totals.subtotal)}</span></div>
        <div><span>ส่วนลด</span><span>{money(totals.discount)}</span></div>
        <div><span>ภาษีมูลค่าเพิ่ม {VAT_RATE}%</span><span>{money(totals.vat)}</span></div>
        <div className="grand"><span>ยอดสุทธิ</span><span>{money(totals.total)}</span></div>
      </div>

      {error && <div className="error">{error}</div>}
      <div className="actions">
        <button className="primary" disabled={busy || !form.customer_id} onClick={save}>
          {busy ? 'กำลังบันทึก...' : 'บันทึกร่าง'}
        </button>
        <a className="button" href={`#/${cfg.path}`}>ยกเลิก</a>
      </div>
    </div>
  );
}
