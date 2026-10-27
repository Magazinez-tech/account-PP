import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, date, STATUS_LABEL } from '../format.js';
import { CustomerForm } from './CustomersPage.jsx';
import SearchBox from '../components/SearchBox.jsx';

// Supplier list (ผู้ขาย). Same fields as customers; the form is shared.
export default function Suppliers() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function load(query = q) {
    api('GET', `/suppliers?q=${encodeURIComponent(query)}`).then(setRows).catch((e) => setError(e.message));
  }

  useEffect(() => { load(''); }, []);

  async function create(form) {
    await api('POST', '/suppliers', form);
    setAdding(false);
    setMessage(`เพิ่มผู้ขาย "${form.name}" แล้ว`);
    setQ('');
    load('');
  }

  return (
    <div>
      <div className="page-head">
        <h1>ผู้ขาย</h1>
        <button className="primary" onClick={() => { setAdding(!adding); setMessage(''); }}>{adding ? 'ปิดฟอร์ม' : '+ เพิ่มผู้ขาย'}</button>
      </div>

      {message && <div className="success">{message}</div>}
      {adding && <CustomerForm onSaved={create} nameLabel="ชื่อผู้ขาย" />}

      <div className="toolbar">
        <SearchBox value={q} onChange={(v) => { setQ(v); load(v); }} placeholder="ค้นหาจากชื่อ บริษัท เลขผู้เสียภาษี หรือเบอร์โทร" />
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>ชื่อ</th><th>บริษัท</th><th>เลขผู้เสียภาษี</th><th>โทรศัพท์</th><th className="num">เครดิต (วัน)</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan="5" className="muted">ยังไม่มีข้อมูลผู้ขาย</td></tr>}
            {rows.map((s) => (
              <tr key={s.id}>
                <td><a href={`#/suppliers/${s.id}`}>{s.name}</a></td>
                <td>{s.company_name || '-'}</td>
                <td>{s.tax_id || '-'}</td>
                <td>{s.phone || '-'}</td>
                <td className="num">{s.credit_days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SupplierDetail({ id }) {
  const [supplier, setSupplier] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function load() {
    api('GET', `/suppliers/${id}`).then(setSupplier).catch((e) => setError(e.message));
  }

  useEffect(load, [id]);

  async function save(form) {
    await api('PUT', `/suppliers/${id}`, form);
    setMessage('บันทึกแล้ว');
    load();
  }

  async function remove() {
    if (!window.confirm('ต้องการลบผู้ขายรายนี้ใช่หรือไม่?')) return;
    try {
      await api('DELETE', `/suppliers/${id}`);
      window.location.hash = '#/suppliers';
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && !supplier) return <div className="error">{error}</div>;
  if (!supplier) return <p>กำลังโหลด...</p>;

  return (
    <div>
      <div className="page-head">
        <h1>{supplier.name}</h1>
        <div className="actions">
          <a className="button" href={`#/purchase-orders/new?customer=${id}`}>+ ใบสั่งซื้อ</a>
          <button className="ghost danger" onClick={remove}>ลบ</button>
        </div>
      </div>
      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}

      <CustomerForm initial={supplier} onSaved={save} nameLabel="ชื่อผู้ขาย" />

      <h2>ประวัติใบสั่งซื้อ</h2>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>เลขที่</th><th>วันที่</th><th>สถานะ</th><th className="num">ยอดสุทธิ (บาท)</th><th className="num">จ่ายแล้ว (บาท)</th></tr>
          </thead>
          <tbody>
            {supplier.orders.length === 0 && <tr><td colSpan="5" className="muted">ยังไม่มีใบสั่งซื้อ</td></tr>}
            {supplier.orders.map((po) => (
              <tr key={po.id}>
                <td><a href={`#/purchase-orders/${po.id}`}>{po.no}</a></td>
                <td>{date(po.issue_date)}</td>
                <td>{STATUS_LABEL[po.status]}</td>
                <td className="num">{money(po.total)}</td>
                <td className="num">{money(po.paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
