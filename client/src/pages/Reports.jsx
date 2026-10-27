import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, date } from '../format.js';
import SearchBox, { matches } from '../components/SearchBox.jsx';

const TABS = [
  { key: 'trial', label: 'งบทดลอง' },
  { key: 'income', label: 'งบกำไรขาดทุน' },
  { key: 'balance', label: 'งบแสดงฐานะการเงิน' },
  { key: 'vat', label: 'ภาษีมูลค่าเพิ่ม (ภ.พ.30)' },
  { key: 'ledger', label: 'บัญชีแยกประเภท' },
];

const yearStart = () => `${new Date().getFullYear()}-01-01`;
const todayIso = () => new Date().toISOString().slice(0, 10);

// Reports read their period from the URL (?from=&to=) so a link can be shared or bookmarked.
export default function Reports({ tab, id, search }) {
  const params = new URLSearchParams(search || '');
  const from = params.get('from') || yearStart();
  const to = params.get('to') || todayIso();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState({ from, to });
  const [q, setQ] = useState('');

  useEffect(() => { setPeriod({ from, to }); }, [from, to]);

  useEffect(() => {
    setData(null);
    setError('');
    const q = tab === 'balance' ? `?to=${to}` : `?from=${from}&to=${to}`;
    const path = tab === 'ledger' ? `/reports/ledger/${id}` : `/reports/${tab === 'balance' ? 'balance-sheet' : tab === 'trial' ? 'trial-balance' : tab === 'income' ? 'income' : 'vat'}`;
    api('GET', `${path}${q}`).then(setData).catch((e) => setError(e.message));
  }, [tab, id, from, to]);

  function apply(e) {
    e.preventDefault();
    const base = tab === 'ledger' ? `#/reports/ledger/${id}` : `#/reports/${tab}`;
    window.location.hash = `${base}?from=${period.from}&to=${period.to}`;
  }

  const showFrom = tab !== 'balance';
  const currentTab = tab === 'ledger' ? 'ledger' : tab;

  return (
    <div>
      <div className="page-head">
        <h1>รายงานทางการเงิน</h1>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <a key={t.key} href={`#/reports/${t.key}`} className={currentTab === t.key ? 'active' : ''}>{t.label}</a>
        ))}
      </div>

      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="ค้นหาจากรหัสหรือชื่อบัญชี" />
      </div>

      <form className="card toolbar" onSubmit={apply}>
        {showFrom && (
          <label>ตั้งแต่วันที่
            <input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
          </label>
        )}
        <label>ถึงวันที่
          <input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
        </label>
        <button className="primary">แสดงรายงาน</button>
      </form>

      {error && <div className="error">{error}</div>}
      {!data && !error && <p>กำลังคำนวณ...</p>}
      {data && tab === 'trial' && <TrialBalance data={data} q={q} />}
      {data && tab === 'income' && <Income data={data} q={q} />}
      {data && tab === 'balance' && <Balance data={data} q={q} />}
      {data && tab === 'vat' && <Vat data={data} />}
      {data && tab === 'ledger' && <Ledger data={data} q={q} />}
    </div>
  );
}

function TrialBalance({ data, q }) {
  const rows = data.rows.filter((r) => matches(q, [r.code, r.name]));
  return (
    <div className="card table-wrap">
      <p className="muted">ช่วงวันที่ {date(data.from)} ถึง {date(data.to)}</p>
      <table>
        <thead><tr><th>รหัส</th><th>ชื่อบัญชี</th><th className="num">เดบิต (บาท)</th><th className="num">เครดิต (บาท)</th></tr></thead>
        <tbody>
          {data.rows.length === 0 && <tr><td colSpan="4" className="muted">ยังไม่มีรายการในช่วงนี้</td></tr>}
          {data.rows.length > 0 && rows.length === 0 && <tr><td colSpan="4" className="search-empty">ไม่พบบัญชีที่ตรงกับ "{q}"</td></tr>}
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.code}</td>
              <td><a href={`#/reports/ledger/${r.id}?from=${data.from}&to=${data.to}`}>{r.name}</a></td>
              <td className="num">{r.debit ? money(r.debit) : ''}</td>
              <td className="num">{r.credit ? money(r.credit) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="total-row">
            <td colSpan="2">รวม</td>
            <td className="num">{money(data.totalDebit)}</td>
            <td className="num">{money(data.totalCredit)}</td>
          </tr>
        </tfoot>
      </table>
      <p className={data.balanced ? 'ok-text' : 'danger'}>
        {data.balanced ? 'ยอดเดบิตเท่ากับเครดิต' : 'ยอดเดบิตและเครดิตไม่เท่ากัน ตรวจสอบรายการบัญชี'}
      </p>
    </div>
  );
}

