import { useEffect, useState } from 'react';
import { api } from '../api.js';
import DocumentPaper from './DocumentPaper.jsx';

// Bare page used only by the server to render the PDF. No menu, no buttons.
// #pdf-ready appears once the data is loaded so the renderer knows when to capture.
// copies: 'original' | 'copy' | 'both' (both = original page followed by the copy page).
export default function DocumentPdf({ kind, id, copies = 'original' }) {
  const [doc, setDoc] = useState(null);
  const [settings, setSettings] = useState(null);
  const path = { invoice: 'invoices', receipt: 'receipts' }[kind] || 'quotations';
  const list = copies === 'both' ? ['original', 'copy'] : [copies];

  useEffect(() => {
    Promise.all([api('GET', `/${path}/${id}`), api('GET', '/settings')])
      .then(([d, s]) => { setDoc(d); setSettings(s); })
      .catch(() => {});
  }, [path, id]);

  if (!doc || !settings) return null;
  return (
    <div id="pdf-ready" className="pdf-only">
      {list.map((copy) => (
        <DocumentPaper key={copy} kind={kind} doc={doc} settings={settings} copy={copy} />
      ))}
    </div>
  );
}
