// Parse a Quantity Surveyor's BQ from CSV into structured line items.
//
// The QS owns the rates, so we ingest their BQ as structured CSV (exported from
// Excel / their costing tool) — never AI-extracted — so a rate is never
// hallucinated. Column headers vary between firms, so we map flexibly.
// A BQ line: { ref, description, unit, rate }.  rate is null for section
// headers / un-priced rows (kept, but they don't contribute to a tender).

// Header synonyms -> canonical field. Matched case-insensitively, trimmed.
const HEADER_MAP = {
  ref: ['ref', 'item', 'code', 'item no', 'item no.', 'item ref', 'no', 'no.', 'item code', 'bq ref'],
  description: ['description', 'desc', 'item description', 'particulars', 'work', 'work description', 'details'],
  unit: ['unit', 'uom', 'units', 'u/m', 'u', 'measure'],
  rate: ['rate', 'unit rate', 'price', 'unit price', 'rate ($)', 'rate $', '$', 'rate sgd'],
  qty: ['qty', 'quantity', 'quantities', 'count', 'qty take-off', 'takeoff qty', 'measured qty'],
};

// Minimal RFC-4180-ish CSV reader: handles quoted fields, escaped quotes, commas
// and newlines inside quotes, and \r\n.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQ = false; }
      } else field += c;
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Parse a money/quantity cell: strip currency symbols, thousands commas, spaces.
export function parseNumber(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function mapHeaders(headerRow) {
  const norm = headerRow.map((h) => String(h || '').trim().toLowerCase());
  const cols = {};
  for (const [field, synonyms] of Object.entries(HEADER_MAP)) {
    cols[field] = norm.findIndex((h) => synonyms.includes(h));
  }
  return cols;
}

/**
 * Parse BQ CSV text -> { lines, warnings, columns }.
 * Requires at least a description column. ref/unit/rate are optional.
 */
export function parseBqCsv(text) {
  const warnings = [];
  const rows = parseCsv(text).filter((r) => r.some((c) => String(c).trim() !== ''));
  if (rows.length === 0) return { lines: [], warnings: ['Empty CSV'], columns: {} };

  const cols = mapHeaders(rows[0]);
  if (cols.description < 0) {
    return { lines: [], warnings: ['No "description" column found — header row must include a description/desc/particulars column'], columns: cols };
  }
  if (cols.rate < 0) warnings.push('No "rate" column found — lines will have no rate (tender cannot price them)');

  const at = (row, idx) => (idx >= 0 && idx < row.length ? String(row[idx]).trim() : '');
  const lines = [];
  let autoRef = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const description = at(row, cols.description);
    if (!description) continue; // skip blank-description rows
    const ref = at(row, cols.ref) || `L${++autoRef}`;
    const unit = at(row, cols.unit) || '';
    const rate = cols.rate >= 0 ? parseNumber(at(row, cols.rate)) : null;
    const qty = cols.qty >= 0 ? parseNumber(at(row, cols.qty)) : null;
    lines.push({ ref, description, unit, rate, qty });
  }
  if (lines.length === 0) warnings.push('No data rows found below the header');
  // Duplicate refs would break matching — disambiguate.
  const seen = new Map();
  for (const l of lines) {
    if (seen.has(l.ref)) { const n = seen.get(l.ref) + 1; seen.set(l.ref, n); l.ref = `${l.ref}-${n}`; }
    else seen.set(l.ref, 1);
  }
  return { lines, warnings, columns: cols };
}
