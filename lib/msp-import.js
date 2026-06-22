// MS Project / schedule IMPORT — parse an uploaded plan into CanLah activities.
//
// MS Project's .mpp is proprietary binary (no pure-JS parser), so the supported
// open channels are: MS Project XML (MSPDI — File ▸ Save As ▸ XML), and CSV
// (any tool can produce it). Both are parsed here with zero dependencies so it
// runs in the browser AND under Node (for tests). A schedule PDF/image goes
// through the AI extraction pipeline instead (reportType 'scope').
//
// Output (shared by both parsers):
//   { name, startDate, activities: [{ id, name, durationDays, predecessors:[id],
//     section, milestone }], taskCount, linkCount, warnings:[] }

const decode = (s) => String(s == null ? '' : s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const dateOnly = (s) => (String(s || '').match(/\d{4}-\d{2}-\d{2}/) || [null])[0];
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? m[1] : null; };

// MS Project ISO duration "PT40H0M0S" → working days (8h/day).
function durationToDays(s) {
  if (!s) return null;
  const m = String(s).match(/PT(\d+)H/);
  if (m) return Math.max(0, Math.round(Number(m[1]) / 8));
  return null;
}

/** Parse MSPDI (MS Project XML). */
export function parseMSProjectXML(xml) {
  const warnings = [];
  if (!xml || !/<Project[\s>]/.test(xml)) return { name: null, startDate: null, activities: [], taskCount: 0, linkCount: 0, warnings: ['Not a MS Project XML file'] };

  const projName = (() => { const m = xml.match(/<Project[^>]*>([\s\S]*?)<Tasks>/); const seg = m ? m[1] : xml; const n = tag(seg, 'Name'); return n ? decode(n).trim() : null; })();
  const startDate = dateOnly(tag(xml, 'StartDate'));

  const blocks = xml.match(/<Task>[\s\S]*?<\/Task>/g) || [];
  const parsed = blocks.map((b) => ({
    uid: tag(b, 'UID'),
    name: decode(tag(b, 'Name') || '').trim(),
    summary: tag(b, 'Summary') === '1',
    milestone: tag(b, 'Milestone') === '1',
    durationDays: durationToDays(tag(b, 'Duration')),
    start: dateOnly(tag(b, 'Start')),
    finish: dateOnly(tag(b, 'Finish')),
    // Each predecessor link → { uid, lagDays }. MSPDI LinkLag is in tenths of a
    // minute; ÷(10·60·8h) ≈ working days.
    predLinks: (b.match(/<PredecessorLink>[\s\S]*?<\/PredecessorLink>/g) || []).map((lk) => ({
      uid: (tag(lk, 'PredecessorUID') || '').replace(/\D/g, ''),
      lagDays: Math.round((Number(tag(lk, 'LinkLag')) || 0) / 4800),
    })).filter((x) => x.uid),
  }));

  // Keep leaf tasks (drop summary rows + the UID-0 project row). Map UID → our id.
  const leaves = parsed.filter((t) => !t.summary && t.uid !== '0' && t.name);
  const uidToId = new Map(leaves.map((t, i) => [t.uid, 'a' + (i + 1)]));
  let linkCount = 0;
  const activities = leaves.map((t, i) => {
    let dur = t.durationDays;
    if (dur == null && t.start && t.finish) dur = Math.max(1, Math.round((Date.parse(t.finish) - Date.parse(t.start)) / 86_400_000) + 1);
    const predecessors = t.predLinks.map((l) => ({ id: uidToId.get(l.uid), lagDays: l.lagDays })).filter((p) => p.id);
    linkCount += predecessors.length;
    // Preserve the original MS Project UID so a later export carries the same
    // task identity back (stable round-trip).
    return { id: 'a' + (i + 1), name: t.name, durationDays: Math.max(0, dur || 0), predecessors, section: '', milestone: t.milestone, mspUid: t.uid };
  });
  if (!activities.length) warnings.push('No tasks found in the MS Project XML');
  return { name: projName, startDate, activities, taskCount: activities.length, linkCount, warnings };
}

// ── CSV ─────────────────────────────────────────────────────────────────────
function splitCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
const findCol = (headers, names) => headers.findIndex((h) => names.includes(h));

/** Parse a schedule CSV. Flexible headers: name / duration / predecessors (+ optional id). */
export function parseScheduleCSV(text) {
  const warnings = [];
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { name: null, startDate: null, activities: [], taskCount: 0, linkCount: 0, warnings: ['CSV has no data rows'] };
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const ci = {
    name: findCol(headers, ['name', 'task', 'taskname', 'activity', 'description', 'work', 'workitem']),
    dur: findCol(headers, ['duration', 'durationdays', 'days', 'dur']),
    pred: findCol(headers, ['predecessors', 'predecessor', 'preds', 'pred', 'after', 'depends', 'dependency', 'dependencies']),
    id: findCol(headers, ['id', 'no', 'no.', 'taskid', 'wbs', 'line']),
  };
  if (ci.name === -1) return { name: null, startDate: null, activities: [], taskCount: 0, linkCount: 0, warnings: ['CSV needs a "name"/"activity"/"task" column'] };

  const rows = lines.slice(1).map(splitCsvLine).filter((r) => (r[ci.name] || '').trim());
  // Map the source id (or 1-based row number) → our activity id, for predecessors.
  const srcToId = new Map();
  rows.forEach((r, i) => { const src = (ci.id !== -1 ? r[ci.id] : String(i + 1)).trim(); if (src) srcToId.set(src, 'a' + (i + 1)); });

  let linkCount = 0; let unresolved = 0;
  const activities = rows.map((r, i) => {
    const dur = ci.dur !== -1 ? Math.max(0, Math.round(Number(String(r[ci.dur]).replace(/[^\d.]/g, '')) || 0)) : 1;
    let predecessors = [];
    if (ci.pred !== -1 && r[ci.pred]) {
      predecessors = String(r[ci.pred]).split(/[;,/]| and /i).map((t) => t.trim()).filter(Boolean)
        .map((t) => {
          const lagM = (t.match(/[+-]\s*\d+/) || [''])[0].replace(/\s/g, '');
          const id = srcToId.get(t.replace(/[+-]\s*\d+/, '').trim());
          if (!id) { unresolved++; return null; }
          return { id, lagDays: lagM ? Number(lagM) : 0 };
        }).filter(Boolean);
    }
    linkCount += predecessors.length;
    return { id: 'a' + (i + 1), name: String(r[ci.name]).trim(), durationDays: dur, predecessors, section: '', milestone: dur === 0 };
  });
  if (ci.dur === -1) warnings.push('No duration column — defaulted each task to 1 day');
  if (unresolved) warnings.push(`${unresolved} predecessor reference(s) could not be matched`);
  return { name: null, startDate: null, activities, taskCount: activities.length, linkCount, warnings };
}
