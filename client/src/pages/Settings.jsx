import { useEffect, useState } from 'react';
import { api } from '../api.js';

const FIELDS = [
  ['name', 'ชื่อบริษัท *', 'span-2', true],
  ['address', 'ที่อยู่บริษัท', 'span-2', false, 'textarea'],
  ['tax_id', 'เลขประจำตัวผู้เสียภาษี'],
  ['phone', 'เบอร์โทรศัพท์'],
  ['email', 'อีเมล'],
  ['website', 'เว็บไซต์'],
  ['bank_name', 'ธนาคาร'],
  ['bank_account_no', 'เลขที่บัญชี'],
  ['bank_account_name', 'ชื่อบัญชี'],
  ['approver_name', 'ชื่อผู้อนุมัติเอกสาร'],
  ['quotation_terms', 'เงื่อนไขท้ายใบเสนอราคา', 'span-2', false, 'textarea'],
];

// Company profile. These values print on every quotation and tax invoice.
export default function Settings() {
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('GET', '/settings').then((s) => setForm(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v || ''])))).catch((e) => setError(e.message));
  }, []);

  if (!form) return error ? <div className="error">{error}</div> : <p>กำลังโหลด...</p>;

  async function save(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await api('PUT', '/settings', form);
      setMessage('บันทึกข้อมูลบริษัทแล้ว');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>ข้อมูลบริษัท</h1>
      </div>
      <p className="muted">ข้อมูลนี้จะแสดงบนหัวใบเสนอราคาและใบกำกับภาษี</p>
      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}
      <form className="card form-grid" onSubmit={save}>
        {FIELDS.map(([key, label, cls, required, kind]) => (
          <label key={key} className={cls || ''}>
            {label}
            {kind === 'textarea'
              ? <textarea rows="3" value={form[key]} required={required} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              : <input value={form[key]} required={required} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />}
          </label>
        ))}
        <div className="span-2 actions">
          <button className="primary" disabled={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        </div>
      </form>
    </div>
  );
}
