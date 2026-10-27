import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, date } from '../format.js';

const DAY = 86400000;
const WEEKDAYS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];

// Days from today to the due date (negative = overdue).
function daysUntil(dueDate, today) {
  return Math.round((Date.parse(dueDate) - Date.parse(today)) / DAY);
}

function dueBadge(days) {
  if (days < 0) return { label: `เกิน ${-days} วัน`, cls: 'danger' };
  if (days <= 7) return { label: days === 0 ? 'ครบวันนี้' : `อีก ${days} วัน`, cls: 'warning' };
  return { label: `อีก ${days} วัน`, cls: 'sent' };
}

// Monday-first grid for the current month. null = empty cell.
function monthCells(now) {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const cells = Array(offset).fill(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    api('GET', '/dashboard').then(setData).catch((e) => setError(e.message));
    api('GET', '/me').then(setUser).catch(() => {});
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <p>กำลังโหลด...</p>;

  const billed = data.salesThisMonth;
  const collected = data.collectedThisMonth;
  const collectedPct = billed > 0 ? Math.min(100, Math.round((collected / billed) * 100)) : 0;
  const dueDays = new Set(
    data.dueThisMonth.map((r) => Number(r.due_date.slice(8, 10))),
  );
  const todayDay = now.getDate();
  const greeting = now.getHours() < 12 ? 'สวัสดีตอนเช้า' : now.getHours() < 18 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  const monthLabel = now.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

  return (
    <div className="dash">
      {/* Left column: profile, monthly summary, quick links */}
      <div className="dash-col">
        <section className="card profile">
          <div className="avatar">{(user?.name || '?').slice(0, 1)}</div>
          <div className="muted">{greeting},</div>
          <div className="profile-name">{user?.name || ''}</div>
          <div className="clock">{now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</div>
          <div className="muted">{now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>งบบัญชี (ทุกรายการ)</h2>
            <span className={`badge ${data.accounting.balanced ? 'paid' : 'danger'}`}>
              {data.accounting.balanced ? 'สมดุล' : 'ไม่สมดุล'}
            </span>
          </div>
          <div className="mini-grid">
            <div className="mini">
              <span className="muted">เงินสดและเงินฝาก (บาท)</span>
              <strong>{money(data.accounting.cashAndBank)}</strong>
            </div>
            <div className={`mini ${data.accounting.netProfitYtd < 0 ? 'warn' : ''}`}>
              <span className="muted">กำไรสุทธิปีนี้ (บาท)</span>
              <strong>{money(data.accounting.netProfitYtd)}</strong>
            </div>
          </div>
          <div className="quick">
            <a className="button" href="#/reports/balance">งบแสดงฐานะการเงิน</a>
            <a className="button" href="#/journal/expense">+ ค่าใช้จ่าย</a>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>สรุปเดือนนี้</h2>
            <span className="muted">{monthLabel}</span>
          </div>
          <div className="mini-grid">
            <div className="mini">
              <span className="muted">ยอดขาย (บาท)</span>
              <strong>{money(data.salesThisMonth)}</strong>
            </div>
            <div className="mini">
              <span className="muted">รับชำระแล้ว (บาท)</span>
              <strong>{money(data.collectedThisMonth)}</strong>
            </div>
            <div className="mini">
              <span className="muted">ค้างชำระ (บาท)</span>
              <strong>{money(data.outstanding)}</strong>
            </div>
            <div className={`mini ${data.overdue > 0 ? 'warn' : ''}`}>
              <span className="muted">เกินกำหนด ({data.overdueCount} ใบ)</span>
              <strong>{money(data.overdue)}</strong>
            </div>
          </div>
          <div className="section-label">การเก็บเงินเดือนนี้</div>
          <div className="progress"><span style={{ width: `${collectedPct}%` }} /></div>
          <div className="progress-meta">
            <span>{collectedPct}% ของยอดขาย</span>
          </div>
        </section>

        <section className="card">
          <h2>ทางลัด</h2>
          <div className="shortcut-list">
            <a href="#/quotations/new" className="shortcut">
              <span className="tile-icon">📝</span>
              <span><strong>สร้างใบเสนอราคา</strong><span className="muted small">ร่างใหม่สำหรับลูกค้า</span></span>
            </a>
            <a href="#/invoices/new" className="shortcut">
              <span className="tile-icon">🧾</span>
              <span><strong>สร้างใบกำกับภาษี</strong><span className="muted small">ออกเอกสารให้ลูกค้า</span></span>
            </a>
            <a href="#/customers" className="shortcut">
              <span className="tile-icon">👥</span>
              <span><strong>ลูกค้า</strong><span className="muted small">จัดการรายชื่อและเครดิต</span></span>
            </a>
            <a href="#/aging" className="shortcut">
              <span className="tile-icon">📊</span>
              <span><strong>ลูกหนี้คงค้าง</strong><span className="muted small">ดูตามอายุหนี้</span></span>
            </a>
          </div>
        </section>
      </div>

      {/* Middle column: collections and due list */}
      <div className="dash-col wide">
        <section className="card">
          <div className="card-head">
            <h2>ใบที่ต้องติดตาม</h2>
            <a className="button small-btn" href="#/invoices">ดูใบกำกับภาษีทั้งหมด</a>
          </div>
          {data.upcoming.length === 0 && <p className="muted">ไม่มีใบค้างชำระ</p>}
          <div className="due-list">
            {data.upcoming.map((row) => {
              const badge = dueBadge(daysUntil(row.due_date, data.today));
              const outstanding = row.total - row.paid;
              return (
                <a key={row.id} href={`#/invoices/${row.id}`} className="due-row">
                  <div className="due-main">
                    <strong>{row.customer_name}</strong>
                    <span className="muted small">{row.no} · ครบกำหนด {date(row.due_date)}</span>
                  </div>
                  <span className={`badge ${badge.cls}`}>{badge.label}</span>
                  <span className="num due-amount">{money(outstanding)}</span>
                </a>
              );
            })}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>สถานะใบเสนอราคา</h2>
          </div>
          <div className="mini-grid">
            <div className="mini">
              <span className="muted">ที่ยังไม่ปิดการขาย (ร่างและส่งแล้ว)</span>
              <strong>{data.openQuotations}</strong>
            </div>
          </div>
          <div className="quick">
            <a className="button primary" href="#/quotations/new">+ ใบเสนอราคา</a>
            <a className="button" href="#/quotations">ดูรายการทั้งหมด</a>
          </div>
        </section>
      </div>

      {/* Right column: notifications and calendar */}
      <div className="dash-col">
        <section className="card alert-card">
          <div>
            <div className="muted small">ต้องดำเนินการ</div>
            <div className="alert-count">{data.overdueCount + data.openQuotations}</div>
          </div>
          <div className="muted small">
            {data.overdueCount} ใบเกินกำหนด<br />
            {data.openQuotations} ใบเสนอราคารอปิด
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>ปฏิทินวันครบกำหนด</h2>
            <span className="muted small">{monthLabel}</span>
          </div>
          <div className="cal">
            {WEEKDAYS.map((w) => <div key={w} className="cal-head">{w}</div>)}
            {monthCells(now).map((day, i) => (
              <div
                key={i}
                className={`cal-day ${day === null ? 'empty' : ''} ${day === todayDay ? 'today' : ''}`}
              >
                {day}
                {day !== null && dueDays.has(day) && <span className="dot" />}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
