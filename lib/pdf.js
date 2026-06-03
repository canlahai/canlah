import PDFDocument from 'pdfkit';
import { finished } from 'node:stream/promises';

function safeStringify(val) {
  try { return JSON.stringify(val, null, 2); } catch { return String(val || ''); }
}

function renderValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((i) => (typeof i === 'object' ? safeStringify(i) : String(i))).join(', ');
  if (typeof value === 'object') return safeStringify(value);
  return String(value);
}

export async function generateReportPdf(report, outStream) {
  if (!report) throw new Error('report required');
  if (!outStream) throw new Error('outStream required');

  const title = report.reportTitle || report.projectName || report.siteName || report.companyName || 'CanLah Report';
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.on('error', (e) => { try { outStream.destroy(e); } catch (_) {} });
  doc.pipe(outStream);

  // Title
  doc.fontSize(20).fillColor('black').text(title, { underline: true });
  doc.moveDown(0.5);
  try {
    if (report.savedAt) doc.fontSize(10).fillColor('gray').text(`Saved: ${new Date(report.savedAt).toLocaleString()} | Type: ${report.reportType || 'Unknown'}`);
  } catch (e) {}
  doc.moveDown();

  const fields = { ...report };
  delete fields.id; delete fields.savedAt; delete fields.reportType;

  // Tables for known structures
  if (fields.report && typeof fields.report === 'object' && Array.isArray(fields.report.trees)) {
    doc.fontSize(14).fillColor('black').text('Tree inventory', { underline: true });
    doc.moveDown(0.25);
    const rows = fields.report.trees.map(t => ({ no: t.no, species: t.species, girth: t.girth, height: t.height, flags: (t.flags || []).join(', ') }));
    renderTable(doc, ['no', 'species', 'girth', 'height', 'flags'], rows);
  } else if (fields.report && Array.isArray(fields.report) && fields.report.length && typeof fields.report[0] === 'object') {
    doc.fontSize(14).fillColor('black').text('Report items', { underline: true });
    doc.moveDown(0.25);
    const keys = Object.keys(fields.report[0]).slice(0, 6);
    renderTable(doc, keys, fields.report);
  } else {
    doc.fontSize(14).fillColor('black').text('Report details', { underline: true });
    doc.moveDown(0.25);
    Object.keys(fields || {}).sort().forEach((key) => {
      const value = fields[key];
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        doc.fontSize(11).fillColor('black').text(`${key}:`);
        const asJson = safeStringify(value);
        const lines = asJson.split(/\r?\n/);
        lines.forEach((ln) => {
          if (doc.y > doc.page.height - doc.page.margins.bottom - 30) doc.addPage();
          doc.fontSize(10).fillColor('black').text(ln);
        });
      } else {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 30) doc.addPage();
        doc.fontSize(11).fillColor('black').text(`${key}: ${renderValue(value)}`);
      }
      doc.moveDown(0.2);
    });
  }

  doc.end();
  await finished(outStream);
}

function renderTable(doc, headers, rows) {
  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colCount = headers.length;
  const colWidth = Math.floor(usableWidth / colCount);
  const rowHeight = 14;

  doc.fontSize(11).fillColor('black');
  headers.forEach((h, i) => {
    const label = typeof h === 'string' ? h : (h.title || h.key || '');
    doc.text(label, startX + i * colWidth + 2, doc.y, { width: colWidth - 4, align: 'left' });
  });
  doc.moveDown(0.4);

  doc.fontSize(10).fillColor('black');
  for (const r of rows) {
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 20) doc.addPage();
    headers.forEach((h, i) => {
      const key = typeof h === 'string' ? h : (h.key || '');
      const txt = renderValue(r[key]);
      doc.text(txt, startX + i * colWidth + 2, doc.y, { width: colWidth - 4, align: 'left' });
    });
    doc.moveDown(0.6);
  }
}
