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

  const [logo, setLogo] = useState(null);

  useEffect(() => {
    api('GET', '/settings').then((s) => {
      setLogo(s.logo || null);
      setForm(Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'logo').map(([k, v]) => [k, v || ''])));
    }).catch((e) => setError(e.message));
  }, []);

  // Reads the chosen image, then sends it to the server (which checks the type and size again).
  function pickLogo(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('รองรับเฉพาะไฟล์รูป PNG, JPG หรือ WEBP');
      return;
    }
    if (file.size > 700 * 1024) {
      setError('ไฟล์รูปต้องมีขนาดไม่เกิน 700 KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setError('');
      setMessage('');
      try {
        await api('PUT', '/settings/logo', { data: reader.result });
        setLogo(reader.result);
        setMessage('อัปโหลดตราบริษัทแล้ว');
      } catch (err) {
        setError(err.message);
      }
    };
    reader.readAsDataURL(file);
  }

  async function removeLogo() {
    if (!window.confirm('ลบตราบริษัทใช่หรือไม่?')) return;
    try {
      await api('DELETE', '/settings/logo');
      setLogo(null);
      setMessage('ลบตราบริษัทแล้ว');
    } catch (err) {
      setError(err.message);
    }
  }

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
      <div className="card logo-box">
        <div className="logo-preview">
          {logo ? <img src={logo} alt="ตราบริษัท" /> : <span className="muted">ยังไม่มีตรา</span>}
        </div>
        <div className="logo-actions">
          <div className="section-label">ตราบริษัท (PNG, JPG หรือ WEBP ไม่เกิน 700 KB)</div>
          <div className="actions">
            <label className="file-btn">
              เลือกรูป
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pickLogo} />
            </label>
            {logo && <button type="button" className="ghost danger" onClick={removeLogo}>ลบตรา</button>}
          </div>
          <div className="muted small">ตราจะแสดงที่หัวใบเสนอราคา ใบกำกับภาษี และใบเสร็จ แทนตัวอักษรแรกของชื่อบริษัท</div>
        </div>
      </div>

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
