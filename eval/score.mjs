// Eval scoring for the programme generator. Deterministic, no AI.
//
// Given a generated programme (from lib/programme-generator.js) and a reference
// fixture's `expected` block, score the four acceptance metrics from
// PROGRAMME_THIN_SLICE.md:
//   1. Total duration within ±tolerance of the real programme.
//   2. Critical-path overlap ≥ minOverlap with the real critical path.
//   3. All four regulatory gateways present AND correctly sequenced.
//   4. WBS covers every phase in the real programme.
//
// Each function is pure and unit-tested in eval/test/score.test.mjs.

const round = (n) => Math.round(n * 1000) / 1000;

/** Total project duration within ±tolerance (fraction, e.g. 0.15 = ±15%). */
export function scoreDuration(generatedDays, expectedDays, tolerance = 0.15) {
  const diff = Math.abs(generatedDays - expectedDays);
  const ratio = expectedDays === 0 ? Infinity : diff / expectedDays;
  return {
    metric: 'duration',
    pass: ratio <= tolerance,
    generated: generatedDays,
    expected: expectedDays,
    errorPct: round(ratio * 100),
    tolerancePct: round(tolerance * 100),
  };
}

/**
 * Critical-path overlap. The fixture expresses the real programme's critical
 * tasks in THIS generator's task ids (a one-time mapping the planner does).
 * Headline metric is Jaccard overlap (intersection / union) so a generator that
 * floods the critical path with extra tasks is penalised, not rewarded. Recall
 * (how many real critical tasks we caught) is reported alongside for diagnosis.
 */
export function scoreCriticalPath(generatedIds, expectedIds, minOverlap = 0.6) {
  const g = new Set(generatedIds);
  const e = new Set(expectedIds);
  const matched = [...e].filter((x) => g.has(x));
  const union = new Set([...g, ...e]);
  const jaccard = union.size === 0 ? 1 : matched.length / union.size;
  const recall = e.size === 0 ? 1 : matched.length / e.size;
  return {
    metric: 'criticalPath',
    pass: jaccard >= minOverlap,
    overlap: round(jaccard),
    recall: round(recall),
    minOverlap,
    matched,
    missing: [...e].filter((x) => !g.has(x)),
    extra: [...g].filter((x) => !e.has(x)),
  };
}

const DEFAULT_GATEWAYS = ['bca-permit', 'scdf', 'top', 'csc'];

/** All four gateways present in milestones, and sequenced correctly by date. */
export function scoreGateways(programme, expectedGateways = DEFAULT_GATEWAYS) {
  const ms = Object.fromEntries(programme.milestones.map((m) => [m.id, m]));
  const byId = Object.fromEntries(programme.tasks.map((t) => [t.id, t]));
  const missing = expectedGateways.filter((g) => !ms[g]);
  const allPresent = missing.length === 0;

  // Statutory sequencing rules (PROGRAMME_THIN_SLICE.md §6). Each only runs when
  // both anchors exist, so a fixture for a different network still scores fairly.
  const seq = [];
  if (ms['bca-permit'] && byId['pile'])
    seq.push({ rule: 'BCA permit before piling', ok: ms['bca-permit'].date <= byId['pile'].start });
  if (ms['scdf'] && byId['tc'])
    seq.push({ rule: 'SCDF before testing & commissioning', ok: ms['scdf'].date <= byId['tc'].start });
  if (ms['top'] && byId['tc'])
    seq.push({ rule: 'TOP after testing & commissioning', ok: ms['top'].date >= byId['tc'].end });
  if (ms['top'] && ms['csc'])
    seq.push({ rule: 'CSC after TOP', ok: ms['csc'].date >= ms['top'].date });
  const sequenced = seq.every((c) => c.ok);

  return {
    metric: 'gateways',
    pass: allPresent && sequenced,
    present: expectedGateways.filter((g) => ms[g]),
    missing,
    sequencing: seq,
  };
}

/** Every expected WBS phase id appears in the generated WBS. */
export function scoreWbs(programme, expectedWbsIds = []) {
  const g = new Set(programme.wbs.map((w) => w.id));
  const missing = expectedWbsIds.filter((id) => !g.has(id));
  return {
    metric: 'wbs',
    pass: missing.length === 0,
    covered: expectedWbsIds.filter((id) => g.has(id)),
    missing,
  };
}

/** Score a generated programme against one fixture. Returns a full scorecard. */
export function scoreFixture(programme, fixture) {
  const bars = fixture.bars || {};
  const exp = fixture.expected || {};
  const results = {
    duration: scoreDuration(
      programme.projectDurationDays,
      exp.totalDurationDays,
      bars.durationTolerance ?? 0.15
    ),
    criticalPath: scoreCriticalPath(
      programme.criticalPathTaskIds,
      exp.criticalPathTaskIds || [],
      bars.cpOverlap ?? 0.6
    ),
    gateways: scoreGateways(programme, exp.gateways || DEFAULT_GATEWAYS),
    wbs: scoreWbs(programme, exp.wbsIds || []),
  };
  const pass = Object.values(results).every((r) => r.pass);
  return { id: fixture.id, status: fixture.status || 'real', pass, results };
}
