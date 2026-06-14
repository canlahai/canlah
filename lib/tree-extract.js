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

const PER_SHEET_PROMPT = `This is ONE sheet of a Singapore LTA / NParks "Trees Affected Plan". Read THIS sheet only.

1) TITLE BLOCK: read the sheet number (e.g. "LRC216/RR/WSCL/0004"), the project name, and the drawing reference if shown.
2) PRINTED TALLY (most important): under the tree table there is printed text like "TREES TO BE REMOVED : 87 NOS" and "TREES TO BE RETAINED : 60 NOS" (wording varies). Read those two numbers EXACTLY as printed — do not recount. If this sheet has no tree table / no printed tally, set removeCount and retainCount to null.
3) ROWS: list every tree/shrub row in the table compactly. Status = row FONT COLOUR (green = retain, yellow = remove, other = transplant, unreadable = unknown). Never infer status from girth.

Return ONLY this JSON (no prose):
{
  "sheetNo": "LRC216/RR/WSCL/0004",
  "projectName": "…",
  "drawingRef": "…",
  "removeCount": 87,
  "retainCount": 60,
  "tallySource": "printed",          // "printed" if read from the printed tally, "counted" if you had to count rows, "none" if no table
  "treeColumns": ["no","girth","height","species","type","status"],
  "treeRows": [["E7309",0.67,6,"Rain Tree","tree","retain"]]
}
girth/height "-" or blank → null; "Cluster" girth → -1. Do NOT output a flags field.`;

function parseSheet(text) {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  try { return JSON.parse(clean); } catch (_) { /* salvage */ }
  const o = { _truncated: true };
  const num = (re) => { const m = clean.match(re); return m ? Number(m[1]) : null; };
  const str = (re) => { const m = clean.match(re); return m ? m[1] : undefined; };
  o.removeCount = num(/"removeCount"\s*:\s*(\d+)/);
  o.retainCount = num(/"retainCount"\s*:\s*(\d+)/);
  o.sheetNo = str(/"sheetNo"\s*:\s*"([^"]*)"/);
  o.projectName = str(/"projectName"\s*:\s*"([^"]*)"/);
  o.drawingRef = str(/"drawingRef"\s*:\s*"([^"]*)"/);
  const cm = clean.match(/"treeColumns"\s*:\s*(\[[^\]]*\])/);
  if (cm) { try { o.treeColumns = JSON.parse(cm[1]); } catch (_) {} }
  o.treeRows = [];
  const at = clean.indexOf('"treeRows"');
  if (at >= 0) { const tail = clean.slice(at); const re = /\[[^\[\]]*\]/g; let m; while ((m = re.exec(tail))) { try { o.treeRows.push(JSON.parse(m[0])); } catch (_) {} } }
  return o;
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
    const text = await streamMessageText({ content, maxTokens: 20000 });
    return parseSheet(text);
  });

  // Merge.
  const sheets = [];
  const allTrees = [];
  const dataIssues = [];
  let projectName, drawingRef, authority = 'LTA';

  results.forEach((r, idx) => {
    if (!r) return;
    if (!projectName && r.projectName) projectName = r.projectName;
    if (!drawingRef && r.drawingRef) drawingRef = r.drawingRef;
    const sheetNo = r.sheetNo || `Page ${idx + 1}`;
    const hasTable = r.removeCount != null || r.retainCount != null || (r.treeRows && r.treeRows.length);
    if (hasTable) {
      sheets.push({
        sheetNo,
        removeCount: Number(r.removeCount) || 0,
        retainCount: Number(r.retainCount) || 0,
        source: r.tallySource === 'counted' ? 'row count' : 'printed tally',
      });
      if (r.tallySource === 'counted') dataIssues.push(`${sheetNo}: no printed tally — counted coloured rows instead`);
      if (r.removeCount == null) dataIssues.push(`${sheetNo}: "removed" tally not legible`);
      if (r.retainCount == null) dataIssues.push(`${sheetNo}: "retained" tally not legible`);
    }
    const cols = (Array.isArray(r.treeColumns) && r.treeColumns.length) ? r.treeColumns : ['no', 'girth', 'height', 'species', 'type', 'status'];
    for (const row of (r.treeRows || [])) {
      if (!Array.isArray(row)) continue;
      const o = {}; cols.forEach((c, i) => { o[c] = row[i]; }); o.sheet = sheetNo;
      allTrees.push(o);
    }
    if (r._truncated) dataIssues.push(`${sheetNo}: row list was long and may be partial (tally totals are still exact)`);
  });

  const totalRemove = sheets.reduce((a, s) => a + s.removeCount, 0);
  const totalRetain = sheets.reduce((a, s) => a + s.retainCount, 0);

  const merged = expandExtraction({ trees: allTrees }); // coerce numbers + derive flags + dedupe

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
    pagesProcessed: pageCount,
    trees: merged.trees,
    dataIssues,
  };
}
