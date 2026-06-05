# Engine eval fixture format

One JSON file per scenario. The runner (`eval/engines/run.mjs`) runs `engine` on
`input` and checks every key in `expect`.

```jsonc
{
  "id": "kebab-case-unique-id",

  // "real"      -> matches an authority's published worked example (MOM/NParks).
  //                GATES CI: failing it fails `npm run eval:engines`.
  // "synthetic" -> hand-computed from the documented rule. Reported, never gates.
  "status": "real" | "synthetic",

  // The regulatory rule this scenario checks. Cite the source so a QS can verify.
  "basis": "string",

  // Which engine to run. One of:
  //   computeDRC      input = { localWorkers, workPermit, sPass, employmentPass }
  //   buildTender     input = { takeoffRows, bqLines, mappings, markupPct }
  //   summarizeTrees  input = { trees: [ { girth }, ... ] }
  "engine": "computeDRC",

  "input": { /* engine-specific, see above */ },

  // Only the keys you assert. The runner deep-compares each against the output
  // (numbers within 1e-9). You don't have to list every output field.
  "expect": { "quotaMax": 70, "withinQuota": true, "compliant": true }
}
```

## Adding a real fixture

1. Find a worked example in the authority's guidance (MOM DRC calculator, NParks
   replacement-planting guidance, etc.).
2. Encode its inputs and the authority's stated answer in `expect`.
3. Set `status: "real"` and cite the source in `basis`.
4. `npm run eval:engines`. If it fails, the engine's config thresholds
   (`CONSTRUCTION_DRC`, `NPARKS`, etc.) disagree with the authority — fix the
   engine, not the fixture.
