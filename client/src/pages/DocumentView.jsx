import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, date, STATUS_LABEL, METHOD_LABEL } from '../format.js';
import { CONFIG } from './docConfig.js';
import DocumentPaper from './DocumentPaper.jsx';

const TITLE = { quotation: 'ใบเสนอราคา', invoice: 'ใบกำกับภาษี / ใบแจ้งหนี้' };

export const COPY_OPTIONS = [
  ['original', 'ต้นฉบับ'],
  ['copy', 'สำเนา'],
  ['both', 'ต้นฉบับและสำเนา'],
];

// Which paper copies to show: 'both' gives the original followed by the copy.
export function copyList(copies) {
  return copies === 'both' ? ['original', 'copy'] : [copies];
}


export default function DocumentView({ kind, id }) {
  const cfg = CONFIG[kind];
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editingDue, setEditingDue] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [pay, setPay] = useState({ amount: '', paid_date: new Date().toISOString().slice(0, 10), method: 'transfer', note: '' });

  function load() {
    api('GET', `${cfg.api}/${id}`).then(setDoc).catch((e) => setError(e.message));
  }

  const [settings, setSettings] = useState(null);
  const [copies, setCopies] = useState('original');

  useEffect(load, [kind, id]);
  useEffect(() => {
    api('GET', '/settings').then(setSettings).catch((e) => setError(e.message));
  }, []);

  // Runs an action and reloads; shows the error message on failure.
  async function run(fn, okMessage) {
    setError('');
    setMessage('');
    try {
      const result = await fn();
      if (okMessage) setMessage(okMessage);
      load();
      return result;
    } catch (e) {
      setError(e.message);
    }
  }

  async function convert() {
    const result = await run(() => api('POST', `/quotations/${id}/convert`), 'แปลงเป็นใบกำกับภาษี (ร่าง) แล้ว');
    if (result) window.location.hash = `#/invoices/${result.id}`;
  }

  async function remove() {
    if (!window.confirm('ลบร่างนี้ใช่หรือไม่?')) return;
    try {
      await api('DELETE', `${cfg.api}/${id}`);
      window.location.hash = `#/${cfg.path}`;
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && !doc) return <div className="error">{error}</div>;
  if (!doc) return <p>กำลังโหลด...</p>;

  const isDraft = doc.status === 'draft';
  const outstanding = kind === 'invoice' ? doc.total - doc.paid : 0;

  return (
    <div>
      <div className="page-head no-print">
        <div>
          <h1>{TITLE[kind]} {doc.no || '(ร่าง)'}</h1>
          <span className={`badge ${doc.status}`}>{STATUS_LABEL[doc.status]}</span>
        </div>
        <div className="actions">
          {isDraft && <a className="button" href={`#/${cfg.path}/${id}/edit`}>แก้ไข</a>}
          {kind === 'quotation' && !doc.invoice_id && (
            <button className="primary" onClick={convert}>แปลงเป็นใบกำกับภาษี</button>
          )}
          {kind === 'quotation' && doc.invoice_id && (
            <a className="button" href={`#/invoices/${doc.invoice_id}`}>ดูใบกำกับภาษี</a>
          )}
          {kind === 'invoice' && isDraft && (
            <button className="primary" onClick={() => {
              if (window.confirm('ออกเลขที่ใบกำกับภาษีแล้ว จะแก้ไขไม่ได้อีก ยืนยันหรือไม่?')) {
                run(() => api('POST', `/invoices/${id}/issue`), 'ออกใบกำกับภาษีแล้ว');
              }
            }}>ออกเอกสาร</button>
          )}
          {isDraft && <button className="ghost danger" onClick={remove}>ลบร่าง</button>}
          {kind === 'invoice' && !isDraft && doc.status !== 'cancelled' && doc.paid === 0 && (
            <button className="ghost danger" onClick={() => {
              if (window.confirm('ยกเลิกใบกำกับภาษีนี้ใช่หรือไม่? เลขที่เดิมจะยังคงอยู่ในระบบ')) {
                run(() => api('POST', `/invoices/${id}/cancel`), 'ยกเลิกแล้ว');
              }
            }}>ยกเลิกเอกสาร</button>
          )}
          <button className="primary" onClick={() => window.print()}>พิมพ์ / บันทึกเป็น PDF</button>
        </div>
      </div>

      {message && <div className="success no-print">{message}</div>}
      {error && <div className="error no-print">{error}</div>}

      {kind === 'quotation' && isDraft === false && (
        <div className="card toolbar no-print">
          <span>เปลี่ยนสถานะ:</span>
          {['sent', 'accepted', 'rejected'].map((s) => (
            <button key={s} className={doc.status === s ? 'primary' : ''}
              onClick={() => run(() => api('PATCH', `/quotations/${id}/status`, { status: s }), 'อัปเดตสถานะแล้ว')}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}
      {kind === 'quotation' && isDraft && (
        <div className="card toolbar no-print">
          <button onClick={() => run(() => api('PATCH', `/quotations/${id}/status`, { status: 'sent' }), 'บันทึกว่าส่งให้ลูกค้าแล้ว')}>
            ทำเครื่องหมายว่าส่งให้ลูกค้าแล้ว
          </button>
        </div>
      )}

      <div className="card toolbar no-print copy-bar">
        <span>แสดง:</span>
        {COPY_OPTIONS.map(([value, label]) => (
          <button key={value} className={copies === value ? 'primary' : ''} onClick={() => setCopies(value)}>{label}</button>
        ))}
      </div>
      {copyList(copies).map((copy) => (
        <DocumentPaper key={copy} kind={kind} doc={doc} settings={settings} copy={copy} />
      ))}

      {kind === 'invoice' && (doc.status === 'issued' || doc.status === 'paid') && (
        <>
          <h2 className="no-print">รับชำระเงิน</h2>
          {doc.status === 'issued' && (
            <form className="card form-grid no-print" onSubmit={(e) => {
              e.preventDefault();
              run(() => api('POST', `/invoices/${id}/payments`, { ...pay, amount: Number(pay.amount) }), 'บันทึกการรับชำระแล้ว')
                .then(() => setPay({ ...pay, amount: '', note: '' }));
            }}>
              <label>จำนวนเงิน (บาท)
                <input type="number" min="0.01" step="0.01" max={outstanding / 100} required value={pay.amount}
                  onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
              </label>
              <label>วันที่รับเงิน<input type="date" value={pay.paid_date} onChange={(e) => setPay({ ...pay, paid_date: e.target.value })} /></label>
              <label>วิธีชำระ
                <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                  {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label>หมายเหตุ<input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></label>
              <div className="span-2 actions">
                <button className="primary">บันทึกรับชำระ (ยอดค้าง {money(outstanding)})</button>
              </div>
            </form>
          )}
          <div className="card table-wrap">
            <table>
              <thead>
                <tr><th>เลขที่ใบเสร็จ</th><th>วันที่</th><th>วิธีชำระ</th><th className="num">จำนวน (บาท)</th><th></th></tr>
              </thead>
              <tbody>
                {doc.payments.length === 0 && <tr><td colSpan="5" className="muted">ยังไม่มีการรับชำระ</td></tr>}
                {doc.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.receipt_no}</td>
                    <td>{date(p.paid_date)}</td>
                    <td>{METHOD_LABEL[p.method] || p.method}</td>
                    <td className="num">{money(p.amount)}</td>
                    <td className="no-print">
                      <button className="ghost danger" onClick={() => {
                        if (window.confirm('ลบรายการรับชำระนี้ใช่หรือไม่?')) {
                          run(() => api('DELETE', `/payments/${p.id}`), 'ลบรายการรับชำระแล้ว');
                        }
                      }}>ลบ</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
