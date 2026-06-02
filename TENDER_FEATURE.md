# Tender Builder — Feature Design

**Status:** Design (not built)
**Date:** 2026-06-02
**Owner:** CanLah

## The model (do not get this backwards)

CanLah is a **take-off engine, not a pricing engine.**

- CanLah reads a drawing and itemizes **quantities** of materials, labour, equipment.
- CanLah does **not** set price. The QS does, via their own BQ rates.
- The **tender** is the deliverable: `quantity (CanLah) × rate (QS) = amount`.

```
 Drawing ──▶ [CanLah take-off] ──▶ quantity rows
                                        │
 QS's BQ ─▶ [BQ upload] ─▶ BQ lines ────┤ (CanLah suggests matches, QS approves)
                                        ▼
                                  [Tender table]
                              qty × QS rate = amount  ──▶ export
```

## Three stages

### 1. Drawing → take-off (mostly exists today)
`bq-reader.html` already extracts items from a drawing. Output today mixes quantities
**and** CanLah's "SGD market rates." For the tender flow we only consume the **quantity
rows** — never CanLah's rates. A quantity row is:

```
{ id, description, unit, qty }   // e.g. { "Tree felling — girth 1.0–2.0m", "nr", 113 }
```

The take-off already aggregates (girth bands: 146 small / 158 medium / 113 large / 52
very large). **Matching happens at this aggregated-row level, not per individual stem.**

### 2. QS uploads their BQ (NEW)
Separate upload section. The QS brings their own itemized BQ with their rates. A BQ line is:

```
{ ref, description, unit, rate }   // e.g. { "TF-03", "Fell & remove tree, girth 1–2m", "nr", 85.00 }
```

**Ingestion format — recommend CSV / Excel first.** Rates are money. We must not let AI
hallucinate a rate. Structured upload (the QS exports from Excel / their costing tool) keeps
rates exact. Expected columns: `ref, description, unit, rate` (map-on-import if headers differ).
Secondary: manual entry of BQ lines in-app. PDF-BQ via AI extraction is **later**, and even
then every parsed rate must be QS-confirmed.

### 3. Match → tender (NEW)
Side-by-side mapping screen. Structure the tender **by BQ line** (that's the deliverable shape).

**CanLah suggests, QS approves (not pure-manual).** On open, CanLah pre-fills a best-guess
match for every take-off row → BQ line by comparing descriptions/units (AI similarity).
Each suggested link shows a confidence cue and an "approve / re-link / unlink" control.
The QS confirms in one click when right, fixes when wrong. Nothing is locked in until the
QS approves — CanLah proposes, the QS disposes. Rationale: QS expects help, not blank-slate
busywork, but must keep final control of every pairing (the pricing depends on it).

- For each **BQ line**, one or more **take-off rows** attach (CanLah's suggestion, QS-editable).
  Qty = sum of attached rows.
- Many-to-one supported (several take-off buckets → one BQ line).
- **Unit guard:** warn if a take-off row's unit ≠ the BQ line's unit (nr vs m² etc.). CanLah
  will not auto-approve a unit-mismatched suggestion — always forces QS review.
- **Coverage flags:**
  - Take-off row CanLah couldn't match → "no BQ line found — QS to link or add one."
  - BQ line with no take-off row → qty 0 (excluded from total, shown greyed).
- Optional **markup**: per-line or overall margin % (QS asked for "mark up"). Default 0, QS sets it.

**Trust rule:** AI only suggests the *pairing*. It never touches the *rate* (QS's number) or
invents a quantity (CanLah's measured number). Low-confidence suggestions start unapproved.

**Tender output:** table of `ref | description | unit | qty | rate | amount (qty×rate) | +markup`,
with a grand total. Export: print / CSV / JSON (reuse existing export plumbing). Persist to
Supabase `canlah_reports` as a new `type: 'tender'` report holding
`{ takeoffRef, bqLines, mappings, tenderRows, markup, total }`.

## Open questions for later
- BQ upload: CSV/Excel only for v1, or also allow typing lines in-app? (lean: CSV + manual)
- Markup: per-line, overall, or both? (lean: overall % for v1)
- Does a tender pull a **saved** take-off, or only the one just generated? (lean: both — pick a saved take-off or continue from the current one)

## Phasing
1. **Reframe existing tool** (do now): stop `bq-reader` from claiming to produce final
   pricing. Relabel "market rates / cost estimate" output as a rough, non-binding estimate,
   and surface the take-off (quantities) as the real product.
2. **BQ upload + manual matching + tender table** (next): the three stages above, CSV-first.
3. **Polish:** markup, saved-take-off picker, PDF-BQ extraction (QS-confirmed rates).
