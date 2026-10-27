import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, toSatang } from '../format.js';

const EMPTY = { code: '', name: '', size: '', unit: '', price: '', cost: '', note: '', active: true };

// Product / service catalog. Prices are before VAT; quotations and invoices use the selling price,
// POs use the cost price (or the selling price when no cost is set).
function ProductForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSave({ ...form, price: toSatang(form.price), cost: toSatang(form.cost) });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form-grid" onSubmit={submit}>
      <h2 className="span-2" style={{ margin: 0 }}>{initial.id ? `แก้ไข ${initial.name}` : 'เพิ่มสินค้า / บริการ'}</h2>
      <label>รหัสสินค้า<input value={form.code} onChange={set('code')} placeholder="เช่น P001" /></label>
      <label>ชื่อสินค้า / บริการ *<input required value={form.name} onChange={set('name')} autoFocus /></label>
      <label>หน่วย<input value={form.unit} onChange={set('unit')} placeholder="ชิ้น, ชุด, งาน, เดือน" /></label>
      <label>ราคาขาย (บาท, ไม่รวม VAT)
        <input className="num" type="number" min="0" step="0.01" value={form.price} onChange={set('price')} />
      </label>
      <label>ราคาทุน (บาท, ไม่รวม VAT) <span className="muted small">ใช้ใน PO</span>
        <input className="num" type="number" min="0" step="0.01" value={form.cost} onChange={set('cost')} />
      </label>
      <label>หมายเหตุ<input value={form.note} onChange={set('note')} /></label>
      {initial.id && (
        <label className="check span-2">
          <input type="checkbox" checked={form.active} onChange={set('active')} />
          แสดงในรายการให้เลือก (ปิดถ้าเลิกขายแล้ว)
        </label>
      )}
      {error && <div className="error span-2">{error}</div>}
      <div className="span-2 actions">
        <button className="primary" disabled={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        <button type="button" onClick={onCancel}>ยกเลิก</button>
      </div>
    </form>
  );
}

export default function Products({ canEdit }) {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | product
  const [error, setError] = useState('');

  function load() {
    api('GET', `/products?q=${encodeURIComponent(q)}`).then(setRows).catch((e) => setError(e.message));
  }

  useEffect(load, [q]);

  async function save(form) {
    if (editing === 'new') await api('POST', '/products', form);
    else await api('PUT', `/products/${editing.id}`, form);
    setEditing(null);
    load();
  }

  async function remove(p) {
    if (!window.confirm(`ลบ ${p.name} ใช่หรือไม่? เอกสารที่ออกไปแล้วจะไม่เปลี่ยน`)) return;
    try {
      await api('DELETE', `/products/${p.id}`);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const toForm = (p) => ({ ...p, code: p.code || '', size: p.size || '', unit: p.unit || '', note: p.note || '',
    price: p.price ? String(p.price / 100) : '', cost: p.cost ? String(p.cost / 100) : '' });

  return (
    <div>
      <div className="page-head">
        <h1>รายการสินค้า / บริการ</h1>
        {canEdit && !editing && <button className="primary" onClick={() => setEditing('new')}>+ เพิ่มสินค้า</button>}
      </div>
      {error && <div className="error">{error}</div>}

      {editing && (
        <ProductForm
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? EMPTY : toForm(editing)}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="toolbar">
        <input type="search" placeholder="ค้นหาจากรหัสหรือชื่อสินค้า" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>รหัส</th><th>ชื่อสินค้า / บริการ</th><th>หน่วย</th>
              <th className="num">ราคาขาย</th><th className="num">ราคาทุน</th><th>สถานะ</th>{canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan="7" className="muted">ยังไม่มีสินค้า</td></tr>}
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{p.code || '-'}</td>
                <td>{p.name}{p.note && <div className="muted small">{p.note}</div>}</td>
                <td>{p.unit || '-'}</td>
                <td className="num">{money(p.price)}</td>
                <td className="num">{p.cost ? money(p.cost) : '-'}</td>
                <td><span className={`badge ${p.active ? 'paid' : 'cancelled'}`}>{p.active ? 'ใช้งาน' : 'เลิกใช้'}</span></td>
                {canEdit && (
                  <td className="actions-cell">
                    <button className="ghost" onClick={() => setEditing(p)}>แก้ไข</button>
                    <button className="ghost danger" onClick={() => remove(p)}>ลบ</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
