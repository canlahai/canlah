// Per-sheet tree-felling extraction.
//
// A 17-sheet "Trees Affected Plan" can't be read reliably in one vision pass —
// the tiny printed "TREES TO BE REMOVED : N" tallies get fuzzy when 17 huge
// pages are shrunk into one request, so sheets get missed/misread. Instead we
// split the PDF into one-page documents and read each sheet on its own with a
// tiny focused prompt, then sum the printed tallies. Every sheet is guaranteed
// to be looked at, and each per-sheet number is auditable.

import { PDFDocument } from 'pdf-lib';
import { streamMessageText } from './anthropic.js';
import { expandExtraction } from './tree-felling.js';

const MAX_PAGES = 40;       // safety cap
const CONCURRENCY = 4;      // pages read in parallel

const PER_SHEET_PROMPT = `This is ONE sheet of a Singapore LTA / NParks "Trees Affected Plan". Read THIS sheet only. Prefer the PDF's actual text (it is a CAD export — the tally and table are real text, not just an image), and use colour from the rendering for row status.

1) TITLE BLOCK: read the sheet number (e.g. "LRC216/RR/WSCL/0004"), the project name, and the drawing reference if shown.
2) PRINTED TALLIES (most important): below the tree table(s), usually bottom-left, there is printed text like:
      "TREES TO BE REMOVED : 87 NOS"
      "TREES TO BE RETAINED : 60 NOS"
   (wording varies: "TREE TO BE REMOVED", with/without ":" and "NOS"). There may be MORE THAN ONE such block if the sheet has more than one table — capture EVERY one. For each, TRANSCRIBE the exact line you see and read the integer. Read the digits carefully (e.g. distinguish 87 vs 81). Do not recount rows to get these — read what is printed. If the sheet has no tree table / no printed tally, return an empty "tallies" array.
3) ROWS: list every tree/shrub row in the table(s) compactly. Status = row FONT COLOUR (green = retain, yellow = remove, other = transplant, unreadable = unknown). Never infer status from girth.

Return ONLY this JSON (no prose):
{
  "sheetNo": "LRC216/RR/WSCL/0004",
  "projectName": "…",
  "drawingRef": "…",
  "tallies": [ { "removed": 87, "retained": 60, "text": "TREES TO BE REMOVED : 87 NOS / TREES TO BE RETAINED : 60 NOS" } ],
  "treeColumns": ["no","girth","height","species","type","status"],
  "treeRows": [["E7309",0.67,6,"Rain Tree","tree","retain"]]
}
Use null for a tally number you genuinely cannot read. girth/height "-" or blank → null; "Cluster" girth → -1. Do NOT output a flags field.`;

function parseSheet(text) {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  let o;
  try { o = JSON.parse(clean); }
  catch (_) {
    o = { _truncated: true };
    const str = (re) => { const m = clean.match(re); return m ? m[1] : undefined; };
    o.sheetNo = str(/"sheetNo"\s*:\s*"([^"]*)"/);
    o.projectName = str(/"projectName"\s*:\s*"([^"]*)"/);
    o.drawingRef = str(/"drawingRef"\s*:\s*"([^"]*)"/);
    const tm = clean.match(/"tallies"\s*:\s*(\[[\s\S]*?\])\s*,\s*"tree/);
    if (tm) { try { o.tallies = JSON.parse(tm[1]); } catch (_) {} }
    const cm = clean.match(/"treeColumns"\s*:\s*(\[[^\]]*\])/);
    if (cm) { try { o.treeColumns = JSON.parse(cm[1]); } catch (_) {} }
    o.treeRows = [];
    const at = clean.indexOf('"treeRows"');
    if (at >= 0) { const tail = clean.slice(at); const re = /\[[^\[\]]*\]/g; let m; while ((m = re.exec(tail))) { try { o.treeRows.push(JSON.parse(m[0])); } catch (_) {} } }
  }
  return o;
}

const statusOf = (t) => {
  const s = String(t && t.status || '').toLowerCase();
  if (/transplant|reloc/.test(s)) return 'transplant';
  if (/remov|fell|cut/.test(s)) return 'remove';
  if (/retain|keep|remain|exist/.test(s)) return 'retain';
  return 'unknown';
};

/**
 * Merge per-sheet results into the BQ-reader document shape, with self-checks.
 * Pure (no I/O) so it can be unit-tested. Each sheet's headline count is the SUM
 * of its printed tallies; we also count the coloured rows and flag any sheet
 * where the printed tally and the row count disagree (a likely misread).
 */
