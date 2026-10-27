import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, toSatang } from '../format.js';

const today = () => new Date().toISOString().slice(0, 10);

const PAY_FROM = [
  ['cash', 'จ่ายด้วยเงินสด'],
  ['bank', 'จ่ายจากเงินฝากธนาคาร'],
  ['ap', 'ค้างจ่าย (เจ้าหนี้การค้า)'],
];

// Simple expense entry. Picks the expense category, amount and how it was paid,
// and posts the balanced journal entry automatically.
export default function ExpenseForm() {
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({
    date: today(), description: '', account_id: '', amount: '', with_vat: false, pay_from: 'bank',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('GET', '/accounts').then((rows) => setAccounts(rows.filter((a) => a.type === 'expense'))).catch((e) => setError(e.message));
  }, []);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const amount = toSatang(form.amount);
  const vat = form.with_vat ? Math.round((amount * 7) / 100) : 0;

  async function save(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('POST', '/expenses', { ...form, amount: Number(form.amount) });
      window.location.hash = '#/journal';
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>บันทึกค่าใช้จ่าย</h1>
        <a className="button" href="#/journal">กลับสมุดรายวัน</a>
      </div>
      <form className="card form-grid" onSubmit={save}>
        <label>วันที่<input type="date" value={form.date} onChange={set('date')} required /></label>
        <label>หมวดค่าใช้จ่าย *
          <select value={form.account_id} onChange={set('account_id')} required>
            <option value="">-- เลือกหมวด --</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select>
        </label>
        <label className="span-2">รายละเอียด (ผู้รับเงิน / สิ่งที่จ่าย) *
          <input value={form.description} onChange={set('description')} required />
        </label>
        <label>จำนวนเงินก่อน VAT (บาท) *
          <input className="num" type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} required />
        </label>
        <label>วิธีจ่าย
          <select value={form.pay_from} onChange={set('pay_from')}>
            {PAY_FROM.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
        <label className="span-2 check">
          <input type="checkbox" checked={form.with_vat} onChange={set('with_vat')} />
          มีภาษีมูลค่าเพิ่ม 7% (บันทึกเป็นภาษีซื้อ)
        </label>
        <div className="span-2 totals">
          <div><span>ค่าใช้จ่าย</span><span>{money(amount)}</span></div>
          <div><span>ภาษีซื้อ 7%</span><span>{money(vat)}</span></div>
          <div className="grand"><span>ยอดจ่ายรวม</span><span>{money(amount + vat)}</span></div>
        </div>
        {error && <div className="error span-2">{error}</div>}
        <div className="span-2 actions">
          <button className="primary" disabled={busy || !form.account_id || amount <= 0}>
            {busy ? 'กำลังบันทึก...' : 'บันทึกค่าใช้จ่าย'}
          </button>
        </div>
      </form>
    </div>
  );
}
