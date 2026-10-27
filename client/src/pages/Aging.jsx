import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, date } from '../format.js';
import SearchBox, { matches } from '../components/SearchBox.jsx';

const BUCKETS = [
  ['current', 'ยังไม่ถึงกำหนด'],
  ['d1_30', 'เกิน 1–30 วัน'],
  ['d31_60', 'เกิน 31–60 วัน'],
  ['d61_90', 'เกิน 61–90 วัน'],
  ['d90plus', 'เกินกว่า 90 วัน'],
];

export default function Aging() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    api('GET', '/reports/aging').then(setReport).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!report) return <p>กำลังโหลด...</p>;

  const visible = report.items.filter((row) => matches(q, [row.no, row.customer_name, row.outstanding]));

  return (
    <div>
      <div className="page-head">
        <h1>รายงานลูกหนี้คงค้าง (Aging)</h1>
        <SearchBox value={q} onChange={setQ} placeholder="ค้นหาจากเลขที่ใบกำกับภาษี หรือชื่อลูกค้า" />
      </div>
      <div className="tiles">
        {BUCKETS.map(([key, label]) => (
          <div className="card tile" key={key}>
            <div className="muted">{label}</div>
            <div className="tile-value">{money(report.buckets[key])}</div>
          </div>
        ))}
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>เลขที่</th><th>ลูกค้า</th><th>ครบกำหนด</th><th className="num">ค้างชำระ (บาท)</th><th className="num">ค้างมา (วัน)</th></tr>
          </thead>
          <tbody>
            {report.items.length === 0 && <tr><td colSpan="5" className="muted">ไม่มีลูกหนี้คงค้าง</td></tr>}
            {report.items.length > 0 && visible.length === 0 && (
              <tr><td colSpan="5" className="search-empty">ไม่พบรายการที่ตรงกับ "{q}"</td></tr>
            )}
            {visible.map((row) => (
              <tr key={row.id}>
                <td><a href={`#/invoices/${row.id}`}>{row.no}</a></td>
                <td>{row.customer_name}</td>
                <td>{date(row.due_date)}</td>
                <td className="num">{money(row.outstanding)}</td>
                <td className="num">{row.days_overdue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
