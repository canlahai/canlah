// BQ → durations: turn measured Bill of Quantities items into estimated activity
// durations using benchmark productivity rates (output per working day for a
// typical SG crew). Deterministic + transparent — NOT an AI guess — so the
// numbers are defensible and tunable. Browser- and Node-safe (no imports).

// Output per working day, keyed by trade then normalised unit.
export const RATES = {
  excavation: { m3: 150 },
  piling: { no: 4, m: 60 },
  concrete: { m3: 40 },
  formwork: { m2: 120 },
  rebar: { tonne: 2.5, kg: 2500 },
  blockwork: { m2: 35 },
  brickwork: { m2: 25 },
  plaster: { m2: 60 },
  screed: { m2: 80 },
  tiling: { m2: 30 },
  painting: { m2: 150 },
  waterproofing: { m2: 80 },
  roofing: { m2: 60 },
  ceiling: { m2: 60 },
  doors: { no: 8 },
  windows: { no: 8 },
  mechanical: { point: 20, no: 20, m2: 200 },
  electrical: { point: 25, no: 25, m2: 200 },
  plumbing: { point: 18, no: 18, m2: 200 },
  external: { m2: 100, m3: 120 },
  other: {},
};

// Last-resort rate by unit when the trade has no specific rate for that unit.
const UNIT_FALLBACK = { m2: 100, m3: 40, m: 50, tonne: 2, kg: 2000, no: 8, point: 20 };

export function normUnit(u) {
  u = String(u || '').toLowerCase().replace(/[\s.]/g, '');
  if (['m²', 'm2', 'sqm', 'sm', 'squaremetre', 'squaremeter'].includes(u)) return 'm2';
  if (['m³', 'm3', 'cum', 'cubicm', 'cubicmetre'].includes(u)) return 'm3';
  if (['t', 'ton', 'tonne', 'tonnes', 'mt'].includes(u)) return 'tonne';
  if (['kg', 'kgs'].includes(u)) return 'kg';
  if (['no', 'nr', 'nos', 'each', 'ea', 'unit', 'units', 'pcs', 'pc'].includes(u)) return 'no';
  if (['pt', 'point', 'points', 'pts'].includes(u)) return 'point';
  if (['m', 'lm', 'rm', 'meter', 'metre', 'm1'].includes(u)) return 'm';
  return u;
}

/** Estimated duration (working days) for one BQ item, or null if not estimable. */
export function estimateDurationDays(item) {
  const trade = String((item && item.trade) || 'other').toLowerCase();
  const qty = Number(item && item.quantity);
  if (!isFinite(qty) || qty <= 0) return null;
  const unit = normUnit(item && item.unit);
  const rate = (RATES[trade] && RATES[trade][unit]) || UNIT_FALLBACK[unit];
  if (!rate) return null;
  return Math.min(180, Math.max(1, Math.ceil(qty / rate)));
}

const PHASE = {
  excavation: 'Substructure', piling: 'Substructure',
  concrete: 'Superstructure', formwork: 'Superstructure', rebar: 'Superstructure',
  blockwork: 'Architectural', brickwork: 'Architectural', plaster: 'Architectural',
  screed: 'Architectural', tiling: 'Architectural', painting: 'Architectural',
  waterproofing: 'Architectural', roofing: 'Architectural', ceiling: 'Architectural',
  doors: 'Architectural', windows: 'Architectural',
  mechanical: 'M&E', electrical: 'M&E', plumbing: 'M&E',
  external: 'External works', other: 'Other',
};

// Build-sequence order for sequencing the draft programme.
export const TRADE_ORDER = [
  'excavation', 'piling', 'concrete', 'formwork', 'rebar', 'blockwork', 'brickwork',
  'plaster', 'screed', 'tiling', 'waterproofing', 'roofing', 'ceiling', 'doors',
  'windows', 'painting', 'mechanical', 'electrical', 'plumbing', 'external', 'other',
];

/**
 * Turn extracted BQ items into a sequenced draft programme: each estimable item
 * becomes an activity ordered by build sequence, chained finish-to-start.
 * Returns { activities, skipped } (skipped = items we couldn't estimate).
 */
export function bqToActivities(items) {
  const ord = (t) => { const i = TRADE_ORDER.indexOf(t); return i === -1 ? 999 : i; };
  const est = (items || []).map((it) => ({
    description: it.description || it.trade || 'Work item',
    trade: String(it.trade || 'other').toLowerCase(),
    durationDays: estimateDurationDays(it),
  }));
  const ok = est.filter((it) => it.durationDays);
  const skipped = est.length - ok.length;
  ok.sort((a, b) => ord(a.trade) - ord(b.trade));
  const activities = ok.map((it, i) => ({
    id: 'a' + (i + 1),
    name: it.description,
    trade: it.trade,
    section: PHASE[it.trade] || 'Other',
    durationDays: it.durationDays,
    predecessors: i > 0 ? ['a' + i] : [],
  }));
  return { activities, skipped };
}
