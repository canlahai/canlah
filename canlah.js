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
          this.state.session = cfg.session || null;
          this.state.caller = cfg.caller || null;
        }
    } catch {}
    // Shared pure helpers (single source, unit-tested in lib/frontend-helpers.js).
    try { this._h = await import('/lib/frontend-helpers.js'); } catch { this._h = null; }
    this._startDotsAnimation();
    this.renderUserStatus();
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

  _createModalRoot() {
    if (this._modalRoot) return this._modalRoot;
    const root = document.createElement('div');
    root.className = 'canlah-modal-overlay';
    root.innerHTML = `
      <div class="canlah-modal" role="dialog" aria-modal="true" aria-labelledby="canlah-modal-title">
        <div class="cm-head">
          <div id="canlah-modal-title" class="cm-title"></div>
          <button type="button" class="cm-close" aria-label="Close">&times;</button>
        </div>
        <div class="cm-body"></div>
        <div class="cm-actions">
          <button type="button" class="cm-cancel cm-btn">Cancel</button>
          <button type="button" class="cm-confirm cm-btn">Confirm</button>
        </div>
      </div>
    `;
    root.style.display = 'none';
    document.body.appendChild(root);
    this._modalRoot = root;
    this._modalRoot.querySelector('.cm-close').addEventListener('click', () => this._resolveModal(false));
    this._modalRoot.querySelector('.cm-cancel').addEventListener('click', () => this._resolveModal(false));
    this._modalRoot.querySelector('.cm-confirm').addEventListener('click', () => this._resolveModal(true));
    window.addEventListener('keydown', (event) => {
      if (!this._modalRoot || this._modalRoot.style.display !== 'flex') return;
      if (event.key === 'Escape') this._resolveModal(false);
    });
    return root;
  },

  _resolveModal(value) {
    if (this._modalResolver) {
      this._modalResolver(value);
      this._modalResolver = null;
    }
    const root = this._modalRoot;
    if (!root) return;
    root.style.display = 'none';
  },

  async _showModal({ title, body, confirmText = 'Confirm', cancelText = 'Cancel' }) {
    const root = this._createModalRoot();
    root.querySelector('#canlah-modal-title').textContent = title;
    root.querySelector('.cm-body').innerHTML = body;
    root.querySelector('.cm-confirm').textContent = confirmText;
    root.querySelector('.cm-cancel').textContent = cancelText;
    root.style.display = 'flex';
    return new Promise((resolve) => {
      this._modalResolver = resolve;
    });
  },

  async showConfirm({ title, message, confirmText = 'Delete', cancelText = 'Cancel' }) {
    const body = `<p>${message}</p>`;
    return await this._showModal({ title, body, confirmText, cancelText });
  },

  async showPrompt({ title, message, placeholder = '', defaultValue = '', confirmText = 'Save', cancelText = 'Cancel' }) {
    const body = `
      <p>${message}</p>
      <input id="canlah-prompt-input" class="cm-input" type="text" placeholder="${placeholder}" value="${defaultValue}">
    `;
    const accepted = await this._showModal({ title, body, confirmText, cancelText });
    if (!accepted) return null;
    const input = document.getElementById('canlah-prompt-input');
    return input ? input.value.trim() : null;
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

  renderUserStatus() {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    let node = document.getElementById('canlah-user-status');
    if (!node) {
      node = document.createElement('div');
      node.id = 'canlah-user-status';
      node.className = 'topbar-user';
      topbar.appendChild(node);
    }
    const session = this.state.session;
    if (session?.id) {
      const label = session.name ? session.name : session.id.slice(0, 8);
      const role = session.role ? ` (${session.role})` : '';
      node.innerHTML = `<span class="topbar-user-label">Logged in as ${label}${role}</span><button type="button" class="act-btn small" onclick="CanLah.logout()">Logout</button>`;
      return;
    }
    if (this.state.demoMode) {
      node.textContent = 'Demo mode';
      return;
    }
    node.innerHTML = `<button type="button" class="act-btn small" onclick="location.href='/login?return=${encodeURIComponent(location.pathname)}'">Sign in</button>`;
  },

  async logout() {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/login?return=' + encodeURIComponent(location.pathname + location.search);
  },

  async uploadAndAnalyse({ prompt, reportType }) {
    const file = this.state.uploadedFile;
    if (!file) throw new Error('No file selected');

    const H = this._h || await import('/lib/frontend-helpers.js');
    const mime = H.extToMime(file.name);

    const { key, uploadId } = await this.apiProcess({ action: 'upload-start', filename: file.name, mimeType: mime });
    const totalChunks = H.chunkCount(file.size, CHUNK_SIZE);
    const parts = [];
    for (let i = 0; i < totalChunks; i++) {
      const { start, end } = H.chunkRange(i, file.size, CHUNK_SIZE);
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

  async deleteReport(id) {
    const res = await fetch('/api/reports', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.status === 401) { this._redirectToLogin(); throw new Error('Unauthorized — redirecting'); }
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || 'Delete failed');
    return json;
  },

  async updateReport(id, changes) {
    const res = await fetch('/api/reports', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, changes }),
    });
    if (res.status === 401) { this._redirectToLogin(); throw new Error('Unauthorized — redirecting'); }
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || 'Update failed');
    return json;
  },

  downloadReport(report) {
    const filename = this._h
      ? this._h.reportFilename(report)
      : `${(report.reportTitle || report.projectName || report.siteName || report.companyName || 'canlah-report').replace(/[^a-zA-Z0-9-_]/g, '_')}-${report.id || 'report'}.json`;
    const data = JSON.stringify(report, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  async downloadReportPdfById(id) {
    const res = await fetch(`/api/report-pdf?id=${encodeURIComponent(id)}`);
    if (res.status === 401) { this._redirectToLogin(); throw new Error('Unauthorized — redirecting'); }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'PDF export failed');
    }
    const blob = await res.blob();
    const filename = `canlah-report-${id}.pdf`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  async downloadReportById(id) {
    const res = await fetch(`/api/reports?ids=${encodeURIComponent(id)}`);
    if (res.status === 401) { this._redirectToLogin(); throw new Error('Unauthorized — redirecting'); }
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || 'Load failed');
    const r = (json.reports || [])[0];
    if (!r) throw new Error('Report not found');
    this.downloadReport(r);
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
