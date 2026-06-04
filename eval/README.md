# Programme generator eval

The acceptance gate for `lib/programme-generator.js`. It answers one question:
**does the generated Master Programme match a real, approved one closely enough
to be useful to a planner?**

Built per the eval spec in `PROGRAMME_THIN_SLICE.md` ("Acceptance — eval-gated").

## What it scores

For each reference project, it generates a programme from the project profile and
checks four metrics against the real programme:

| Metric         | Bar (default)        | What it means |
|----------------|----------------------|---------------|
| `duration`     | within ±15%          | Total programme length is realistic. |
| `criticalPath` | overlap ≥ 0.6        | The chain that actually drives the end date matches (Jaccard of task ids). |
| `gateways`     | all 4, sequenced     | BCA permit, SCDF, TOP, CSC present and in the right order. |
| `wbs`          | every phase covered  | No missing work breakdown phases. |

## Run it

```bash
npm run eval            # score every fixture, print a report
npm run eval -- --json  # machine-readable scorecards
node eval/run.mjs <id>  # one fixture by id
npm run eval:test       # unit tests for the scoring logic
```

Exit code is non-zero only if a fixture with `status: "real"` fails. Synthetic
fixtures are reported but never gate, so the harness is green today.

## State today

There are **no real fixtures yet** — only `synthetic-5st-rc.json`, a hand-authored
placeholder. It already exposes the known gap: duration comes in ~21% under
because the statutory gateways (`bca-permit`, `scdf`, `top`, `csc`) carry 0
processing lead time. Critical path, gateway sequencing, and WBS coverage all
pass.

## Closing the gap (the actual next step)

1. Get one in-situ RC project with BOTH input docs AND its approved Master
   Programme. Add it as a `status: "real"` fixture (see `fixtures/_SCHEMA.md`).
2. Run `npm run eval`, read the duration error.
3. Fill the real statutory lead times and tune `BENCHMARK` durations in
   `lib/programme-generator.js` until the real fixture passes. Tune the engine,
   not the bars.
