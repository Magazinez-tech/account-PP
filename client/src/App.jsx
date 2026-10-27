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
import Receipts from './pages/Receipts.jsx';
import ReceiptView from './pages/ReceiptView.jsx';
import Suppliers, { SupplierDetail } from './pages/Suppliers.jsx';
import PoView from './pages/PoView.jsx';
import Payables from './pages/Payables.jsx';
import Users from './pages/Users.jsx';
import Account from './pages/Account.jsx';
import Products from './pages/Products.jsx';
import { can, isAdmin, SECTION_MODULE } from './permissions.js';

// A menu entry is either a link (href) or a group with a dropdown (items).
// `module` is the permission that shows the entry; `need: 'edit'` marks create links.
const NAV = [
  { href: '#/dashboard', label: 'ภาพรวม' },
  { href: '#/customers', label: 'ลูกค้า', module: 'customers' },
  { href: '#/products', label: 'สินค้า', module: 'products' },
  {
    label: 'เอกสารขาย',
    items: [
      { href: '#/quotations', label: 'ใบเสนอราคา', module: 'sales' },
      { href: '#/invoices', label: 'ใบกำกับภาษี', module: 'sales' },
      { href: '#/receipts', label: 'ใบเสร็จรับเงิน', module: 'sales' },
      { divider: true },
      { href: '#/quotations/new', label: '+ สร้างใบเสนอราคา', module: 'sales', need: 'edit' },
      { href: '#/invoices/new', label: '+ สร้างใบกำกับภาษี', module: 'sales', need: 'edit' },
    ],
  },
  {
    label: 'จัดซื้อ',
    items: [
      { href: '#/suppliers', label: 'ผู้ขาย', module: 'purchasing' },
      { href: '#/purchase-orders', label: 'ใบสั่งซื้อ (PO)', module: 'purchasing' },
      { href: '#/payables', label: 'เจ้าหนี้คงค้าง', module: 'purchasing' },
      { divider: true },
      { href: '#/purchase-orders/new', label: '+ สร้างใบสั่งซื้อ', module: 'purchasing', need: 'edit' },
    ],
  },
  {
    label: 'บัญชี',
    items: [
      { href: '#/journal', label: 'สมุดรายวันทั่วไป', module: 'accounting' },
      { href: '#/journal/expense', label: '+ บันทึกค่าใช้จ่าย', module: 'accounting', need: 'edit' },
      { href: '#/accounts', label: 'ผังบัญชี', module: 'accounting' },
    ],
  },
  {
    label: 'รายงาน',
    items: [
      { href: '#/reports/trial', label: 'งบทดลอง', module: 'reports' },
      { href: '#/reports/income', label: 'งบกำไรขาดทุน', module: 'reports' },
      { href: '#/reports/balance', label: 'งบแสดงฐานะการเงิน', module: 'reports' },
      { href: '#/reports/vat', label: 'ภาษีมูลค่าเพิ่ม (ภ.พ.30)', module: 'reports' },
      { divider: true },
      { href: '#/aging', label: 'ลูกหนี้คงค้าง (Aging)', module: 'reports' },
    ],
  },
];

// Menu filtered to what the user may open. Groups with nothing left disappear; stray dividers are dropped.
function navFor(user) {
  const allowed = (item) => can(user, item.module, item.need || 'view');
  return NAV.flatMap((entry) => {
    if (!entry.items) return allowed(entry) ? [entry] : [];
    const items = entry.items
      .filter((item) => item.divider || allowed(item))
      .filter((item, i, list) => !item.divider || (i > 0 && i < list.length - 1 && !list[i - 1].divider));
    return items.some((item) => !item.divider) ? [{ ...entry, items }] : [];
  });
}

// Pages that create or change data need edit rights; everything else needs view.
function pageNeed(parts) {
  const [section, id, sub] = parts;
  if (id === 'new' || sub === 'edit') return 'edit';
  if (section === 'journal' && (id === 'new' || id === 'expense')) return 'edit';
  return 'view';
}

function NoAccess() {
  return (
    <div className="card">
      <h1>ไม่มีสิทธิ์เข้าถึงหน้านี้</h1>
      <p className="muted">ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์</p>
      <a className="button" href="#/dashboard">กลับหน้าภาพรวม</a>
    </div>
  );
}

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

function route(hash, user) {
  const parts = hash.split('?')[0].split('/').filter(Boolean);
  const [section, id] = parts;
  const search = hash.split('?')[1] || '';
  if (section === 'users') return <Users currentUser={user} />;
  if (section === 'account') return <Account user={user} />;
  if (section === 'journal' && id === 'new') return <Journal creating />;
  if (section === 'journal' && id === 'expense') return <ExpenseForm />;
  if (section === 'journal') return <Journal />;
  if (section === 'accounts') return <Accounts />;
  if (section === 'settings') return <Settings />;
  if (section === 'receipts' && id) return <ReceiptView id={id} />;
  if (section === 'receipts') return <Receipts />;
  if (section === 'suppliers' && id) return <SupplierDetail id={id} />;
  if (section === 'suppliers') return <Suppliers />;
  if (section === 'payables') return <Payables />;
  if (section === 'purchase-orders' && id === 'new') return <DocumentEditor kind="po" />;
  if (section === 'purchase-orders' && id && parts[2] === 'edit') return <DocumentEditor kind="po" id={id} />;
  if (section === 'purchase-orders' && id) return <PoView id={id} />;
  if (section === 'purchase-orders') return <DocumentList kind="po" />;
  // key=hash remounts the report when the tab or period changes, so stale data never renders.
  if (section === 'reports') return <Reports key={hash} tab={id || 'trial'} id={parts[2]} search={search} />;
  if (section === 'products') return <Products canEdit={can(user, 'products', 'edit')} />;
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

  async function logout() {
    await api('POST', '/logout');
    setUser(null);
  }

  const section = `#/${hash.split('/')[0]}`;
  const parts = hash.split('?')[0].split('/').filter(Boolean);
  const pageModule = SECTION_MODULE[parts[0]];
  const allowedPage = parts[0] === 'users' ? isAdmin(user) : can(user, pageModule, pageNeed(parts));

  return (
    <div className="app">
      <header className="topbar">
        <strong>ระบบบัญชี</strong>
        <nav>
          {navFor(user).map((item) => (item.items
            ? <NavDropdown key={item.label} group={item} section={hash.split('/')[0].split('?')[0]} currentHash={hash} />
            : <a key={item.href} href={item.href} className={section === item.href ? 'active' : ''}>{item.label}</a>))}
        </nav>
        <div className="userbox">
          {isAdmin(user) && (
            <a href="#/users" className={`company-btn ${section === '#/users' ? 'active' : ''}`}>ผู้ใช้งาน</a>
          )}
          {can(user, 'settings') && (
            <a href="#/settings" className={`company-btn ${section === '#/settings' ? 'active' : ''}`}>ข้อมูลบริษัท</a>
          )}
          <a href="#/account" className="user-link" title="บัญชีของฉัน / เปลี่ยนรหัสผ่าน">{user.name}</a>
          <button className="ghost" onClick={logout}>ออกจากระบบ</button>
        </div>
      </header>
      <main>{allowedPage ? route(hash, user) : <NoAccess />}</main>
    </div>
  );
}
