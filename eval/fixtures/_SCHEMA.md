# Eval fixture format

One JSON file per reference project. The runner (`eval/run.mjs`) loads every
`*.json` in this folder, generates a programme from `profile`, and scores it
against `expected`.

```jsonc
{
  "id": "kebab-case-unique-id",

  // "real"      -> a genuine, as-submitted/approved Master Programme. GATES the
  //                eval: if it fails, `npm run eval` exits non-zero.
  // "synthetic" -> hand-authored / illustrative. Reported but NEVER gates.
  "status": "real" | "synthetic",

  // Where the ground truth came from. Be specific: project name (or anonymised
  // code), who submitted it, the programme revision, date approved.
  "source": "string",

  // Input to generateProgramme(). Same shape lib/programme-generator.js expects.
  "profile": {
    "name": "string",
    "ref": "string",
    "type": "building",
    "structuralSystem": "insitu_rc",
    "storeys": 5,
    "gfa": 4200,
    "contractForm": "PSSCOC",
    "startDate": "2026-01-02"          // required, YYYY-MM-DD
  },

  // Ground truth pulled from the REAL approved programme.
  "expected": {
    // Total programme duration in WORKING DAYS (NEA calendar). If the real
    // programme is in calendar days, convert first (~21.7 working days / month).
    "totalDurationDays": 320,

    // The real critical path, expressed in THIS generator's task ids. You map
    // each real critical activity to the closest generator task once, by hand.
    // Generator ids: mob, hoard, soil, clear, util, bca-permit, pile, pilecap,
    // gbeam, floor-1..N, block, facade, mep, finishes, scdf, tc, top, handover,
    // csc.
    "criticalPathTaskIds": ["mob", "bca-permit", "pile", "..."],

    // Which gateways the real programme shows (almost always all four).
    "gateways": ["bca-permit", "scdf", "top", "csc"],

    // WBS phases the real programme covers, mapped to generator phase ids
    // (p1 Pre-Construction, p2 Sub-Structure, p3 Super-Structure,
    //  p4 Architectural & M&E, p5 Testing/Commissioning/Handover).
    "wbsIds": ["p1", "p2", "p3", "p4", "p5"]
  },

  // Optional per-fixture acceptance bars. Defaults: ±15% duration, 0.6 overlap.
  "bars": { "durationTolerance": 0.15, "cpOverlap": 0.6 }
}
```

## How to add a real fixture

1. Get one in-situ RC project with BOTH the input docs AND the as-submitted,
   approved Master Programme.
2. Fill `profile` from the input docs (the same profile a planner would confirm
   before generating).
3. Read `totalDurationDays`, the critical path, gateways, and phases off the
   approved programme. Map its critical activities to generator task ids.
4. Set `status: "real"`. Run `npm run eval`. Read the gap.
5. Tune `lib/programme-generator.js` BENCHMARK durations + statutory lead times
   until the real fixtures pass. Do NOT tune the bars to make a fixture pass.
