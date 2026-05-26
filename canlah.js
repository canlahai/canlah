// CanLah.ai shared frontend lib. Loaded by each pillar page.
// Provides: config bootstrap, page switching, toast, upload zone wiring,
// chunked upload + analyse, save/list reports.
// Wrapped in IIFE so module-private state doesn't collide with consumer globals.

(() => {

const CHUNK_SIZE = 3 * 1024 * 1024; // 3MB chunks to stay below Vercel 4.5MB body cap

const CanLah = {
  state: {
    publicApiKey: null,
    demoMode: true,
    uploadedFile: null,
  },

  async init() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const cfg = await res.json();
        this.state.publicApiKey = cfg.publicApiKey || null;
        this.state.demoMode = cfg.demoMode;
      }
    } catch {}
    this._startDotsAnimation();
    return this;
  },

  showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(`page-${name}`);
    if (el) el.classList.add('active');
  },

  showToast(msg, type) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.className = 'toast'; }, type === 'err' ? 5000 : 3500);
  },

  setupUploadZone({ accept, maxBytes = 30 * 1024 * 1024, onSelected } = {}) {
    const zone = document.getElementById('upload-zone');
    const input = document.getElementById('file-input');
    if (!zone || !input) return;

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', e => { e.preventDefault(); zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) this._acceptFile(file, { accept, maxBytes, onSelected });
    });
    input.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) this._acceptFile(file, { accept, maxBytes, onSelected });
    });
  },

  _acceptFile(file, { accept, maxBytes, onSelected }) {
    if (accept && !accept.test(file.name)) { this.showToast('Unsupported file type', 'err'); return; }
    if (file.size > maxBytes) { this.showToast(`Maximum ${Math.round(maxBytes / 1024 / 1024)}MB`, 'err'); return; }
    this.state.uploadedFile = file;

    const idle = document.getElementById('upload-idle');
    const selected = document.getElementById('upload-selected');
    if (idle) idle.style.display = 'none';
    if (selected) selected.style.display = 'block';

    const nameEl = document.getElementById('selected-name');
    const metaEl = document.getElementById('selected-meta');
    if (nameEl) nameEl.textContent = file.name;
    if (metaEl) metaEl.textContent = `${(file.size / 1024 / 1024).toFixed(1)}MB · ${file.type || 'unknown'}`;

    if (onSelected) onSelected(file);
  },

  bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  },

  async apiProcess(body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.state.publicApiKey) headers['x-api-key'] = this.state.publicApiKey;
    const res = await fetch('/api/process', { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.status === 401) { this._redirectToLogin(); throw new Error('Unauthorized — redirecting'); }
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || res.statusText);
    return data;
  },

  _redirectToLogin() {
    const here = location.pathname + location.search;
    location.href = '/login?return=' + encodeURIComponent(here);
  },

  async uploadAndAnalyse({ prompt, reportType }) {
    const file = this.state.uploadedFile;
    if (!file) throw new Error('No file selected');

    const ext = file.name.split('.').pop().toLowerCase();
    const mime = ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' })[ext] || 'application/octet-stream';

    const { key, uploadId } = await this.apiProcess({ action: 'upload-start', filename: file.name, mimeType: mime });
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const parts = [];
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(file.size, start + CHUNK_SIZE);
      const chunkBuf = await file.slice(start, end).arrayBuffer();
      this.showToast(`Uploading chunk ${i + 1}/${totalChunks}…`, 'info');
      const part = await this.apiProcess({ action: 'upload-part', key, uploadId, partNumber: i + 1, data: this.bufferToBase64(chunkBuf), mimeType: mime });
      parts.push({ etag: part.etag, partNumber: i + 1 });
    }

    this.showToast('Finalising upload…', 'info');
    const { fileId } = await this.apiProcess({ action: 'upload-complete', key, uploadId, parts, mimeType: mime });

    this.showToast('Analysing with Claude…', 'info');
    const analyse = await this.apiProcess({ action: 'analyse', fileId, prompt, reportType });
    return analyse.data;
  },

  async saveReport(report, reportType) {
    const payload = { report: Object.assign({ reportType }, report) };
    const res = await fetch('/api/save-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) { this._redirectToLogin(); throw new Error('Unauthorized — redirecting'); }
    const j = await res.json();
    if (!res.ok || j.error) throw new Error(j.error || 'Save failed');
    return j;
  },

  async listSavedReports(reportType) {
    const res = await fetch('/api/reports');
    if (res.status === 401) { this._redirectToLogin(); throw new Error('Unauthorized — redirecting'); }
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || 'Load failed');
    return (json.reports || []).filter(r => r.reportType === reportType);
  },

  _startDotsAnimation() {
    if (this._dotsTimer) return;
    let dotCount = 0;
    this._dotsTimer = setInterval(() => {
      const el = document.getElementById('proc-dots');
      if (el) { dotCount = (dotCount % 3) + 1; el.textContent = '.'.repeat(dotCount); }
    }, 500);
  },
};

window.CanLah = CanLah;

})();
