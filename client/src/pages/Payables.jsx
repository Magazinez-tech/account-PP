import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, date } from '../format.js';
import SearchBox, { matches } from '../components/SearchBox.jsx';

// Outstanding supplier bills (เจ้าหนี้คงค้าง), earliest due first.
export default function Payables() {
  const [report, setReport] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api('GET', '/reports/payables').then(setReport).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!report) return <p>กำลังโหลด...</p>;

  const todayIso = new Date().toISOString().slice(0, 10);
  const visible = report.items.filter((r) => matches(q, [r.no, r.bill_no, r.supplier_name]));

  return (
    <div>
      <div className="page-head">
        <h1>เจ้าหนี้คงค้าง</h1>
        <SearchBox value={q} onChange={setQ} placeholder="ค้นหาจากเลขที่ PO ใบกำกับผู้ขาย หรือชื่อผู้ขาย" />
      </div>
      <div className="tiles">
        <div className="card tile">
          <div className="muted">ยอดค้างจ่ายทั้งหมด (บาท)</div>
          <div className="tile-value">{money(report.total)}</div>
        </div>
        <div className={`card tile ${report.items.some((r) => r.due_date < todayIso) ? 'warn' : ''}`}>
          <div className="muted">เกินกำหนดจ่าย (บาท)</div>
          <div className="tile-value">{money(report.items.filter((r) => r.due_date < todayIso).reduce((s, r) => s + r.outstanding, 0))}</div>
        </div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>ใบสั่งซื้อ</th><th>ผู้ขาย</th><th>ใบกำกับผู้ขาย</th><th>ครบกำหนด</th><th className="num">ค้างจ่าย (บาท)</th></tr>
          </thead>
          <tbody>
            {report.items.length === 0 && <tr><td colSpan="5" className="muted">ไม่มีเจ้าหนี้คงค้าง</td></tr>}
            {report.items.length > 0 && visible.length === 0 && <tr><td colSpan="5" className="search-empty">ไม่พบรายการที่ตรงกับ "{q}"</td></tr>}
            {visible.map((r) => (
              <tr key={r.id}>
                <td><a href={`#/purchase-orders/${r.id}`}>{r.no}</a></td>
                <td>{r.supplier_name}</td>
                <td>{r.bill_no || '-'}</td>
                <td className={r.due_date < todayIso ? 'danger' : ''}>{date(r.due_date)}</td>
                <td className="num">{money(r.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
