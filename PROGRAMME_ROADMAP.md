# Programme Planner — Roadmap (Generation-First)

**The real goal:** kill the blank-page toil. The planner feeds in project documents;
CanLah **generates a draft Master Programme** (WBS, tasks, durations, dependencies,
regulatory milestones, critical path). The planner reviews and adjusts instead of
building from scratch in P6.

CanLah does the laborious 80% scaffolding. The planner keeps the 20% judgment.

**Inputs (project documents, NOT an existing schedule):**
Preliminaries · Specifications · Scope of Works · BQ · Conditions of Contract
(PSSCOC / SIA / REDAS) · tender drawings / BIM.

**Output:** an editable, compliance-aware programme + export to MS Project XML / P6 for
the planner to finalise and submit to the SO.

> Importing an existing P6/MSP file is now a SECONDARY feature (learn a contractor's
> house durations; compare baseline vs revised). Generation is the core.

## The crux: where durations come from
This decides credibility. A planner abandons the tool the first time a duration is
nonsense. Every generated duration MUST carry its basis and be overridable:
1. **BQ-driven** — quantity ÷ output rate (320 m³ ÷ daily pour rate). Most accurate.
   Needs a productivity-rate library (SG norms).
2. **Parametric** — standard cycle times (e.g. ~7-day floor cycle for typical RC; phase
   durations scaled by GFA / storeys / gross area).
3. **Learned** — upload the contractor's past programmes, learn THEIR durations per task.
4. **Planner-set** — AI proposes, planner overrides. Always available.

Each task tags `durationBasis: "bq" | "benchmark" | "learned" | "manual"` so trust is visible.

---

## Generation pipeline (the engine)
```
Docs ─▶ [1 Understand] ─▶ project profile (scope, GFA, storeys, contract form,
   │                       site constraints, key dates, working-hour limits)
   │
   ├─▶ [2 WBS]        ─▶ standard SG WBS, tailored to scope
   ├─▶ [3 Tasks]      ─▶ tasks per WBS element from scope + BQ
   ├─▶ [4 Durations]  ─▶ per the crux above, each with a basis tag
   ├─▶ [5 Logic]      ─▶ dependencies from construction-sequencing rules
   ├─▶ [6 Milestones] ─▶ BCA permit, SCDF, TOP, CSC + contract milestones, placed in seq
   ├─▶ [7 Calendar]   ─▶ NEA working days (no noisy work Sun/PH) + SG public holidays
   └─▶ [8 CPM]        ─▶ compute critical path + float on the generated network
                          ▼
                    Editable Gantt ─▶ planner adjusts ─▶ export P6/MSP
```

## Phases

### Phase 1 — Document understanding → project profile
Read Prelims/Specs/Scope/BQ → structured profile: project type, GFA, storeys, structural
system (RC / PPVC / DfMA), contract form (PSSCOC vs SIA/REDAS), site/access constraints,
working-hour restrictions, any stated key dates. This is the foundation for everything.

### Phase 2 — WBS + task generation
Apply the standard SG WBS (Pre-Construction & Enabling → Sub-Structure → Super-Structure
→ Architectural & M&E → Testing, Commissioning & Handover), tailored to scope. Generate
tasks per element. Map BQ items to tasks so quantities attach to the right activity.

### Phase 3 — Duration engine (the crux)
Start with **parametric defaults + BQ-driven where quantities exist**, every duration
tagged with its basis, all overridable. Build a small SG productivity-rate library
(concrete pour, formwork, rebar, blockwork, etc.). Later: **learned** mode from uploaded
past programmes.

### Phase 4 — Sequencing logic + CPM
Encode construction-sequencing rules (sub-structure before super-structure; floor N before
floor N+1; M&E rough-in before ceiling; etc.) → generate dependencies (FS + lag, v1).
CPM engine (~150 lines): forward/backward pass → float → critical path. AI proposes logic,
planner edits. Critical path is now **computed and EOT-defensible**, not guessed.

### Phase 5 — SG compliance intelligence (the moat)
Auto-insert regulatory gateways at the right sequence points and FLAG when scope implies
one is missing:
- **BCA Permit to Commence Structural Works** (gate before sub-structure).
- **SCDF** fire-safety approvals.
- **TOP** (golden occupiable milestone), **CSC** (final sign-off), URA.
- Contract-form milestones + Liquidated Damages (PSSCOC vs SIA/REDAS).
- **NEA calendar** baked into duration→date conversion (Sun/PH noisy-work ban).
- PPVC/DfMA awareness for BCA Buildability.
This is why a SG planner picks CanLah over a blank MS Project file.

