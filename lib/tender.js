// Tender builder — match drawing take-off rows to the QS's BQ lines, then
// tabulate the tender. CanLah supplies the QUANTITY; the QS supplies the RATE;
// tender = quantity x rate.
//
// Matching is SUGGEST-then-approve: suggestMatches() proposes a best-guess BQ
// line per take-off row by description/unit similarity. The QS approves or
// re-links — the AI only suggests the pairing, never the rate or the quantity.
//
// Shapes:
//   takeoffRow: { id, description, unit, qty }
//   bqLine:     { ref, description, unit, rate }
//   mappings:   { [takeoffRowId]: bqRef }   // which BQ line each take-off row feeds

// Tokenise a description: lowercase, keep words of length >2 OR containing a
// digit (so girth bands like "1m"/"2m" survive — they're the discriminator).
function tokens(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2 || /\d/.test(w));
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function unitsMatch(a, b) {
  return a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * Suggest a BQ line for each take-off row.
 * Returns [{ takeoffId, suggestedRef, score, confidence }].
 * suggestedRef is null when nothing clears the floor (QS links manually).
 */
export function suggestMatches(takeoffRows = [], bqLines = []) {
  return takeoffRows.map((tr) => {
    const tt = tokens(tr.description);
    let best = null, bestScore = 0;
    for (const bl of bqLines) {
      let score = jaccard(tt, tokens(bl.description));
      if (unitsMatch(tr.unit, bl.unit)) score += 0.15; // unit agreement nudges
      if (score > bestScore) { bestScore = score; best = bl; }
    }
    const suggestedRef = bestScore >= 0.15 && best ? best.ref : null;
    const confidence = bestScore >= 0.5 ? 'high' : bestScore >= 0.25 ? 'medium' : 'low';
    return { takeoffId: tr.id, suggestedRef, score: Number(bestScore.toFixed(3)), confidence };
  });
}

/** Turn suggestMatches() output into a mappings object (only confident enough links). */
export function suggestionsToMappings(suggestions) {
  const m = {};
  for (const s of suggestions) if (s.suggestedRef) m[s.takeoffId] = s.suggestedRef;
  return m;
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Build the tender from approved mappings.
 * opts: { takeoffRows, bqLines, mappings, markupPct = 0 }
 * Returns { rows, subtotal, markupPct, markupAmount, total, unmatchedTakeoff, warnings }.
 * Tender is structured BY BQ line (the deliverable shape).
 */
export function buildTender({ takeoffRows = [], bqLines = [], mappings = {}, markupPct = 0 } = {}) {
  const warnings = [];
  // Coerce markup so a non-numeric value can't silently turn the whole tender
  // total into NaN. Anything not finite falls back to 0% (no markup).
  const mk = Number.isFinite(Number(markupPct)) ? Number(markupPct) : 0;
  if (mk !== Number(markupPct) && markupPct !== 0 && markupPct != null && markupPct !== '') {
    warnings.push(`Ignored non-numeric markup "${markupPct}" — applied 0%`);
  }
  const byRef = new Map(bqLines.map((b) => [b.ref, b]));

  const rows = bqLines.map((bl) => {
    const attached = takeoffRows.filter((tr) => mappings[tr.id] === bl.ref);
    const qty = round2(attached.reduce((s, tr) => s + (Number(tr.qty) || 0), 0));
    const hasRate = bl.rate != null && Number.isFinite(bl.rate);
    const amount = hasRate ? round2(qty * bl.rate) : null;
    const unitMismatch = attached.some((tr) => tr.unit && bl.unit && !unitsMatch(tr.unit, bl.unit));
    if (unitMismatch) warnings.push(`Unit mismatch on ${bl.ref}: take-off unit differs from BQ unit "${bl.unit}" — review before trusting the quantity`);
    if (qty > 0 && !hasRate) warnings.push(`BQ line ${bl.ref} has quantity ${qty} but no rate — QS must price it`);
    return {
      ref: bl.ref,
      description: bl.description,
      unit: bl.unit,
      qty,
      rate: hasRate ? bl.rate : null,
      amount,
      attachedIds: attached.map((tr) => tr.id),
      unitMismatch,
      unmatched: qty === 0, // BQ line with no take-off rows
    };
  });

  // Take-off rows that aren't mapped to a real BQ line.
  const unmatchedTakeoff = takeoffRows.filter((tr) => !mappings[tr.id] || !byRef.has(mappings[tr.id]));
  if (unmatchedTakeoff.length) warnings.push(`${unmatchedTakeoff.length} take-off row(s) not linked to a BQ line — they won't appear in the tender`);

  const subtotal = round2(rows.reduce((s, r) => s + (r.amount || 0), 0));
  const markupAmount = round2(subtotal * mk / 100);
  const total = round2(subtotal + markupAmount);

  return { rows, subtotal, markupPct: mk, markupAmount, total, unmatchedTakeoff, warnings };
}

/** Export the tender as CSV (Ref, Description, Unit, Qty, Rate, Amount + totals). */
export function tenderToCsv(tender, projectName = 'Tender') {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out = [['Ref', 'Description', 'Unit', 'Qty', 'Rate', 'Amount']];
  for (const r of tender.rows) out.push([r.ref, r.description, r.unit, r.qty, r.rate ?? '', r.amount ?? '']);
  out.push([]);
  out.push(['', '', '', '', 'Subtotal', tender.subtotal]);
  out.push(['', '', '', '', `Markup ${tender.markupPct}%`, tender.markupAmount]);
  out.push(['', '', '', '', 'Total', tender.total]);
  return out.map((row) => row.map(esc).join(',')).join('\n');
}
