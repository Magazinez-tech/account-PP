import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { MODULES, LEVEL_LABEL } from '../permissions.js';

const EMPTY = { email: '', name: '', password: '', role: 'staff', permissions: {}, active: true };

function summary(user) {
  if (user.role === 'admin') return 'ทุกเมนู (ผู้ดูแลระบบ)';
  const parts = MODULES.filter((m) => user.permissions?.[m.key])
    .map((m) => `${m.label}: ${LEVEL_LABEL[user.permissions[m.key]]}`);
  return parts.length ? parts.join(' · ') : 'ยังไม่มีสิทธิ์ (เห็นแค่ภาพรวม)';
}

// Create or edit one user. Staff get a level per module; admins have everything.
function UserForm({ initial, isNew, isSelf, onSave, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY, ...initial });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setLevel = (module, level) => setForm({ ...form, permissions: { ...form.permissions, [module]: level } });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSave(form);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form-grid" onSubmit={submit}>
      <h2 className="span-2" style={{ margin: 0 }}>{isNew ? 'เพิ่มผู้ใช้' : `แก้ไข ${initial.email}`}</h2>
      {isNew && (
        <label>อีเมล (ใช้เข้าสู่ระบบ) *
          <input type="email" required value={form.email} onChange={set('email')} />
        </label>
      )}
      <label>ชื่อที่แสดง
        <input value={form.name} onChange={set('name')} />
      </label>
      {isNew && (
        <label>รหัสผ่านเริ่มต้น (อย่างน้อย 8 ตัว) *
          <input type="password" required minLength={8} value={form.password} onChange={set('password')} autoComplete="new-password" />
        </label>
      )}
      <label>บทบาท
        <select value={form.role} onChange={set('role')} disabled={isSelf}>
          <option value="staff">พนักงาน (กำหนดสิทธิ์เอง)</option>
          <option value="admin">ผู้ดูแลระบบ (ทุกสิทธิ์ และจัดการผู้ใช้ได้)</option>
        </select>
      </label>
      {!isNew && (
        <label className="check">
          <input type="checkbox" checked={form.active} onChange={set('active')} disabled={isSelf} />
          เปิดใช้งานบัญชีนี้ (ปิดแล้วจะเข้าระบบไม่ได้ทันที)
        </label>
      )}

      <div className="span-2 table-wrap">
        <table className="perm-table">
          <thead>
            <tr><th>เมนู</th>{Object.entries(LEVEL_LABEL).map(([k, v]) => <th key={k} className="center">{v}</th>)}</tr>
          </thead>
          <tbody>
            {MODULES.map((m) => (
              <tr key={m.key} className={form.role === 'admin' ? 'muted' : ''}>
                <td><strong>{m.label}</strong><div className="muted small">{m.hint}</div></td>
                {Object.keys(LEVEL_LABEL).map((level) => (
                  <td key={level} className="center">
                    <input
                      type="radio"
                      name={`perm-${m.key}`}
                      aria-label={`${m.label} ${LEVEL_LABEL[level]}`}
                      disabled={form.role === 'admin'}
                      checked={form.role === 'admin' ? level === 'edit' : (form.permissions[m.key] || 'none') === level}
                      onChange={() => setLevel(m.key, level)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">ทุกคนเห็นหน้าภาพรวมและเปลี่ยนรหัสผ่านของตัวเองได้ ผู้มีสิทธิ์ดูเอกสารขายจะเห็นรายชื่อลูกค้าเพื่อเลือกในเอกสารด้วย</p>
      </div>

      {error && <div className="error span-2">{error}</div>}
      <div className="span-2 actions">
        <button className="primary" disabled={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        <button type="button" onClick={onCancel}>ยกเลิก</button>
      </div>
    </form>
  );
}

export default function Users({ currentUser }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | user
  const [resetFor, setResetFor] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function load() {
    api('GET', '/users').then(setRows).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  async function save(form) {
    if (editing === 'new') {
      await api('POST', '/users', form);
      setMessage(`เพิ่มผู้ใช้ ${form.email} แล้ว`);
    } else {
      await api('PUT', `/users/${editing.id}`, form);
      setMessage(`บันทึกสิทธิ์ของ ${editing.email} แล้ว`);
    }
    setEditing(null);
    load();
  }

  async function resetPassword(e) {
    e.preventDefault();
    setError('');
    try {
      await api('POST', `/users/${resetFor.id}/password`, { password: newPassword });
      setMessage(`ตั้งรหัสผ่านใหม่ให้ ${resetFor.email} แล้ว`);
      setResetFor(null);
      setNewPassword('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(user) {
    if (!window.confirm(`ลบผู้ใช้ ${user.email} ใช่หรือไม่? ถ้าแค่ต้องการระงับ ให้ปิดการใช้งานแทน`)) return;
    setError('');
    try {
      await api('DELETE', `/users/${user.id}`);
      setMessage(`ลบ ${user.email} แล้ว`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>ผู้ใช้งานและสิทธิ์</h1>
        {!editing && <button className="primary" onClick={() => { setEditing('new'); setMessage(''); }}>+ เพิ่มผู้ใช้</button>}
      </div>
      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}

      {editing && (
        <UserForm
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? EMPTY : editing}
          isNew={editing === 'new'}
          isSelf={editing !== 'new' && editing.id === currentUser.id}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      {resetFor && (
        <form className="card toolbar" onSubmit={resetPassword}>
          <span>ตั้งรหัสผ่านใหม่ให้ <strong>{resetFor.email}</strong></span>
          <input type="password" minLength={8} required placeholder="รหัสผ่านใหม่ อย่างน้อย 8 ตัว" value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" style={{ maxWidth: 280 }} />
          <button className="primary">บันทึกรหัสใหม่</button>
          <button type="button" onClick={() => setResetFor(null)}>ยกเลิก</button>
        </form>
      )}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>อีเมล</th><th>ชื่อ</th><th>สิทธิ์</th><th>สถานะ</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.email}{u.id === currentUser.id && <span className="muted small"> (คุณ)</span>}</td>
                <td>{u.name}</td>
                <td className="small">{summary(u)}</td>
                <td><span className={`badge ${u.active ? 'paid' : 'cancelled'}`}>{u.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td>
                <td className="actions-cell">
                  <button className="ghost" onClick={() => { setEditing(u); setMessage(''); }}>แก้ไขสิทธิ์</button>
                  {u.id !== currentUser.id && (
                    <>
                      <button className="ghost" onClick={() => { setResetFor(u); setNewPassword(''); }}>ตั้งรหัสใหม่</button>
                      <button className="ghost danger" onClick={() => remove(u)}>ลบ</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
