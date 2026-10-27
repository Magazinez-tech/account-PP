import { Fragment, useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, date, toSatang } from '../format.js';
import SearchBox, { matches } from '../components/SearchBox.jsx';

const SOURCE_LABEL = {
  manual: 'รายการทั่วไป',
  expense: 'ค่าใช้จ่าย',
  invoice: 'ใบกำกับภาษี',
  payment: 'รับชำระ',
  reversal: 'กลับรายการ',
  purchase: 'ซื้อ/ตั้งหนี้',
  supplier_payment: 'จ่ายผู้ขาย',
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = () => ({ account_id: '', debit: '', credit: '' });

// Journal list (สมุดรายวันทั่วไป) with a manual entry form.
export default function Journal({ creating }) {
  const [entries, setEntries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState({ date: today(), description: '' });
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  // Filter by entry number, description, source label, or any account on the entry.
  const visible = entries.filter((e) => matches(q, [
    e.entry_no, e.description, SOURCE_LABEL[e.source],
    ...e.lines.flatMap((l) => [l.code, l.name]),
  ]));

  function load() {
    api('GET', '/journal').then(setEntries).catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
    api('GET', '/accounts').then(setAccounts).catch((e) => setError(e.message));
  }, []);

  const debit = lines.reduce((s, l) => s + toSatang(l.debit), 0);
  const credit = lines.reduce((s, l) => s + toSatang(l.credit), 0);
  const balanced = debit > 0 && debit === credit;

  function setLine(i, key, value) {
    setLines(lines.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)));
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('POST', '/journal', {
        date: form.date,
        description: form.description,
        lines: lines.map((l) => ({ account_id: Number(l.account_id), debit: toSatang(l.debit), credit: toSatang(l.credit) })),
      });
      setMessage('บันทึกรายการแล้ว');
      setForm({ date: today(), description: '' });
      setLines([emptyLine(), emptyLine()]);
      window.location.hash = '#/journal';
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reverse(id) {
    if (!window.confirm('กลับรายการนี้ใช่หรือไม่? ระบบจะสร้างรายการกลับด้านใหม่ ไม่ลบรายการเดิม')) return;
    try {
      await api('POST', `/journal/${id}/reverse`, { date: today() });
      setMessage('กลับรายการแล้ว');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (creating) {
    return (
      <div>
        <div className="page-head">
          <h1>บันทึกรายการทั่วไป</h1>
          <a className="button" href="#/journal">กลับสมุดรายวัน</a>
        </div>
        <form className="card form-grid" onSubmit={save}>
          <label>วันที่<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></label>
          <label>คำอธิบายรายการ *<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required /></label>
          <div className="span-2 table-wrap">
            <table className="items">
              <thead><tr><th>บัญชี</th><th className="num">เดบิต (บาท)</th><th className="num">เครดิต (บาท)</th><th></th></tr></thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td>
                      <select value={line.account_id} onChange={(e) => setLine(i, 'account_id', e.target.value)} required>
                        <option value="">-- เลือกบัญชี --</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                      </select>
                    </td>
                    <td><input className="num" type="number" min="0" step="0.01" value={line.debit} onChange={(e) => setLine(i, 'debit', e.target.value)} /></td>
                    <td><input className="num" type="number" min="0" step="0.01" value={line.credit} onChange={(e) => setLine(i, 'credit', e.target.value)} /></td>
                    <td><button type="button" className="ghost danger" disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>ลบ</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="toolbar">
              <button type="button" className="ghost" onClick={() => setLines([...lines, emptyLine()])}>+ เพิ่มบรรทัด</button>
            </div>
          </div>
          <div className="span-2 totals">
            <div><span>รวมเดบิต</span><span>{money(debit)}</span></div>
            <div><span>รวมเครดิต</span><span>{money(credit)}</span></div>
            <div className={balanced ? 'ok-text' : 'danger'}>
              <span>{balanced ? 'สมดุลแล้ว' : 'ยอดเดบิตและเครดิตไม่เท่ากัน'}</span>
              <span>{money(Math.abs(debit - credit))}</span>
            </div>
          </div>
          {error && <div className="error span-2">{error}</div>}
          <div className="span-2 actions">
            <button className="primary" disabled={busy || !balanced}>{busy ? 'กำลังบันทึก...' : 'บันทึกรายการ'}</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <h1>สมุดรายวันทั่วไป</h1>
        <div className="actions">
          <a className="button" href="#/journal/expense">+ บันทึกค่าใช้จ่าย</a>
          <a className="button primary" href="#/journal/new">+ บันทึกรายการทั่วไป</a>
        </div>
      </div>
      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}

      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="ค้นหาจากเลขที่ คำอธิบาย บัญชี หรือประเภท" />
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>เลขที่</th><th>วันที่</th><th>คำอธิบาย</th><th>ประเภท</th><th className="num">ยอดรวม (บาท)</th><th></th></tr>
          </thead>
          <tbody>
            {entries.length === 0 && <tr><td colSpan="6" className="muted">ยังไม่มีรายการบัญชี</td></tr>}
            {entries.length > 0 && visible.length === 0 && (
              <tr><td colSpan="6" className="search-empty">ไม่พบรายการที่ตรงกับ "{q}"</td></tr>
            )}
            {visible.map((e) => {
              const total = e.lines.reduce((s, l) => s + l.debit, 0);
              const open = openId === e.id;
              return (
                <Fragment key={e.id}>
                  <tr className="clickable" onClick={() => setOpenId(open ? null : e.id)}>
                    <td>{e.entry_no}</td>
                    <td>{date(e.entry_date)}</td>
                    <td>{e.description}</td>
                    <td><span className={`badge ${e.source === 'reversal' ? 'warning' : 'sent'}`}>{SOURCE_LABEL[e.source]}</span></td>
                    <td className="num">{money(total)}</td>
                    <td className="no-print">
                      {['manual', 'expense'].includes(e.source) && !e.reversed_of && (
                        <button className="ghost danger" onClick={(ev) => { ev.stopPropagation(); reverse(e.id); }}>กลับรายการ</button>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan="6">
                        <table className="inner">
                          <thead><tr><th>บัญชี</th><th className="num">เดบิต</th><th className="num">เครดิต</th><th>หมายเหตุ</th></tr></thead>
                          <tbody>
                            {e.lines.map((l, i) => (
                              <tr key={i}>
                                <td>{l.code} {l.name}</td>
                                <td className="num">{l.debit ? money(l.debit) : ''}</td>
                                <td className="num">{l.credit ? money(l.credit) : ''}</td>
                                <td>{l.memo || ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
