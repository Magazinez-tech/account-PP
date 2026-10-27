import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, date, STATUS_LABEL } from '../format.js';
import { CustomerForm } from './CustomersPage.jsx';

export default function CustomerDetail({ id }) {
  const [customer, setCustomer] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function load() {
    api('GET', `/customers/${id}`).then(setCustomer).catch((e) => setError(e.message));
  }

  useEffect(load, [id]);

  async function save(form) {
    await api('PUT', `/customers/${id}`, form);
    setMessage('บันทึกแล้ว');
    load();
  }

  async function remove() {
    if (!window.confirm('ต้องการลบลูกค้ารายนี้ใช่หรือไม่?')) return;
    try {
      await api('DELETE', `/customers/${id}`);
      window.location.hash = '#/customers';
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!customer) return <p>กำลังโหลด...</p>;

  return (
    <div>
      <div className="page-head">
        <h1>{customer.name}</h1>
        <div className="actions">
          <a className="button" href={`#/quotations/new?customer=${id}`}>+ ใบเสนอราคา</a>
          <a className="button" href={`#/invoices/new?customer=${id}`}>+ ใบกำกับภาษี</a>
          <button className="ghost danger" onClick={remove}>ลบ</button>
        </div>
      </div>
      {message && <div className="success">{message}</div>}

      <CustomerForm initial={customer} onSaved={save} />

      <h2>ประวัติใบกำกับภาษี</h2>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>เลขที่</th><th>วันที่</th><th>สถานะ</th><th className="num">ยอดสุทธิ (บาท)</th><th className="num">ชำระแล้ว (บาท)</th></tr>
          </thead>
          <tbody>
            {customer.invoices.length === 0 && <tr><td colSpan="5" className="muted">ยังไม่มีเอกสาร</td></tr>}
            {customer.invoices.map((inv) => (
              <tr key={inv.id}>
                <td><a href={`#/invoices/${inv.id}`}>{inv.no}</a></td>
                <td>{date(inv.issue_date)}</td>
                <td>{STATUS_LABEL[inv.status]}</td>
                <td className="num">{money(inv.total)}</td>
                <td className="num">{money(inv.paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
