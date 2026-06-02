# Programme Generator — Thin Slice Build Spec

The smallest end-to-end version that proves the idea. Build this, put it in front of one
planner with one real project, then deepen. See PROGRAMME_ROADMAP.md for the full vision.

## Scope

**In:** one project type — *low-rise in-situ RC building*. Inputs: Prelims / Specs / Scope
/ BQ. Standard SG WBS. Finish-to-start (+ lag) dependencies. Durations from BQ where a
quantity exists, parametric/statutory elsewhere, every one tagged + overridable. The four
regulatory gateways. NEA working-day calendar. Computed critical path. Editable Gantt.
Export to MS Project XML.

**Out (deliberately):** PPVC/DfMA & steel sequencing · P6 `.xer` import · learned durations
· multi-project · baseline/EOT workflow · crew optimisation · SS/FF/SF dependency types.

## Data model (one programme object)
```js
{
  project: { name, ref, type, structuralSystem:"insitu_rc", storeys, gfa,
             contractForm:"PSSCOC"|"SIA"|"REDAS", startDate },
  calendar: { workweek, publicHolidays:[...], noisyWorkBan:true },   // NEA
  wbs: [ { id, name, order } ],                                      // the 5 phases
  tasks: [ {
    id, name, wbsId,
    durationDays, durationBasis:"bq"|"benchmark"|"statutory"|"manual",
    bqRef, quantity, unit, outputRate, crews,        // present when basis==="bq"
    predecessors:[ { id, type:"FS", lagDays } ],
    earlyStart, earlyFinish, lateStart, lateFinish, totalFloat,   // CPM-computed
    onCriticalPath, start, end                                    // CPM-computed
  } ],
  milestones: [ { id, name, kind:"regulatory"|"contractual", date, gateBefore } ],
  criticalPathTaskIds: []
}
```

## Generation pipeline
1. **Understand** docs → project profile (AI extraction). **Planner confirms/edits the
   profile before generation** — fix the input, not the output.
2. **WBS** = the 5 standard phases (Pre-Construction & Enabling → Sub-Structure →
   Super-Structure → Architectural & M&E → Testing, Commissioning & Handover).
3. **Tasks** — AI proposes a task list per phase from scope + BQ; maps BQ items to tasks.
4. **Durations** (each tagged):
   - `bq`: `durationDays = ceil(quantity / (outputRate × crews))` for physical tasks that
     have a BQ quantity + a rate.
   - `statutory`: fixed lead times for approval waits (BCA permit, SCDF) — library, values
     seeded from the eval project (placeholder until then).
   - `benchmark`: parametric for the rest (e.g. floor cycle ~N days).
   - `manual`: planner override, always available.
5. **Logic** — sequencing rules generate FS deps: sub-structure before super-structure;
   floor N before N+1; M&E rough-in before ceiling; etc. AI proposes, planner edits.
6. **Milestones** — insert the four gateways at the right gate points:
   BCA Permit to Commence Structural Works → gate BEFORE Sub-Structure;
   SCDF → before M&E completion; TOP → at practical completion; CSC → after TOP.
7. **Calendar** — NEA working days + SG public holidays; duration→date conversion skips
   non-working days (no noisy work Sun/PH).
8. **CPM** — compute the critical path (below).

## CPM engine (deterministic, unit-tested, no AI)
- Topological sort tasks by predecessors (detect cycles → error).
- **Forward pass:** `ES = max(EF_pred + lag)` workday-aware; `EF = addWorkdays(ES, duration)`.
- **Backward pass:** `LF = min(LS_succ − lag)`; `LS = subWorkdays(LF, duration)`.
- `totalFloat = workdaysBetween(ES, LS)`; `onCriticalPath = totalFloat <= 0`.
- All date math goes through the NEA calendar so day counts are real, not idealised.

## Rendering
Reuse the existing Gantt renderer. Slice adds: gateway milestones styled distinctly,
NEA non-working days shaded, and **edit a task's duration → recompute CPM live**. Full
drag-to-edit + dependency arrows are Phase 6 (later). Export button → MS Project XML.

## Acceptance — eval-gated (this is the real test)
Pick one real in-situ RC project with BOTH the input docs AND the as-submitted, approved
Master Programme. Generate, then compare:
- Total duration within **±15%** of the real programme.
- Critical-path task overlap **≥ 60%** with the real critical path.
- All four gateways present and correctly sequenced.
- WBS covers every phase in the real programme.

(Bars are a starting point — tune after the first real comparison. The eval project also
back-fills the real output rates and statutory lead times the slice ships with placeholders.)

## Build order
1. Data model + **CPM engine + unit tests** (deterministic — build first, fully tested).
2. Calendar (NEA working days, SG PH) + workday date math.
3. Generation prompts: profile → tasks → logic.
4. Duration engine (parametric + statutory placeholders; BQ hook).
5. Wire BQ quantities from the bq-reader take-off output.
6. Render + manual-edit-recompute + MSP XML export.
7. Run the eval, tune rates/bars.

> Dependency: steps 4–5 and the acceptance test need the eval project. Steps 1–3 (CPM,
> calendar, prompts) can be built now, before it arrives.
