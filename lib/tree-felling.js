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
