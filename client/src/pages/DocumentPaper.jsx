import { money, date } from '../format.js';

const dash = (v) => (v ? v : '-');

// Wording that differs between a quotation and a tax invoice. The layout is shared.
const WORDING = {
  quotation: {
    title: 'ใบเสนอราคา',
    dateLabel: 'วันที่ออกใบเสนอราคา',
    dueLabel: 'วันที่ครบกำหนด',
    dueField: 'valid_until',
    left: 'ผู้สั่งซื้อสินค้า',
    right: 'ผู้อนุมัติ',
  },
  invoice: {
    title: 'ใบกำกับภาษี/ใบแจ้งหนี้',
    dateLabel: 'วันที่ออกใบกำกับภาษี',
    dueLabel: 'วันครบกำหนดชำระ',
    dueField: 'due_date',
    left: 'ผู้รับสินค้า / บริการ',
    right: 'ผู้มีอำนาจลงนาม',
  },
  po: {
    title: 'ใบสั่งซื้อ',
    dateLabel: 'วันที่สั่งซื้อ',
    dueLabel: 'วันที่ต้องการรับสินค้า',
    dueField: 'expected_date',
    partyLabel: 'ชื่อผู้ขาย',
    personLabel: 'ผู้ขอซื้อ',
    left: 'ผู้ขาย (ยืนยันการสั่งซื้อ)',
    right: 'ผู้อนุมัติการสั่งซื้อ',
  },
  receipt: {
    title: 'ใบเสร็จรับเงิน',
    dateLabel: 'วันที่รับชำระ',
    dueLabel: 'ตามใบกำกับภาษีเลขที่',
    dueField: 'invoice_no',
    dueIsDate: false,
    left: 'ผู้จ่ายเงิน',
    right: 'ผู้รับเงิน',
  },
};

const METHOD_TEXT = { cash: 'เงินสด', transfer: 'โอนเงิน', cheque: 'เช็ค', card: 'บัตรเครดิต/เดบิต' };

