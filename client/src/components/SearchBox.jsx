// Shared search input for list pages. Filtering is done by the page using the returned value.
export default function SearchBox({ value, onChange, placeholder = 'ค้นหา...' }) {
  return (
    <div className="search-box">
      <span className="search-icon" aria-hidden="true">⌕</span>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
    </div>
  );
}

// True when every word in the query appears somewhere in the given fields.
export function matches(query, fields) {
  const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.map((f) => String(f ?? '')).join(' ').toLowerCase();
  return words.every((w) => haystack.includes(w));
}
