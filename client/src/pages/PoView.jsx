import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, date, STATUS_LABEL, METHOD_LABEL } from '../format.js';
import DocumentPaper from './DocumentPaper.jsx';
import { COPY_OPTIONS, copyList } from './DocumentView.jsx';

const today = () => new Date().toISOString().slice(0, 10);

// Purchase order: draft → approved → received (supplier bill, books the payable) → paid.
export default function PoView({ id }) {
  const [doc, setDoc] = useState(null);
  const [settings, setSettings] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [copies, setCopies] = useState('original');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [receive, setReceive] = useState({ received_date: today(), bill_no: '', account_id: '', due_date: '' });
  const [pay, setPay] = useState({ amount: '', paid_date: today(), method: 'transfer', note: '' });

  function load() {
    api('GET', `/purchase-orders/${id}`).then(setDoc).catch((e) => setError(e.message));
  }

  useEffect(load, [id]);
  useEffect(() => {
    api('GET', '/settings').then(setSettings).catch((e) => setError(e.message));
    api('GET', '/purchase-accounts').then(setAccounts).catch(() => {});
  }, []);

  // Runs an action, then reloads. Returns true when it succeeded.
  async function run(fn, okMessage) {
    setError('');
    setMessage('');
    try {
      await fn();
      if (okMessage) setMessage(okMessage);
      load();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }

  async function cancel() {
    const draft = doc.status === 'draft';
    if (!window.confirm(draft ? 'ลบร่างใบสั่งซื้อนี้ใช่หรือไม่?' : 'ยกเลิกใบสั่งซื้อนี้ใช่หรือไม่? เลขที่เดิมจะยังคงอยู่ในระบบ')) return;
    try {
      await api('POST', `/purchase-orders/${id}/cancel`);
      if (draft) window.location.hash = '#/purchase-orders';
      else load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && !doc) return <div className="error">{error}</div>;
  if (!doc || !settings) return <p>กำลังโหลด...</p>;

  const outstanding = doc.total - doc.paid;
  const canCancel = doc.status !== 'cancelled' && doc.paid === 0;

  return (
    <div>
      <div className="page-head no-print">
        <div>
          <h1>ใบสั่งซื้อ {doc.no}</h1>
          <span className={`badge ${doc.status === 'received' ? 'issued' : doc.status}`}>{STATUS_LABEL[doc.status]}</span>
        </div>
        <div className="actions">
          {doc.status === 'draft' && <a className="button" href={`#/purchase-orders/${id}/edit`}>แก้ไข</a>}
          {doc.status === 'draft' && (
            <button className="primary" onClick={() => run(() => api('POST', `/purchase-orders/${id}/approve`), 'อนุมัติใบสั่งซื้อแล้ว')}>อนุมัติ</button>
          )}
          <button className="primary" onClick={() => window.print()}>พิมพ์ / บันทึกเป็น PDF</button>
          {canCancel && <button className="ghost danger" onClick={cancel}>{doc.status === 'draft' ? 'ลบร่าง' : 'ยกเลิกใบสั่งซื้อ'}</button>}
        </div>
      </div>

      {message && <div className="success no-print">{message}</div>}
      {error && <div className="error no-print">{error}</div>}

      {doc.status === 'approved' && (
        <form className="card form-grid no-print" onSubmit={(e) => {
          e.preventDefault();
          run(() => api('POST', `/purchase-orders/${id}/receive`, receive), 'บันทึกรับสินค้าและตั้งหนี้แล้ว');
        }}>
          <div className="span-2">
            <h2 style={{ margin: 0 }}>รับสินค้า / ตั้งหนี้</h2>
            <p className="muted small">บันทึกเมื่อได้รับสินค้าและใบกำกับภาษีจากผู้ขาย ระบบจะลงบัญชีเจ้าหนี้และภาษีซื้อให้อัตโนมัติ</p>
          </div>
          <label>วันที่รับสินค้า
            <input type="date" required value={receive.received_date} onChange={(e) => setReceive({ ...receive, received_date: e.target.value })} />
          </label>
          <label>เลขที่ใบกำกับภาษีของผู้ขาย
            <input value={receive.bill_no} onChange={(e) => setReceive({ ...receive, bill_no: e.target.value })} />
          </label>
          <label>บันทึกเข้าบัญชี *
            <select required value={receive.account_id} onChange={(e) => setReceive({ ...receive, account_id: e.target.value })}>
              <option value="">-- เลือกบัญชีค่าใช้จ่ายหรือสินทรัพย์ --</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
          </label>
          <label>วันครบกำหนดจ่าย (เว้นว่าง = วันรับ + เครดิต {doc.customer?.credit_days} วัน)
            <input type="date" value={receive.due_date} min={receive.received_date} onChange={(e) => setReceive({ ...receive, due_date: e.target.value })} />
          </label>
          <div className="span-2 actions">
            <button className="primary">บันทึกรับสินค้า (ยอด {money(doc.total)} บาท)</button>
          </div>
        </form>
      )}

      {(doc.status === 'received' || doc.status === 'paid') && (
        <div className="card no-print">
          <div className="card-head">
            <h2>การจ่ายชำระ</h2>
            <span className="muted small">
              บันทึกเข้า {doc.account ? `${doc.account.code} ${doc.account.name}` : '-'} · ครบกำหนด {date(doc.due_date)} · ค้างจ่าย {money(outstanding)} บาท
            </span>
          </div>
          {doc.status === 'received' && (
            <form className="form-grid" onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(() => api('POST', `/purchase-orders/${id}/payments`, { ...pay, amount: Number(pay.amount) }), 'บันทึกการจ่ายชำระแล้ว');
              if (ok) setPay({ ...pay, amount: '', note: '' });
            }}>
              <label>จำนวนเงิน (บาท)
                <input type="number" min="0.01" step="0.01" max={outstanding / 100} required value={pay.amount}
                  onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
              </label>
              <label>วันที่จ่าย<input type="date" value={pay.paid_date} onChange={(e) => setPay({ ...pay, paid_date: e.target.value })} /></label>
              <label>วิธีจ่าย
                <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                  {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label>หมายเหตุ<input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></label>
              <div className="span-2 actions">
                <button className="primary">บันทึกจ่ายชำระ</button>
                <button type="button" onClick={() => setPay({ ...pay, amount: String(outstanding / 100) })}>จ่ายเต็มจำนวน</button>
              </div>
            </form>
          )}
          <div className="table-wrap">
            <table>
              <thead><tr><th>เลขที่ใบสำคัญจ่าย</th><th>วันที่</th><th>วิธีจ่าย</th><th className="num">จำนวน (บาท)</th><th></th></tr></thead>
              <tbody>
                {doc.payments.length === 0 && <tr><td colSpan="5" className="muted">ยังไม่มีการจ่ายชำระ</td></tr>}
                {doc.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.payment_no}</td>
                    <td>{date(p.paid_date)}</td>
                    <td>{METHOD_LABEL[p.method] || p.method}</td>
                    <td className="num">{money(p.amount)}</td>
                    <td>
                      <button className="ghost danger" onClick={() => {
                        if (window.confirm('ลบรายการจ่ายชำระนี้ใช่หรือไม่? ระบบจะกลับรายการบัญชีให้')) {
                          run(() => api('DELETE', `/supplier-payments/${p.id}`), 'ลบรายการจ่ายชำระแล้ว');
                        }
                      }}>ลบ</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card toolbar no-print copy-bar">
        <span>แสดง:</span>
        {COPY_OPTIONS.map(([value, label]) => (
          <button key={value} className={copies === value ? 'primary' : ''} onClick={() => setCopies(value)}>{label}</button>
        ))}
      </div>

      {copyList(copies).map((copy) => (
        <DocumentPaper key={copy} kind="po" doc={doc} settings={settings} copy={copy} />
      ))}
    </div>
  );
}