// A4 paper shared by quotations and tax invoices. The paper stays white in both themes.
// copy: 'original' (ต้นฉบับ) or 'copy' (สำเนา)
export default function DocumentPaper({ kind, doc, settings, copy = 'original' }) {
  const w = WORDING[kind];
  const s = settings || {};
  const c = doc.customer || {};
  const address = c.address ? [c.address, c.branch && `(${c.branch})`].filter(Boolean).join(' ') : '-';
  const isInvoice = kind === 'invoice';
  const outstanding = doc.total - (doc.paid || 0);

  return (
    <div className="paper">
      <header className="paper-head">
        <div className="paper-company">
          {s.logo
            ? <img className="paper-logo-img" src={s.logo} alt="ตราบริษัท" />
            : <div className="paper-logo" aria-hidden="true">{(s.name || '?').slice(0, 1)}</div>}
          <div className="paper-company-name">{dash(s.name)}</div>
          <div className="paper-muted">{s.address}</div>
          {s.tax_id && <div className="paper-muted">เลขประจำตัวผู้เสียภาษี: {s.tax_id}</div>}
          {s.phone && <div className="paper-muted">เบอร์: {s.phone}</div>}
          {s.email && <div className="paper-muted">อีเมล: {s.email}</div>}
          {s.website && <div className="paper-muted">เว็บไซต์: {s.website}</div>}
        </div>
        <div className="paper-title">
          <div className="paper-copy">{copy === 'copy' ? 'สำเนา' : 'ต้นฉบับ'}</div>
          <div className="paper-doc">{w.title}</div>
          <div className="paper-no">{doc.no || '(ร่าง)'}</div>
        </div>
      </header>

      <section className="paper-info">
        <dl>
          <dt>{w.partyLabel || 'ชื่อลูกค้า'}</dt><dd>{dash(c.name)}</dd>
          <dt>ชื่อบริษัท</dt><dd>{dash(c.company_name)}</dd>
          <dt>ที่อยู่</dt><dd>{address}</dd>
          <dt>เลขประจำตัวผู้เสียภาษี</dt><dd>{dash(c.tax_id)}</dd>
          <dt>เบอร์โทรศัพท์</dt><dd>{dash(c.phone)}</dd>
        </dl>
        <dl>
          <dt>{w.personLabel || 'ชื่อผู้ขาย'}</dt><dd>{dash(doc.salesperson)}</dd>
          <dt>เบอร์ติดต่อ</dt><dd>{dash(s.phone)}</dd>
          <dt>ชื่อโปรเจกต์</dt><dd>{dash(doc.project_name)}</dd>
          <dt>เลขที่อ้างอิง</dt><dd>{dash(doc.reference_no)}</dd>
          <dt>{w.dateLabel}</dt><dd>{date(doc.issue_date)}</dd>
          <dt>{w.dueLabel}</dt><dd>{w.dueIsDate === false ? dash(doc[w.dueField]) : date(doc[w.dueField])}</dd>
        </dl>
      </section>

      <table className="paper-items">
        <thead>
          <tr>
            <th className="c-no">ลำดับ</th>
            <th>รายการสินค้า</th>
            <th className="num">จำนวน</th>
            <th>หน่วย</th>
            <th className="num">ราคา/หน่วย</th>
            <th className="num">ยอดรวม</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((item, i) => (
            <tr key={item.id}>
              <td className="c-no">{i + 1}</td>
              <td className="pre">{item.description}</td>
              <td className="num">{item.qty}</td>
              <td>{item.unit}</td>
              <td className="num">{money(item.unit_price)}</td>
              <td className="num">{money(item.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="paper-bottom">
        {kind === 'po' ? (
          <div className="paper-pay">
            <div className="paper-section-title">เงื่อนไขการชำระเงิน</div>
            <div>เครดิต {c.credit_days ?? '-'} วัน นับจากวันที่รับสินค้า</div>
            {doc.bill_no && <div>ใบกำกับภาษีผู้ขายเลขที่: {doc.bill_no}</div>}
            {doc.received_date && <div>รับสินค้าวันที่: {date(doc.received_date)}</div>}
          </div>
        ) : kind === 'receipt' ? (
          <div className="paper-pay">
            <div className="paper-section-title">การรับชำระ</div>
            <div>วิธีชำระ: {METHOD_TEXT[doc.method] || dash(doc.method)}</div>
            <div>ยอดค้างของใบกำกับภาษี: {money(doc.invoice_outstanding)} บาท</div>
          </div>
        ) : (
          <div className="paper-pay">
            <div className="paper-section-title">ช่องทางการชำระเงิน</div>
            <div>ธนาคาร: {dash(s.bank_name)}</div>
            <div>เลขบัญชี: {dash(s.bank_account_no)}</div>
            <div>ชื่อบัญชี: {dash(s.bank_account_name)}</div>
          </div>
        )}
        <div className="paper-sum">
          <div><span>ยอดรวม</span><span>{money(doc.subtotal)}</span></div>
          {doc.discount > 0 && <div><span>ส่วนลด</span><span>{money(doc.discount)}</span></div>}
          <div><span>ภาษีมูลค่าเพิ่ม (7.00%)</span><span>{money(doc.vat)}</span></div>
          <div className="paper-grand"><span>{kind === 'receipt' ? 'จำนวนเงินที่รับชำระ' : 'ยอดรวมสุทธิ'}</span><span>{money(doc.total)}</span></div>
          {((isInvoice && doc.status !== 'draft') || (kind === 'po' && ['received', 'paid'].includes(doc.status))) && (
            <>
              <div><span>ชำระแล้ว</span><span>{money(doc.paid)}</span></div>
              <div className="paper-grand"><span>คงค้าง</span><span>{money(outstanding)}</span></div>
            </>
          )}
        </div>
      </section>

      {doc.note && (
        <section className="paper-note">
          <div className="paper-section-title">หมายเหตุ</div>
          <div className="pre">{doc.note}</div>
        </section>
      )}
      {kind === 'quotation' && s.quotation_terms && (
        <section className="paper-note">
          <div className="paper-section-title">เงื่อนไข</div>
          <div className="pre">{s.quotation_terms}</div>
        </section>
      )}

      <footer className="paper-sign">
        <div>
          <div className="sign-line" />
          <div>{w.left}</div>
          <div className="paper-muted">({dash(c.contact_name || c.name)})</div>
          <div className="paper-muted">วันที่ ..................................</div>
        </div>
        <div>
          <div className="sign-line" />
          <div>{w.right}</div>
          <div className="paper-muted">({dash(s.approver_name)})</div>
          <div className="paper-muted">วันที่ {date(doc.issue_date)}</div>
        </div>
      </footer>
    </div>
  );
}
