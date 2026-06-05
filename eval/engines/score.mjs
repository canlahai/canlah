// Generic scorer for engine eval fixtures. Compares selected keys of an engine's
// output against a fixture's `expect` block. Numbers compared with a small
// tolerance; arrays/objects compared deeply. Returns mismatches for the report.

const EPS = 1e-9;

export function deepEqualish(got, want) {
  if (typeof want === 'number' && typeof got === 'number') {
    return Math.abs(got - want) <= EPS;
  }
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) return false;
    return want.every((w, i) => deepEqualish(got[i], w));
  }
  if (want && typeof want === 'object') {
    if (!got || typeof got !== 'object') return false;
    return Object.keys(want).every((k) => deepEqualish(got[k], want[k]));
  }
  return got === want;
}

/** Compare each key in `expect` against the engine output. */
export function scoreExpect(actual, expect = {}) {
  const mismatches = [];
  for (const [key, want] of Object.entries(expect)) {
    const got = actual?.[key];
    if (!deepEqualish(got, want)) mismatches.push({ key, want, got });
  }
  return { pass: mismatches.length === 0, mismatches };
}
