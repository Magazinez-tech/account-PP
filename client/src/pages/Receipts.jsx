import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, date, METHOD_LABEL } from '../format.js';
import SearchBox, { matches } from '../components/SearchBox.jsx';

// Receipt list. Each payment received against a tax invoice has one receipt.
export default function Receipts() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api('GET', '/receipts').then(setRows).catch((e) => setError(e.message));
  }, []);

  const visible = rows.filter((r) => matches(q, [r.receipt_no, r.invoice_no, r.customer_name, money(r.amount)]));

  return (
    <div>
      <div className="page-head">
        <h1>ใบเสร็จรับเงิน</h1>
        <SearchBox value={q} onChange={setQ} placeholder="ค้นหาจากเลขที่ใบเสร็จ ใบกำกับภาษี หรือชื่อลูกค้า" />
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>เลขที่ใบเสร็จ</th><th>วันที่รับชำระ</th><th>ลูกค้า</th><th>ใบกำกับภาษี</th><th>วิธีชำระ</th><th className="num">จำนวนเงิน (บาท)</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan="6" className="muted">ยังไม่มีใบเสร็จรับเงิน (ออกจากการรับชำระในใบกำกับภาษี)</td></tr>}
            {rows.length > 0 && visible.length === 0 && <tr><td colSpan="6" className="search-empty">ไม่พบใบเสร็จที่ตรงกับ "{q}"</td></tr>}
            {visible.map((r) => (
              <tr key={r.id}>
                <td><a href={`#/receipts/${r.id}`}>{r.receipt_no}</a></td>
                <td>{date(r.paid_date)}</td>
                <td>{r.customer_name}</td>
                <td><a href={`#/invoices/${r.invoice_id}`}>{r.invoice_no}</a></td>
                <td>{METHOD_LABEL[r.method] || r.method}</td>
                <td className="num">{money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
