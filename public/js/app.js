/**
 * NimbusFS — Frontend Application
 * Handles file upload (chunked progress), download, list, and delete
 */

// ── State ──────────────────────────────────────────
const state = {
  files: [],
  uploading: false,
  deleteTarget: null,
};

// ── DOM Refs ───────────────────────────────────────
const uploadZone    = document.getElementById('uploadZone');
const fileInput     = document.getElementById('fileInput');
const uploadProgress = document.getElementById('uploadProgress');
const progressBar   = document.getElementById('progressBar');
const progressPct   = document.getElementById('progressPct');
const progressFilename = document.getElementById('progressFilename');
const progressSteps = document.getElementById('progressSteps');
const filesList     = document.getElementById('filesList');
const filesEmpty    = document.getElementById('filesEmpty');
const refreshBtn    = document.getElementById('refreshBtn');
const statusDot     = document.getElementById('statusDot');
const statusText    = document.getElementById('statusText');
const modalOverlay  = document.getElementById('modalOverlay');
const modalBody     = document.getElementById('modalBody');
const modalCancel   = document.getElementById('modalCancel');
const modalConfirm  = document.getElementById('modalConfirm');
const toastContainer = document.getElementById('toastContainer');

// ── Init ───────────────────────────────────────────
(async function init() {
  await checkHealth();
  await loadFiles();
  setupDragDrop();
  setupFileInput();
  refreshBtn.addEventListener('click', () => loadFiles(true));
  modalCancel.addEventListener('click', closeModal);
  modalConfirm.addEventListener('click', confirmDelete);
})();

// ── Health Check ───────────────────────────────────
async function checkHealth() {
  try {
    const res = await fetch('/api/health/hdfs');
    const data = await res.json();
    if (data.status === 'connected') {
      statusDot.className = 'status-dot connected';
      statusText.textContent = `HDFS · ${data.hdfsUrl}`;
    } else {
      throw new Error(data.error || 'Disconnected');
    }
  } catch (err) {
    statusDot.className = 'status-dot error';
    statusText.textContent = 'HDFS Offline';
    showToast('HDFS connection failed. Ensure Hadoop is running.', 'error');
  }
}

// ── File List ──────────────────────────────────────
async function loadFiles(animate = false) {
  if (animate) {
    refreshBtn.classList.add('spinning');
  }
  try {
    const res = await fetch('/api/files');
    const data = await res.json();
    state.files = data.files || [];
    renderFiles();
  } catch (err) {
    showToast('Failed to load files', 'error');
  } finally {
    refreshBtn.classList.remove('spinning');
  }
}

function renderFiles() {
  // Remove existing file cards (not empty state)
  filesList.querySelectorAll('.file-card').forEach(el => el.remove());

  if (state.files.length === 0) {
    filesEmpty.style.display = 'block';
    return;
  }

  filesEmpty.style.display = 'none';

  const sorted = [...state.files].sort((a, b) =>
    new Date(b.uploadedAt) - new Date(a.uploadedAt)
  );

  sorted.forEach(file => {
    const card = createFileCard(file);
    filesList.appendChild(card);
  });
}

function createFileCard(file) {
  const card = document.createElement('div');
  card.className = 'file-card';
  card.dataset.id = file.id;

  const uploadDate = file.uploadedAt
    ? new Date(file.uploadedAt).toLocaleString()
    : 'Unknown';

  card.innerHTML = `
    <div class="file-info">
      <div class="file-name" title="${escHtml(file.name)}">${escHtml(file.name)}</div>
      <div class="file-meta">
        <span class="file-meta-item">
          <span class="label">SIZE</span>
          <span class="value">${formatBytes(file.size)}</span>
        </span>
        <span class="file-meta-item">
          <span class="chunk-badge">⬡ ${file.chunks} CHUNKS</span>
        </span>
        <span class="file-meta-item">
          <span class="label">TYPE</span>
          <span class="value">${escHtml(file.mimeType || 'binary')}</span>
        </span>
        <span class="file-meta-item">
          <span class="label">UPLOADED</span>
          <span class="value">${uploadDate}</span>
        </span>
      </div>
    </div>
    <div class="file-actions">
      <button class="btn btn-icon download" title="Download" data-id="${file.id}" data-name="${escHtml(file.name)}">
        ${iconDownload()}
      </button>
      <button class="btn btn-icon delete" title="Delete" data-id="${file.id}" data-name="${escHtml(file.name)}">
        ${iconTrash()}
      </button>
    </div>
  `;

  card.querySelector('.download').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    downloadFile(btn.dataset.id, btn.dataset.name);
  });
  card.querySelector('.delete').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    openDeleteModal(btn.dataset.id, btn.dataset.name);
  });

  return card;
}

