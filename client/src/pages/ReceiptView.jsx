import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { STATUS_LABEL } from '../format.js';
import DocumentPaper from './DocumentPaper.jsx';
import { COPY_OPTIONS, copyList } from './DocumentView.jsx';

// One receipt, shown as the same A4 paper as the other documents, with original / copy choice.
export default function ReceiptView({ id }) {
  const [doc, setDoc] = useState(null);
  const [settings, setSettings] = useState(null);
  const [copies, setCopies] = useState('original');
  const [pdfOpen, setPdfOpen] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function load() {
    api('GET', `/receipts/${id}`).then(setDoc).catch((e) => setError(e.message));
  }

  useEffect(load, [id]);
  useEffect(() => {
    api('GET', '/settings').then(setSettings).catch((e) => setError(e.message));
  }, []);

  // Cancelling a receipt removes the payment and reverses its journal entry, same as deleting it on the invoice.
  async function cancelReceipt() {
    if (!window.confirm('ยกเลิกใบเสร็จนี้ใช่หรือไม่? ยอดรับชำระของใบกำกับภาษีจะถูกปรับลด')) return;
    try {
      await api('DELETE', `/payments/${doc.id}`);
      window.location.hash = '#/receipts';
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && !doc) return <div className="error">{error}</div>;
  if (!doc || !settings) return <p>กำลังโหลด...</p>;

  return (
    <div>
      <div className="page-head no-print">
        <div>
          <h1>ใบเสร็จรับเงิน {doc.no}</h1>
          <span className="badge paid">{STATUS_LABEL.paid}</span>
        </div>
        <div className="actions">
          <a className="button" href={`#/invoices/${doc.invoice_id}`}>ดูใบกำกับภาษี</a>
          <button onClick={() => setPdfOpen(!pdfOpen)}>{pdfOpen ? 'กลับไปดูเอกสาร' : 'ดูตัวอย่าง PDF'}</button>
          <a className="button" href={`/api/receipts/${id}/pdf?copies=${copies}`} download>ดาวน์โหลด PDF</a>
          <button onClick={() => window.print()}>พิมพ์</button>
          <button className="ghost danger" onClick={cancelReceipt}>ยกเลิกใบเสร็จ</button>
        </div>
      </div>

      {message && <div className="success no-print">{message}</div>}
      {error && <div className="error no-print">{error}</div>}

      <div className="card toolbar no-print copy-bar">
        <span>แสดงและสร้าง PDF:</span>
        {COPY_OPTIONS.map(([value, label]) => (
          <button key={value} className={copies === value ? 'primary' : ''} onClick={() => setCopies(value)}>{label}</button>
        ))}
      </div>

      {!pdfOpen && copyList(copies).map((copy) => (
        <DocumentPaper key={copy} kind="receipt" doc={doc} settings={settings} copy={copy} />
      ))}
      {pdfOpen && (
        <div className="card pdf-preview">
          <iframe src={`/api/receipts/${id}/pdf?copies=${copies}`} title="ตัวอย่าง PDF" />
        </div>
      )}
    </div>
  );
}
