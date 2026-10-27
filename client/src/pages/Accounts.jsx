import { useEffect, useState } from 'react';
import { api } from '../api.js';
import SearchBox, { matches } from '../components/SearchBox.jsx';

const GROUPS = [
  ['asset', '1xxx สินทรัพย์'],
  ['liability', '2xxx หนี้สิน'],
  ['equity', '3xxx ส่วนของเจ้าของ'],
  ['revenue', '4xxx รายได้'],
  ['expense', '5xxx–6xxx ค่าใช้จ่าย'],
];

// Chart of accounts (ผังบัญชี), grouped by the five statement classes.
export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    api('GET', '/accounts').then(setAccounts).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">{error}</div>;

  const visible = accounts.filter((a) => matches(q, [a.code, a.name, a.sys_key]));

  return (
    <div>
      <div className="page-head">
        <h1>ผังบัญชี</h1>
        <div className="actions">
          <SearchBox value={q} onChange={setQ} placeholder="ค้นหาจากรหัสหรือชื่อบัญชี" />
          <a className="button" href="#/reports/trial">ดูงบทดลอง</a>
        </div>
      </div>
      {GROUPS.map(([type, label]) => (
        <section key={type}>
          <h2>{label}</h2>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>รหัส</th><th>ชื่อบัญชี</th><th>ด้านปกติ</th><th>ใช้โดยระบบอัตโนมัติ</th></tr></thead>
              <tbody>
                {visible.filter((a) => a.type === type).map((a) => (
                  <tr key={a.id}>
                    <td>{a.code}</td>
                    <td>
                      <a href={`#/reports/ledger/${a.id}`}>{a.name}</a>
                    </td>
                    <td>{a.normal === 'debit' ? 'เดบิต' : 'เครดิต'}</td>
                    <td className="muted">{a.sys_key ? 'ใช่' : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
