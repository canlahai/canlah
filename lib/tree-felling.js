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

export function classifyTree(tree, cfg = NPARKS) {
  const band = girthBand(tree.girth, cfg);
  const measurable = tree.girth != null && tree.girth >= 0;
  return {
    ...tree,
    band: band.key,
    bandLabel: band.label,
    isProtected: measurable && tree.girth > cfg.protectedGirth,
    isHeritageCandidate: measurable && tree.girth > cfg.heritageGirth,
  };
}

export function summarize(trees = [], cfg = NPARKS) {
  const counts = { S: 0, M: 0, L: 0, XL: 0, cluster: 0, unknown: 0 };
  let protectedCount = 0, heritage = 0;
  for (const t of trees) {
    const c = classifyTree(t, cfg);
    counts[c.band] = (counts[c.band] || 0) + 1;
    if (c.isProtected) protectedCount++;
    if (c.isHeritageCandidate) heritage++;
  }
  const r = cfg.replacementRatio;
  const replacement = counts.S * r.S + counts.M * r.M + counts.L * r.L + counts.XL * r.XL;
  return {
    total: trees.length,
    byBand: counts,
    protected: protectedCount,
    heritage,
    replacement,
  };
}

/**
 * Aggregate a tree register into priced-able take-off rows
 * ({ id, description, unit, qty }), for the tender handoff. Drops zero-qty rows.
 */
export function aggregateTakeoff(trees = [], cfg = NPARKS) {
  const s = summarize(trees, cfg);
  const rows = [
    { id: 'TO-S', description: 'Tree felling — small girth (<0.5m)', unit: 'nr', qty: s.byBand.S },
    { id: 'TO-M', description: 'Tree felling — medium girth (0.5–1.0m)', unit: 'nr', qty: s.byBand.M },
    { id: 'TO-L', description: 'Tree felling — large girth (1.0–2.0m)', unit: 'nr', qty: s.byBand.L },
    { id: 'TO-XL', description: 'Tree felling — very large girth (>2.0m)', unit: 'nr', qty: s.byBand.XL },
    { id: 'TO-HER', description: 'Heritage tree careful removal', unit: 'nr', qty: s.heritage },
    { id: 'TO-REP', description: 'Replacement planting', unit: 'nr', qty: s.replacement },
  ];
  return rows.filter((row) => row.qty > 0);
}