function Lines({ title, rows, total, q }) {
  const visible = rows.filter((r) => matches(q, [r.code, r.name]));
  return (
    <>
      <h2>{title}</h2>
      <div className="card table-wrap">
        <table>
          <tbody>
            {rows.length === 0 && <tr><td className="muted">ไม่มีรายการ</td><td></td></tr>}
            {rows.length > 0 && visible.length === 0 && <tr><td className="search-empty">ไม่พบบัญชีที่ตรงกับ "{q}"</td><td></td></tr>}
            {visible.map((r) => (
              <tr key={r.id}>
                <td><a href={`#/reports/ledger/${r.id}`}>{r.code} {r.name}</a></td>
                <td className="num">{money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
          {total !== undefined && (
            <tfoot><tr className="total-row"><td>รวม{title}</td><td className="num">{money(total)}</td></tr></tfoot>
          )}
        </table>
      </div>
    </>
  );
}

function Income({ data, q }) {
  return (
    <div>
      <p className="muted">ช่วงวันที่ {date(data.from)} ถึง {date(data.to)}</p>
      <Lines title="รายได้" rows={data.revenue} total={data.totalRevenue} q={q} />
      <Lines title="ค่าใช้จ่าย" rows={data.expense} total={data.totalExpense} q={q} />
      <div className={`card profit ${data.netProfit < 0 ? 'loss' : ''}`}>
        <span>{data.netProfit < 0 ? 'ขาดทุนสุทธิ' : 'กำไรสุทธิ'}</span>
        <strong>{money(Math.abs(data.netProfit))} บาท</strong>
      </div>
    </div>
  );
}

function Balance({ data, q }) {
  return (
    <div>
      <p className="muted">ณ วันที่ {date(data.to)}</p>
      <Lines title="สินทรัพย์" rows={data.assets} total={data.totalAssets} q={q} />
      <Lines title="หนี้สิน" rows={data.liabilities} total={data.totalLiabilities} q={q} />
      <Lines title="ส่วนของเจ้าของ" rows={data.equity} q={q} />
      <div className="card table-wrap">
        <table>
          <tbody>
            <tr><td>กำไร (ขาดทุน) สุทธิของงวดที่ยังไม่ปิดบัญชี</td><td className="num">{money(data.currentProfit)}</td></tr>
            <tr className="total-row"><td>รวมส่วนของเจ้าของ</td><td className="num">{money(data.totalEquity)}</td></tr>
            <tr className="total-row"><td>รวมหนี้สินและส่วนของเจ้าของ</td><td className="num">{money(data.totalLiabilities + data.totalEquity)}</td></tr>
          </tbody>
        </table>
      </div>
      <p className={data.difference === 0 ? 'ok-text' : 'danger'}>
        {data.difference === 0 ? 'สินทรัพย์เท่ากับหนี้สินบวกส่วนของเจ้าของ' : `ผลต่าง ${money(data.difference)} บาท ตรวจสอบรายการบัญชี`}
      </p>
    </div>
  );
}

function Vat({ data }) {
  return (
    <div className="card">
      <p className="muted">สรุปเพื่อใช้กรอกแบบ ภ.พ.30 ช่วงวันที่ {date(data.from)} ถึง {date(data.to)}</p>
      <div className="vat-grid">
        <div><span className="muted">ยอดขายที่ต้องเสียภาษี (สุทธิ)</span><strong>{money(data.sales)}</strong></div>
        <div><span className="muted">ภาษีขาย</span><strong>{money(data.outputVat)}</strong></div>
        <div><span className="muted">ภาษีซื้อ</span><strong>{money(data.inputVat)}</strong></div>
        <div className="grand"><span>{data.payable >= 0 ? 'ภาษีที่ต้องชำระ' : 'ภาษีที่ขอคืนหรือนำไปหักเดือนถัดไป'}</span><strong>{money(Math.abs(data.payable))}</strong></div>
      </div>
    </div>
  );
}

function Ledger({ data, q }) {
  const lines = data.lines.filter((l) => matches(q, [l.entry_no, l.description, l.memo]));
  return (
    <div>
      <h2>{data.account.code} {data.account.name}</h2>
      <p className="muted">ช่วงวันที่ {date(data.from)} ถึง {date(data.to)} · ยอดยกมา {money(data.opening)}</p>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>วันที่</th><th>เลขที่</th><th>รายการ</th><th className="num">เดบิต</th><th className="num">เครดิต</th><th className="num">คงเหลือ</th></tr></thead>
          <tbody>
            {data.lines.length === 0 && <tr><td colSpan="6" className="muted">ไม่มีการเคลื่อนไหวในช่วงนี้</td></tr>}
            {data.lines.length > 0 && lines.length === 0 && <tr><td colSpan="6" className="search-empty">ไม่พบรายการที่ตรงกับ "{q}"</td></tr>}
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{date(l.entry_date)}</td>
                <td>{l.entry_no}</td>
                <td>{l.description}</td>
                <td className="num">{l.debit ? money(l.debit) : ''}</td>
                <td className="num">{l.credit ? money(l.credit) : ''}</td>
                <td className="num">{money(l.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="total-row"><td colSpan="5">ยอดคงเหลือปลายงวด</td><td className="num">{money(data.closing)}</td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}
