import { useEffect, useState } from 'react';
import { api } from '../api.js';

const EMPTY = { name: '', company_name: '', tax_id: '', branch: '', address: '', contact_name: '', phone: '', email: '', credit_days: 30, note: '' };

// Shared by the list (new customer) and the detail page (edit customer).
export function CustomerForm({ initial, onSaved, nameLabel = 'ชื่อลูกค้า' }) {
  const [form, setForm] = useState({ ...EMPTY, ...initial });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSaved(form);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form-grid" onSubmit={submit}>
      <label>{nameLabel} *<input value={form.name} onChange={set('name')} required /></label>
      <label>ชื่อบริษัท<input value={form.company_name || ''} onChange={set('company_name')} /></label>
      <label>เลขประจำตัวผู้เสียภาษี (13 หลัก)<input value={form.tax_id || ''} onChange={set('tax_id')} maxLength={13} /></label>
      <label>สาขา<input value={form.branch || ''} onChange={set('branch')} placeholder="00000 หรือ สำนักงานใหญ่" /></label>
      <label className="span-2">ที่อยู่ (สำหรับออกเอกสาร)<textarea rows="2" value={form.address || ''} onChange={set('address')} /></label>
      <label>ผู้ติดต่อ<input value={form.contact_name || ''} onChange={set('contact_name')} /></label>
      <label>โทรศัพท์<input value={form.phone || ''} onChange={set('phone')} /></label>
      <label>อีเมล<input type="email" value={form.email || ''} onChange={set('email')} /></label>
      <label>เครดิต (วัน)<input type="number" min="0" value={form.credit_days} onChange={set('credit_days')} /></label>
      <label className="span-2">หมายเหตุ<input value={form.note || ''} onChange={set('note')} /></label>
      {error && <div className="error span-2">{error}</div>}
      <div className="span-2 actions">
        <button className="primary" disabled={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button>
      </div>
    </form>
  );
}

export default function CustomersPage() {
  const [q, setQ] = useState('');
  const [customers, setCustomers] = useState([]);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function load(query = q) {
    api('GET', `/customers?q=${encodeURIComponent(query)}`).then(setCustomers).catch((e) => setError(e.message));
  }

  useEffect(() => { load(''); }, []);

  // After saving, close the form and show the updated list (not the detail page).
  async function create(form) {
    await api('POST', '/customers', form);
    setAdding(false);
    setMessage(`เพิ่มลูกค้า "${form.name}" แล้ว`);
    setQ('');
    load('');
  }

  return (
    <div>
      <div className="page-head">
        <h1>ลูกค้า</h1>
        <button className="primary" onClick={() => setAdding(!adding)}>{adding ? 'ปิดฟอร์ม' : '+ เพิ่มลูกค้า'}</button>
      </div>

      {message && <div className="success">{message}</div>}
      {adding && <CustomerForm onSaved={create} />}

      <div className="toolbar">
        <input
          placeholder="ค้นหาจากชื่อ ชื่อบริษัท เลขผู้เสียภาษี หรือเบอร์โทร"
          value={q}
          onChange={(e) => { setQ(e.target.value); load(e.target.value); }}
        />
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>ชื่อบริษัท</th><th>ชื่อ</th><th>เลขผู้เสียภาษี</th><th>โทรศัพท์</th><th className="num">เครดิต (วัน)</th></tr>
          </thead>
          <tbody>
            {customers.length === 0 && <tr><td colSpan="5" className="muted">ยังไม่มีข้อมูลลูกค้า</td></tr>}
            {customers.map((c) => (
              <tr key={c.id}>
                <td><a href={`#/customers/${c.id}`}>{c.company_name || '-'}</a></td>
                <td><a href={`#/customers/${c.id}`}>{c.name}</a></td>
                <td>{c.tax_id || '-'}</td>
                <td>{c.phone || '-'}</td>
                <td className="num">{c.credit_days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