// ── Upload ─────────────────────────────────────────
function setupDragDrop() {
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) handleUpload(files[0]);
  });
  uploadZone.addEventListener('click', (e) => {
    if (e.target.tagName !== 'LABEL') fileInput.click();
  });
}

function setupFileInput() {
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleUpload(e.target.files[0]);
    fileInput.value = '';
  });
}

async function handleUpload(file) {
  if (state.uploading) {
    showToast('Upload in progress, please wait', 'info');
    return;
  }

  // 500 MB limit client-side check
  if (file.size > 500 * 1024 * 1024) {
    showToast(`File too large: ${formatBytes(file.size)}. Max 500 MB.`, 'error');
    return;
  }

  state.uploading = true;
  showProgress(file.name);

  try {
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/upload');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 85); // up to 85%
        setProgress(pct, `Uploading · ${formatBytes(e.loaded)} / ${formatBytes(e.total)}`);
      }
    };

    const result = await new Promise((resolve, reject) => {
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new Error(data.error || `HTTP ${xhr.status}`));
        } catch {
          reject(new Error('Invalid response'));
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(formData);
    });

    setProgress(100, `✓ Encrypted & stored in ${result.file.chunks} HDFS chunk(s)`);
    await sleep(800);

    showToast(`"${file.name}" uploaded successfully (${result.file.chunks} chunks)`, 'success');
    await loadFiles();
  } catch (err) {
    showToast(`Upload failed: ${err.message}`, 'error');
  } finally {
    state.uploading = false;
    setTimeout(() => { uploadProgress.style.display = 'none'; }, 1500);
  }
}

function showProgress(filename) {
  uploadProgress.style.display = 'block';
  progressFilename.textContent = filename;
  setProgress(0, 'Preparing upload...');
}

function setProgress(pct, stepText) {
  progressBar.style.width = `${pct}%`;
  progressPct.textContent = `${pct}%`;
  if (stepText) progressSteps.textContent = stepText;
}

// ── Download ───────────────────────────────────────
async function downloadFile(fileId, fileName) {
  const btn = document.querySelector(`.download[data-id="${fileId}"]`);
  if (btn) {
    btn.innerHTML = spinner();
    btn.disabled = true;
  }

  try {
    const res = await fetch(`/api/files/${fileId}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`"${fileName}" downloaded`, 'success');
  } catch (err) {
    showToast(`Download failed: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.innerHTML = iconDownload();
      btn.disabled = false;
    }
  }
}

// ── Delete ─────────────────────────────────────────
function openDeleteModal(fileId, fileName) {
  state.deleteTarget = { id: fileId, name: fileName };
  modalBody.textContent = `"${fileName}" and all its HDFS chunks will be permanently removed.`;
  modalOverlay.style.display = 'flex';
}

function closeModal() {
  modalOverlay.style.display = 'none';
  state.deleteTarget = null;
}

async function confirmDelete() {
  if (!state.deleteTarget) return;
  const { id, name } = state.deleteTarget;
  closeModal();

  try {
    const res = await fetch(`/api/files/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    showToast(`"${name}" deleted`, 'success');
    await loadFiles();
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'error');
  }
}

// ── Toast ──────────────────────────────────────────
function showToast(message, type = 'info') {
  const icons = {
    success: '✓',
    error: '✕',
    info: '◎',
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || '◎'}</span><span>${escHtml(message)}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── Utilities ──────────────────────────────────────
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function spinner() {
  return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="animation:spin 0.6s linear infinite">
    <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="2" stroke-dasharray="20" stroke-dashoffset="10"/>
  </svg>`;
}

function iconDownload() {
  return `<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <path d="M7.5 2v8M7.5 10l-3-3M7.5 10l3-3M2 13h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function iconTrash() {
  return `<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <path d="M3 4h9M6 4V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5V4M5 4v8a1 1 0 001 1h3a1 1 0 001-1V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}