### Phase 6 — Interactive, editable Gantt
`frappe-gantt` (vanilla, MIT): dependency arrows, drag-to-edit → live CPM recompute,
zoom, expand/collapse phases, gateway milestones styled, NEA non-working days shaded.
Edits flow back into the model. **Export to MS Project XML / P6 XML** for submission.

### Phase 7 — Baseline, learning & EOT
- Lock the SO-approved baseline; version it.
- Upload past programmes → learn house durations (feeds Phase 3 "learned" mode).
- Progress updates → actual-vs-baseline delay analysis → **EOT-ready report** under PSSCOC.

## Cross-pillar
BQ feeds quantities (durations) directly. HR compliance feeds manpower constraints.
The four pillars converge here: docs → BQ → programme → manpower.

## Effort (human team vs CC+gstack)
| Piece | Human | CC |
|---|---|---|
| Doc-understanding → profile | 1 week | ~1 hr |
| WBS + task generation | 1–2 weeks | ~1–2 hrs |
| Duration engine + rate library | 2–3 weeks | ~2–3 hrs |
| Sequencing logic + CPM | 1–2 weeks | ~1–2 hrs |
| SG compliance library | 1 week | ~1 hr |
| Interactive Gantt + export | 1–2 weeks | few hrs |
| Baseline / learning / EOT | 2 weeks | ~2 hrs |

## Recommended first slice (thin end-to-end)
Don't build all phases before anything works. Ship a **thin vertical** first:
*one project type* (e.g. a low-rise in-situ RC building), standard WBS, FS dependencies,
the four regulatory milestones, NEA calendar, computed critical path, editable Gantt.
Get a real planner to react. Then deepen each phase against their feedback.

---

## Pressure-test — risks & refinements (2026-06-02)

Ranked by severity. These must be designed for, not discovered later.

1. **(Critical) "BQ-driven durations" is underspecified.** A BQ gives a lump trade total
   ("1,200 m³ slab concrete"), organised for pricing — NOT a per-task quantity ("L3 slab
   = 320 m³"). The per-floor/zone breakdown isn't in the BQ; it must be **allocated** off
   the drawings (by floor area/zone). And duration = qty ÷ output-rate ÷ crews — the
   **rate** and **crew count** aren't in the BQ either. So "BQ-driven" actually =
   *BQ quantity × rate library × crew assumption × spatial allocation*. Three of four are
   NOT the BQ. The rate library still has to be built.
2. **(Critical) ~40% of tasks have no BQ quantity.** Enabling works, mobilisation,
   statutory approval waits (BCA/SCDF processing), T&C, handover. These need a SECOND
   duration engine: fixed periods + a statutory-lead-time library. Pure BQ-driven is
   impossible.
3. **(High) Generated critical path = EOT instrument = legal exposure.** Under PSSCOC the
   CP is the EOT basis. Wrong AI-generated logic → wrong CP → planner can lose an EOT
   claim. Frame as "draft, planner verifies & owns the logic"; bq-reader-grade disclaimer;
   never present generated CP as authoritative.
4. **(High) No eval = no credibility.** Need 1–2 real projects with BOTH input docs AND the
   actual submitted baseline programme. Generate → diff against the real one. Build this
   harness before trusting output.
5. **(Medium) Sequencing is structural-system-specific.** PPVC/DfMA inverts in-situ RC
   sequencing. Generic FS rules fit in-situ RC only. Keep the thin slice to ONE system.
6. **(Medium) Document variance.** Prelims/Specs formats vary; profile extraction is lossy.
   Planner confirms/edits the project profile BEFORE generation (fix input, not output).
7. **(Scope) This is an ocean, not a lake.** Full generative scheduling is huge. The thin
   slice keeps it tractable. Don't add project types until one is validated end-to-end.

**Refined duration model:** BQ quantity × rate library × per-floor allocation for *physical
build* tasks; statutory/parametric durations for the rest; every duration tagged
(`bq|benchmark|learned|manual`) and overridable; validated against a real submitted programme.

**Two things to lock before any code:** (a) the full duration model (four inputs, not just
"BQ"); (b) a named eval project (docs + as-submitted baseline) to measure against.
