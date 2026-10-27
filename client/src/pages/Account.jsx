import { useState } from 'react';
import { api } from '../api.js';
import { MODULES, LEVEL_LABEL, isAdmin } from '../permissions.js';

// The signed-in user's own account: what they can access, and changing their password.
export default function Account({ user }) {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (form.new_password !== form.confirm) {
      setError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
      return;
    }
    setBusy(true);
    try {
      await api('POST', '/me/password', { current_password: form.current_password, new_password: form.new_password });
      setMessage('เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นที่เข้าระบบไว้จะถูกออกจากระบบ');
      setForm({ current_password: '', new_password: '', confirm: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>บัญชีของฉัน</h1>
      </div>

      <div className="card">
        <div><span className="muted">อีเมล: </span>{user.email}</div>
        <div><span className="muted">ชื่อ: </span>{user.name}</div>
        <div><span className="muted">บทบาท: </span>{isAdmin(user) ? 'ผู้ดูแลระบบ' : 'พนักงาน'}</div>
        {!isAdmin(user) && (
          <div className="small" style={{ marginTop: '0.5rem' }}>
            <span className="muted">สิทธิ์: </span>
            {MODULES.map((m) => `${m.label}: ${LEVEL_LABEL[user.permissions?.[m.key] || 'none']}`).join(' · ')}
          </div>
        )}
      </div>

      <h2>เปลี่ยนรหัสผ่าน</h2>
      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}
      <form className="card form-grid" onSubmit={submit}>
        <label className="span-2">รหัสผ่านปัจจุบัน
          <input type="password" required value={form.current_password} onChange={set('current_password')} autoComplete="current-password" />
        </label>
        <label>รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)
          <input type="password" required minLength={8} value={form.new_password} onChange={set('new_password')} autoComplete="new-password" />
        </label>
        <label>ยืนยันรหัสผ่านใหม่
          <input type="password" required minLength={8} value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
        </label>
        <div className="span-2 actions">
          <button className="primary" disabled={busy}>{busy ? 'กำลังบันทึก...' : 'เปลี่ยนรหัสผ่าน'}</button>
        </div>
      </form>
    </div>
  );
}
