import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, date, STATUS_LABEL } from '../format.js';
import { CONFIG } from './docConfig.js';
import SearchBox, { matches } from '../components/SearchBox.jsx';

export default function DocumentList({ kind }) {
  const cfg = CONFIG[kind];
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const query = status ? `?status=${status}` : '';
    api('GET', `${cfg.api}${query}`).then(setRows).catch((e) => setError(e.message));
  }, [kind, status]);

  return (
    <div>
      <div className="page-head">
        <h1>{cfg.title}</h1>
        <a className="button primary" href={`#/${cfg.path}/new`}>+ สร้างใหม่</a>
      </div>

      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="ค้นหาจากเลขที่ ลูกค้า หรือยอดเงิน" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">ทุกสถานะ</option>
          {cfg.statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>เลขที่</th><th>วันที่</th><th>ลูกค้า</th><th>สถานะ</th><th className="num">ยอดสุทธิ (บาท)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan="5" className="muted">ยังไม่มีเอกสาร</td></tr>}
            {rows.length > 0 && rows.filter((row) => matches(q, [row.no, row.customer_name, row.id, money(row.total)])).length === 0 && (
              <tr><td colSpan="5" className="search-empty">ไม่พบเอกสารที่ตรงกับ "{q}"</td></tr>
            )}
            {rows.filter((row) => matches(q, [row.no, row.customer_name, row.id, money(row.total)])).map((row) => (
              <tr key={row.id}>
                <td><a href={`#/${cfg.path}/${row.id}`}>{row.no || `(ร่าง #${row.id})`}</a></td>
                <td>{date(row.issue_date)}</td>
                <td>{row.customer_name}</td>
                <td>{STATUS_LABEL[row.status]}</td>
                <td className="num">{money(row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
