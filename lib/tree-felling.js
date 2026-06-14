// Deterministic NParks tree-felling classification for the BQ Reader.
//
// Girth-band classification, protected/heritage flagging, and replacement-
// planting counts are lookups + arithmetic, not judgement — so they shouldn't
// be left to the AI prompt. The model extracts each tree's girth; this engine
// classifies. Centralises the logic the BQ Reader and the take-off->tender
// handoff both need.
//
// Thresholds are CONFIG. Defaults follow common NParks practice; VERIFY against
// the current NParks Guidelines on Greenery Provision and Tree Conservation
// before relying on them for a submission.

// Species lists for deterministic flagging (derived server-side, not by the model,
// which keeps the model's output small and the flags consistent).
const CONSERVATION_SPECIES = ['rain tree', 'angsana', 'tembusu', 'senegal mahogany'];
const INVASIVE_SPECIES = ['african tulip tree', 'taiwan acacia'];

/** Regulatory flags for one tree (girth/species/data-quality). */
export function deriveFlags(tree, dupSet) {
  const flags = [];
  const g = tree.girth;
  const measurable = g != null && g >= 0;
  if (measurable && g > NPARKS.heritageGirth) flags.push('heritage_candidate');
  if (measurable && g > NPARKS.protectedGirth) flags.push('protected');
  const sp = String(tree.species || '').toLowerCase();
  if (sp && CONSERVATION_SPECIES.some((s) => sp.includes(s))) flags.push('high_conservation');
  if (sp && INVASIVE_SPECIES.some((s) => sp.includes(s))) flags.push('invasive');
  if (g == null || tree.height == null || !tree.species) flags.push('missing_data');
  if (dupSet && tree.no && dupSet.has(tree.no)) flags.push('duplicate');
  return flags;
}

const toNum = (v) => {
  if (v == null || v === '' || v === '-') return null;
  if (typeof v === 'number') return v;
  const s = String(v).toLowerCase();
  if (s.includes('cluster')) return -1;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
};

/**
 * Normalise an extraction object: expand the compact columnar tree format
 * (treeColumns + treeRows) into full tree objects, coerce girth/height, and
 * derive flags deterministically. Idempotent for already-expanded trees[].
 */
export function expandExtraction(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  let trees = Array.isArray(parsed.trees) ? parsed.trees : [];

  if (Array.isArray(parsed.treeRows) && parsed.treeRows.length) {
    const cols = (Array.isArray(parsed.treeColumns) && parsed.treeColumns.length)
      ? parsed.treeColumns : ['no', 'girth', 'height', 'species', 'sheet', 'type', 'status'];
    trees = parsed.treeRows
      .filter((r) => Array.isArray(r))
      .map((r) => { const o = {}; cols.forEach((c, i) => { o[c] = r[i]; }); return o; });
  }

  for (const t of trees) { t.girth = toNum(t.girth); t.height = toNum(t.height); }

  // Duplicate tree numbers across the whole register.
  const counts = new Map();
  for (const t of trees) if (t.no) counts.set(t.no, (counts.get(t.no) || 0) + 1);
  const dupSet = new Set([...counts.entries()].filter(([, v]) => v > 1).map(([k]) => k));

  for (const t of trees) {
    if (!Array.isArray(t.flags) || t.flags.length === 0) t.flags = deriveFlags(t, dupSet);
  }

  parsed.trees = trees;
  delete parsed.treeRows;
  delete parsed.treeColumns;
  return parsed;
}

/**
 * Parse the model's tree-extraction JSON, salvaging the headline numbers when the
 * output was truncated. The prompt puts sheets/totals BEFORE the (compact) tree
 * rows, so those survive a cut-off; we recover them by regex and rescue any
 * complete tree rows. Always returns fully-expanded trees[] with derived flags.
 */
