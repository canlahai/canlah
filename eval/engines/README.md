# Engine eval (regulatory thresholds)

Acceptance harness for the deterministic regulatory engines:

- **`computeDRC`** (HR compliance) — MOM Dependency Ratio Ceiling: foreign ≤ 7× local, S Pass ≤ 18% of total, EP excluded.
- **`buildTender`** — quantity × rate tabulation + markup.
- **`summarizeTrees`** (tree felling) — NParks girth bands, protected/heritage flags, replacement-planting counts.

These engines are pure arithmetic, so the "right answer" is knowable. This harness encodes scenarios as **plain JSON a QS can read and verify against the authority's published worked examples**, citing the rule basis in each fixture. It complements the unit tests: unit tests lock code-level invariants; these fixtures make the *regulatory thresholds* reviewable and let a domain expert drop in real authority examples.

## Run

```bash
npm run eval:engines           # score every fixture, print a report
npm run eval:engines -- --json # machine-readable
node eval/engines/run.mjs <id> # one fixture
npm run eval:engines:test      # unit tests for the scorer
```

Exit code is non-zero only if a `status:"real"` fixture fails, so it can gate CI once real authority examples are added. Synthetic (hand-computed) fixtures are reported but never gate.

## State today

All fixtures are `synthetic` — hand-computed from the documented rules, green against the current engine config. To make this a real gate, add `status:"real"` fixtures from MOM/NParks published calculators/examples (see `fixtures/_SCHEMA.md`). If a real fixture fails, the engine's config thresholds (`CONSTRUCTION_DRC` in `lib/hr-compliance.js`, `NPARKS` in `lib/tree-felling.js`) disagree with the authority — fix the engine, not the fixture.

Threshold values everywhere are tagged "VERIFY against current MOM/NParks rules" — they change, and this harness is where you prove the engine still matches.