export function mergeSheetResults(results) {
  const sheets = [];
  const allTrees = [];
  const dataIssues = [];
  let projectName, drawingRef;
  const authority = 'LTA';

  results.forEach((r, idx) => {
    if (!r) return;
    if (!projectName && r.projectName) projectName = r.projectName;
    if (!drawingRef && r.drawingRef) drawingRef = r.drawingRef;
    const sheetNo = r.sheetNo || `Page ${idx + 1}`;

    const tallies = Array.isArray(r.tallies) ? r.tallies : [];
    const printedRemove = tallies.reduce((a, t) => a + (Number(t.removed) || 0), 0);
    const printedRetain = tallies.reduce((a, t) => a + (Number(t.retained) || 0), 0);
    const hasPrinted = tallies.some((t) => t.removed != null || t.retained != null);

    // Rows on this sheet (also used to cross-check the printed tally).
    const cols = (Array.isArray(r.treeColumns) && r.treeColumns.length) ? r.treeColumns : ['no', 'girth', 'height', 'species', 'type', 'status'];
    const rows = (r.treeRows || []).filter(Array.isArray).map((row) => { const o = {}; cols.forEach((c, i) => { o[c] = row[i]; }); o.sheet = sheetNo; return o; });
    const rowRemove = rows.filter((t) => statusOf(t) === 'remove').length;
    const rowRetain = rows.filter((t) => statusOf(t) === 'retain').length;

    const hasTable = hasPrinted || rows.length > 0;
    if (!hasTable) return; // plan/cover page — nothing to count

    const removeCount = hasPrinted ? printedRemove : rowRemove;
    const retainCount = hasPrinted ? printedRetain : rowRetain;
    const source = hasPrinted ? 'printed tally' : 'row count';

    // Self-check: printed tally vs coloured-row count.
    let discrepancy = null;
    if (hasPrinted && rows.length) {
      const dR = Math.abs(printedRemove - rowRemove);
      const dK = Math.abs(printedRetain - rowRetain);
      const tol = Math.max(2, Math.round(0.05 * (printedRemove + printedRetain)));
      if (dR > tol || dK > tol) {
        discrepancy = { rowRemove, rowRetain };
        dataIssues.push(`${sheetNo}: printed tally (−${printedRemove}/+${printedRetain}) differs from coloured-row count (−${rowRemove}/+${rowRetain}) — verify this sheet`);
      }
    }
    if (!hasPrinted) dataIssues.push(`${sheetNo}: no printed tally found — counted coloured rows instead (−${rowRemove}/+${rowRetain})`);
    if (r._truncated) dataIssues.push(`${sheetNo}: row list may be partial (tally totals unaffected)`);

    sheets.push({ sheetNo, removeCount, retainCount, source, tallyText: tallies.map((t) => t.text).filter(Boolean).join(' · '), discrepancy });
    allTrees.push(...rows);
  });

  const totalRemove = sheets.reduce((a, s) => a + s.removeCount, 0);
  const totalRetain = sheets.reduce((a, s) => a + s.retainCount, 0);
  const merged = expandExtraction({ trees: allTrees });

  return {
    projectName: projectName || 'Tree Affected Plan',
    drawingRef: drawingRef || (sheets.length ? `${sheets[0].sheetNo} … ${sheets[sheets.length - 1].sheetNo}` : '—'),
    authority,
    legend: { removeColour: 'yellow', retainColour: 'green', transplantColour: null, notes: 'Green = retained, yellow = removed' },
    sheets,
    totalRemove,
    totalRetain,
    totals: { remove: totalRemove, retain: totalRetain, transplant: 0 },
    countBasis: `Per-sheet read — ${sheets.length} table sheet${sheets.length === 1 ? '' : 's'} (1 page = 1 sheet), printed tally summed`,
    trees: merged.trees,
    dataIssues,
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Split a tree-felling PDF into pages, read each sheet individually, and merge.
 * Returns the same shape the BQ reader expects, with `sheets[]` carrying the
 * per-sheet printed tallies and `countBasis` set to per-sheet.
 */
export async function extractTreeDocumentFromPdf(pdfBytes, { apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pageCount = Math.min(src.getPageCount(), MAX_PAGES);

  // One single-page PDF (base64) per sheet.
  const pages = [];
  for (let i = 0; i < pageCount; i++) {
    const one = await PDFDocument.create();
    const [pg] = await one.copyPages(src, [i]);
    one.addPage(pg);
    const bytes = await one.save();
    pages.push(Buffer.from(bytes).toString('base64'));
  }

  const results = await mapLimit(pages, CONCURRENCY, async (b64) => {
    const content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
      { type: 'text', text: PER_SHEET_PROMPT },
    ];
    const text = await streamMessageText({ content, maxTokens: 20000, apiKey });
    return parseSheet(text);
  });

  const doc = mergeSheetResults(results);
  doc.pagesProcessed = pageCount;
  return doc;
}
