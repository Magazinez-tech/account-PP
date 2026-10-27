import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import CustomersPage from './pages/CustomersPage.jsx';
import CustomerDetail from './pages/CustomerDetail.jsx';
import DocumentList from './pages/DocumentList.jsx';
import DocumentEditor from './pages/DocumentEditor.jsx';
import DocumentView from './pages/DocumentView.jsx';
import Aging from './pages/Aging.jsx';
import Journal from './pages/Journal.jsx';
import ExpenseForm from './pages/ExpenseForm.jsx';
import Accounts from './pages/Accounts.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import DocumentPdf from './pages/DocumentPdf.jsx';
import Receipts from './pages/Receipts.jsx';
import ReceiptView from './pages/ReceiptView.jsx';

// A menu entry is either a link (href) or a group with a dropdown (items).
const NAV = [
  { href: '#/dashboard', label: 'ภาพรวม' },
  { href: '#/customers', label: 'ลูกค้า' },
  {
    label: 'เอกสารขาย',
    items: [
      { href: '#/quotations', label: 'ใบเสนอราคา' },
      { href: '#/invoices', label: 'ใบกำกับภาษี' },
      { href: '#/receipts', label: 'ใบเสร็จรับเงิน' },
      { divider: true },
      { href: '#/quotations/new', label: '+ สร้างใบเสนอราคา' },
      { href: '#/invoices/new', label: '+ สร้างใบกำกับภาษี' },
    ],
  },
  {
    label: 'บัญชี',
    items: [
      { href: '#/journal', label: 'สมุดรายวันทั่วไป' },
      { href: '#/journal/expense', label: '+ บันทึกค่าใช้จ่าย' },
      { href: '#/accounts', label: 'ผังบัญชี' },
    ],
  },
  {
    label: 'รายงาน',
    items: [
      { href: '#/reports/trial', label: 'งบทดลอง' },
      { href: '#/reports/income', label: 'งบกำไรขาดทุน' },
      { href: '#/reports/balance', label: 'งบแสดงฐานะการเงิน' },
      { href: '#/reports/vat', label: 'ภาษีมูลค่าเพิ่ม (ภ.พ.30)' },
      { divider: true },
      { href: '#/aging', label: 'ลูกหนี้คงค้าง (Aging)' },
    ],
  },
];

function NavDropdown({ group, section, currentHash }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close when clicking outside the menu or after navigating.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => setOpen(false), [currentHash]);

  const active = group.items.some((item) => item.href && item.href.startsWith(`#/${section}`));

  return (
    <div className="nav-dropdown" ref={ref}>
      <button
        type="button"
        className={`nav-trigger ${active ? 'active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {group.label}
        <span className={`chevron ${open ? 'up' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="nav-menu" role="menu">
          {group.items.map((item, i) => (item.divider
            ? <div key={`d${i}`} className="nav-divider" />
            : <a key={item.href} href={item.href} role="menuitem" className="nav-item">{item.label}</a>))}
        </div>
      )}
    </div>
  );
}

function useHash() {
  const [hash, setHash] = useState(window.location.hash || '#/dashboard');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/dashboard');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#/, '');
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      onLogin(await api('POST', '/login', { email, password }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <h1>เข้าสู่ระบบ</h1>
        <label>อีเมล
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>รหัสผ่าน
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}</button>
      </form>
    </div>
  );
}

function route(hash) {
  const parts = hash.split('?')[0].split('/').filter(Boolean);
  const [section, id] = parts;
  const search = hash.split('?')[1] || '';
  if (section === 'journal' && id === 'new') return <Journal creating />;
  if (section === 'journal' && id === 'expense') return <ExpenseForm />;
  if (section === 'journal') return <Journal />;
  if (section === 'accounts') return <Accounts />;
  if (section === 'settings') return <Settings />;
  if (section === 'receipts' && id) return <ReceiptView id={id} />;
  if (section === 'receipts') return <Receipts />;
  // key=hash remounts the report when the tab or period changes, so stale data never renders.
  if (section === 'reports') return <Reports key={hash} tab={id || 'trial'} id={parts[2]} search={search} />;
  if (section === 'customers' && id) return <CustomerDetail id={id} />;
  if (section === 'customers') return <CustomersPage />;
  if ((section === 'quotations' || section === 'invoices') && id === 'new') {
    return <DocumentEditor kind={section === 'quotations' ? 'quotation' : 'invoice'} />;
  }
  if ((section === 'quotations' || section === 'invoices') && id && parts[2] === 'edit') {
    return <DocumentEditor kind={section === 'quotations' ? 'quotation' : 'invoice'} id={id} />;
  }
  if ((section === 'quotations' || section === 'invoices') && id) {
    return <DocumentView kind={section === 'quotations' ? 'quotation' : 'invoice'} id={id} />;
  }
  if (section === 'quotations') return <DocumentList kind="quotation" />;
  if (section === 'invoices') return <DocumentList kind="invoice" />;
  if (section === 'aging') return <Aging />;
  return <Dashboard />;
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const hash = useHash();

  useEffect(() => {
    api('GET', '/me').then(setUser).catch(() => setUser(null));
  }, []);

  if (user === undefined) return null;
  if (user === null) return <Login onLogin={setUser} />;

  // The PDF renderer loads this bare page; it has no menu.
  const [hashPath, hashQuery = ''] = hash.split('?');
  const pdfRoute = hashPath.match(/^\/(quotations|invoices|receipts)\/(\d+)\/pdf$/);
  if (pdfRoute) {
    const copies = new URLSearchParams(hashQuery).get('copies') || 'original';
    const kind = { quotations: 'quotation', invoices: 'invoice', receipts: 'receipt' }[pdfRoute[1]];
    return <DocumentPdf kind={kind} id={pdfRoute[2]} copies={copies} />;
  }

  async function logout() {
    await api('POST', '/logout');
    setUser(null);
  }

  const section = `#/${hash.split('/')[0]}`;
  return (
    <div className="app">
      <header className="topbar">
        <strong>ระบบบัญชี</strong>
        <nav>
          {NAV.map((item) => (item.items
            ? <NavDropdown key={item.label} group={item} section={hash.split('/')[0].split('?')[0]} currentHash={hash} />
            : <a key={item.href} href={item.href} className={section === item.href ? 'active' : ''}>{item.label}</a>))}
        </nav>
        <div className="userbox">
          <a href="#/settings" className={`company-btn ${section === '#/settings' ? 'active' : ''}`}>ข้อมูลบริษัท</a>
          <span>{user.name}</span>
          <button className="ghost" onClick={logout}>ออกจากระบบ</button>
        </div>
      </header>
      <main>{route(hash)}</main>
    </div>
  );
}