export function parseTreeExtraction(text) {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  try { return expandExtraction(JSON.parse(clean)); } catch (_) { /* salvage */ }

  const out = { _truncated: true, treeRows: [], dataIssues: [] };
  const num = (re) => { const m = clean.match(re); return m ? Number(m[1]) : undefined; };
  const str = (k) => { const m = clean.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`)); return m ? m[1] : undefined; };

  out.totalRemove = num(/"totalRemove"\s*:\s*(\d+)/);
  out.totalRetain = num(/"totalRetain"\s*:\s*(\d+)/);
  for (const k of ['projectName', 'drawingRef', 'authority', 'countBasis']) {
    const v = str(k); if (v !== undefined) out[k] = v;
  }
  const sheetsM = clean.match(/"sheets"\s*:\s*(\[[\s\S]*?\])\s*,\s*"/);
  if (sheetsM) { try { out.sheets = JSON.parse(sheetsM[1]); } catch (_) {} }
  const totalsM = clean.match(/"totals"\s*:\s*(\{[^{}]*\})/);
  if (totalsM) { try { out.totals = JSON.parse(totalsM[1]); } catch (_) {} }
  const colsM = clean.match(/"treeColumns"\s*:\s*(\[[^\]]*\])/);
  if (colsM) { try { out.treeColumns = JSON.parse(colsM[1]); } catch (_) {} }

  // Rescue complete compact rows (arrays with no nested brackets) after "treeRows".
  const rowsAt = clean.indexOf('"treeRows"');
  if (rowsAt >= 0) {
    const tail = clean.slice(rowsAt);
    const re = /\[[^\[\]]*\]/g; let m;
    while ((m = re.exec(tail))) { try { out.treeRows.push(JSON.parse(m[0])); } catch (_) {} }
  } else {
    // Older object format fallback.
    const re = /\{[^{}]*?"no"\s*:\s*"[^"]*"[^{}]*?\}/g; let m;
    out.trees = [];
    while ((m = re.exec(clean))) { try { out.trees.push(JSON.parse(m[0])); } catch (_) {} }
  }

  if (out.totalRemove == null && Array.isArray(out.sheets)) out.totalRemove = out.sheets.reduce((s, x) => s + (Number(x.removeCount) || 0), 0);
  if (out.totalRetain == null && Array.isArray(out.sheets)) out.totalRetain = out.sheets.reduce((s, x) => s + (Number(x.retainCount) || 0), 0);

  out.dataIssues.push('⚠ Extraction output was truncated. Headline Remove/Retain totals were recovered from the printed per-sheet tallies; the tree register below may be incomplete.');
  return expandExtraction(out);
}

export const NPARKS = {
  // Girth (m) upper bounds, ascending. A tree falls in the first band whose
  // max it is strictly below.
  bands: [
    { key: 'S', label: 'Small (<0.5m)', max: 0.5 },
    { key: 'M', label: 'Medium (0.5–1.0m)', max: 1.0 },
    { key: 'L', label: 'Large (1.0–2.0m)', max: 2.0 },
    { key: 'XL', label: 'Very large (>2.0m)', max: Infinity },
  ],
  protectedGirth: 1.0,   // girth > this => protected
  heritageGirth: 3.0,    // girth > this => heritage candidate
  replacementRatio: { S: 1, M: 2, L: 3, XL: 5 }, // replacement trees per felled tree
};

// girth === null => unknown; girth === -1 => a "cluster" entry (assessed per clump).
export function girthBand(girth, cfg = NPARKS) {
  if (girth == null) return { key: 'unknown', label: 'Unknown girth' };
  if (girth === -1) return { key: 'cluster', label: 'Cluster' };
  for (const b of cfg.bands) if (girth < b.max) return { key: b.key, label: b.label };
  return cfg.bands[cfg.bands.length - 1];
}

// Remove/Retain/Transplant is a DESIGN decision read off the drawing (row font
// colour matched to the legend), never derived from girth. Normalise whatever the
// extractor put in `status` to one of: remove | retain | transplant | unknown.
export function normalizeStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (/transplant|reloc/.test(s)) return 'transplant';
  if (/remov|fell|cut/.test(s)) return 'remove';
  if (/retain|keep|remain|exist/.test(s)) return 'retain';
  return 'unknown';
}

// "tree" vs "shrub" per the legend category; default tree.
export function normalizeType(type) {
  return String(type || '').trim().toLowerCase() === 'shrub' ? 'shrub' : 'tree';
}

export function classifyTree(tree, cfg = NPARKS) {
  const band = girthBand(tree.girth, cfg);
  const measurable = tree.girth != null && tree.girth >= 0;
  return {
    ...tree,
    status: normalizeStatus(tree.status),
    type: normalizeType(tree.type),
    band: band.key,
    bandLabel: band.label,
    isProtected: measurable && tree.girth > cfg.protectedGirth,
    isHeritageCandidate: measurable && tree.girth > cfg.heritageGirth,
  };
}

// Girth-band breakdown + felling/replacement for a SET of trees (used for the
// removed set — you only fell and replace what is removed, not what is retained).
function bandSummary(trees, cfg) {
  const byBand = { S: 0, M: 0, L: 0, XL: 0, cluster: 0, unknown: 0 };
  let protectedCount = 0, heritage = 0;
  for (const c of trees) {
    byBand[c.band] = (byBand[c.band] || 0) + 1;
    if (c.isProtected) protectedCount++;
    if (c.isHeritageCandidate) heritage++;
  }
  const r = cfg.replacementRatio;
  const replacement = byBand.S * r.S + byBand.M * r.M + byBand.L * r.L + byBand.XL * r.XL;
  return { total: trees.length, byBand, protected: protectedCount, heritage, replacement };
}

export function summarize(trees = [], cfg = NPARKS) {
  const classified = trees.map((t) => classifyTree(t, cfg));

  // Authoritative remove/retain figures come from status (the drawing colour).
  const byStatus = { remove: 0, retain: 0, transplant: 0, unknown: 0 };
  const byTypeStatus = {
    removeTrees: 0, removeShrubs: 0, retainTrees: 0, retainShrubs: 0,
    transplantTrees: 0, transplantShrubs: 0,
  };
  for (const c of classified) {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    const cap = c.type === 'shrub' ? 'Shrubs' : 'Trees';
    if (c.status === 'remove') byTypeStatus['remove' + cap]++;
    else if (c.status === 'retain') byTypeStatus['retain' + cap]++;
    else if (c.status === 'transplant') byTypeStatus['transplant' + cap]++;
  }

  // Girth analysis / felling take-off applies to REMOVED trees only.
  const removed = bandSummary(classified.filter((c) => c.status === 'remove' && c.type === 'tree'), cfg);

  // Overall regulatory counts span every tree regardless of status.
  let protectedCount = 0, heritage = 0;
  for (const c of classified) { if (c.isProtected) protectedCount++; if (c.isHeritageCandidate) heritage++; }

  return {
    total: trees.length,
    ...byStatus,                 // remove, retain, transplant, unknown
    ...byTypeStatus,             // removeTrees, removeShrubs, retainTrees, retainShrubs, ...
    removed,                     // { total, byBand, protected, heritage, replacement } — removed trees
    protected: protectedCount,   // regulatory, all trees
    heritage,
    // Back-compat: byBand/replacement now reflect the REMOVED set (what you fell).
    byBand: removed.byBand,
    replacement: removed.replacement,
  };
}

/**
 * Aggregate a tree register into priced-able take-off rows
 * ({ id, description, unit, qty }), for the tender handoff. Only REMOVED trees
 * are felled, so the take-off is built from the removed set. Drops zero-qty rows.
 */
export function aggregateTakeoff(trees = [], cfg = NPARKS) {
  const s = summarize(trees, cfg);
  const rows = [
    { id: 'TO-S', description: 'Tree felling — small girth (<0.5m)', unit: 'nr', qty: s.removed.byBand.S },
    { id: 'TO-M', description: 'Tree felling — medium girth (0.5–1.0m)', unit: 'nr', qty: s.removed.byBand.M },
    { id: 'TO-L', description: 'Tree felling — large girth (1.0–2.0m)', unit: 'nr', qty: s.removed.byBand.L },
    { id: 'TO-XL', description: 'Tree felling — very large girth (>2.0m)', unit: 'nr', qty: s.removed.byBand.XL },
    { id: 'TO-HER', description: 'Heritage tree careful removal', unit: 'nr', qty: s.removed.heritage },
    { id: 'TO-REP', description: 'Replacement planting', unit: 'nr', qty: s.removed.replacement },
  ];
  return rows.filter((row) => row.qty > 0);
}
