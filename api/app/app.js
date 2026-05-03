/**
 * image-processor-k8s — app.js
 *
 * API endpoints (FastAPI):
 *   POST   /upload           → { job_id, status }
 *   GET    /status/{job_id}  → { status, result }
 *   GET    /files/{filename} → binary image
 *   GET    /                 → used as health ping
 */

const BASE_URL = ''; // vacío = mismo origen que FastAPI sirve

/* ============================================================
   STATE
============================================================ */
const state = {
  file:        null,
  priority:    'normal',
  jobs:        [],
  polling:     {},
  workerCount: 1,
  cpuLoad:     0,
};

/* ============================================================
   DOM REFS
============================================================ */
const $ = id => document.getElementById(id);

const dropzone       = $('dropzone');
const dropPreview    = $('dropPreview');
const previewImg     = $('previewImg');
const previewName    = $('previewName');
const previewSize    = $('previewSize');
const previewClear   = $('previewClear');
const fileInput      = $('fileInput');
const submitBtn      = $('submitBtn');
const queueList      = $('queueList');
const queueEmpty     = $('queueEmpty');
const clearBtn       = $('clearBtn');
const clusterDot     = $('clusterDot');
const clusterLabel   = $('clusterLabel');
const workerCount    = $('workerCount');
const queueCount     = $('queueCount');
const jobCount       = $('jobCount');
const hpaReplicas    = $('hpaReplicas');
const cpuFill        = $('cpuFill');
const cpuVal         = $('cpuVal');
const toastContainer = $('toastContainer');
const modalOverlay   = $('modalOverlay');
const modalClose     = $('modalClose');
const modalId        = $('modalId');
const modalImages    = $('modalImages');
const modalMeta      = $('modalMeta');
const modalLog       = $('modalLog');
const modalActions   = $('modalActions');

/* ============================================================
   UTILS
============================================================ */
function formatBytes(bytes) {
  if (bytes < 1024)    return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

function shortId(id) {
  return id.slice(0, 8) + '…';
}

function getCheckedTransforms() {
  return [...document.querySelectorAll('input[name="transform"]:checked')]
    .map(el => el.value);
}

/* ============================================================
   DRAG & DROP / FILE SELECTION
============================================================ */
dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));

dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) setFile(f);
  else toast('Only image files are supported.', 'error');
});

dropzone.addEventListener('click', e => {
  if (e.target === previewClear) return;
  if (!dropPreview.classList.contains('visible')) fileInput.click();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

previewClear.addEventListener('click', e => {
  e.stopPropagation();
  clearFile();
});

function setFile(f) {
  state.file = f;
  const reader = new FileReader();
  reader.onload = ev => {
    previewImg.src = ev.target.result;
    dropPreview.classList.add('visible');
    previewName.textContent = f.name;
    previewSize.textContent = formatBytes(f.size);
    submitBtn.disabled = false;
  };
  reader.readAsDataURL(f);
}

function clearFile() {
  state.file = null;
  fileInput.value = '';
  dropPreview.classList.remove('visible');
  previewImg.src = '';
  submitBtn.disabled = true;
}

/* ============================================================
   PRIORITY SEGMENTED CONTROL
============================================================ */
document.querySelectorAll('.seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.priority = btn.dataset.val;
  });
});

/* ============================================================
   WATERMARK OPTION TOGGLE
============================================================ */
const watermarkCheck = document.querySelector('input[value="watermark"]');
const watermarkGroup = $('watermarkGroup');

function toggleWatermarkGroup() {
  watermarkGroup.style.display = watermarkCheck.checked ? 'flex' : 'none';
}

watermarkCheck.addEventListener('change', toggleWatermarkGroup);
toggleWatermarkGroup();

/* ============================================================
   SUBMIT — ENQUEUE JOB
============================================================ */
submitBtn.addEventListener('click', async () => {
  if (!state.file) return;

  const transforms = getCheckedTransforms();
  if (transforms.length === 0) {
    toast('Select at least one transformation.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.querySelector('.submit-label').textContent = 'ENQUEUEING…';

  try {
    const jobId = await uploadImage(state.file, transforms, state.priority);
    addJob(jobId, transforms);
    toast(`Job ${shortId(jobId)} enqueued`, 'success');
    clearFile();
  } catch (err) {
    toast('Upload failed: ' + err.message, 'error');
    submitBtn.disabled = false;
  } finally {
    submitBtn.querySelector('.submit-label').textContent = 'ENQUEUE JOB';
    if (state.file) submitBtn.disabled = false;
  }
});

/* ============================================================
   API CALLS — REAL (FastAPI)
============================================================ */

/**
 * POST /upload
 * FastAPI guarda el fichero y encola la tarea Celery.
 * Devuelve: { job_id: string, status: "processing" }
 */
async function uploadImage(file, transforms, priority) {
  const form = new FormData();
  form.append('file', file);
  form.append('transforms', transforms.join(','));
  form.append('priority', priority);

  const res = await fetch(`${BASE_URL}/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.job_id;
}

/**
 * GET /status/{job_id}
 * Celery AsyncResult devuelve: { status: "PENDING"|"STARTED"|"SUCCESS"|"FAILURE", result: any }
 * Lo normalizamos al formato que espera el resto del JS.
 */
async function pollJob(jobId) {
  const res = await fetch(`${BASE_URL}/status/${jobId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  const statusMap = {
    'PENDING': 'queued',
    'STARTED': 'processing',
    'RETRY':   'processing',
    'SUCCESS': 'done',
    'FAILURE': 'error',
  };

  const normalized = statusMap[data.status] || 'queued';

  return {
    status:     normalized,
    result_url: normalized === 'done'  ? `/files/${data.result}` : null,
    error:      normalized === 'error' ? String(data.result)     : null,
    progress:   normalized === 'processing' ? 50 : undefined,
  };
}

/**
 * Health ping: GET /
 * Si responde 200 el servidor está vivo.
 */
async function fetchHealth() {
  const res = await fetch(`${BASE_URL}/`);
  if (!res.ok) throw new Error('Server unreachable');
  return {
    status:  'ok',
    workers: state.workerCount,
    queue:   state.jobs.filter(j => j.status === 'queued').length,
  };
}

/* ============================================================
   JOB MANAGEMENT
============================================================ */
function addJob(jobId, transforms) {
  const job = {
    id:        jobId,
    name:      state.file.name,
    size:      state.file.size,
    thumb:     previewImg.src,
    transforms,
    priority:  state.priority,
    status:    'queued',
    progress:  0,
    logs:      [{ t: Date.now(), msg: 'Job enqueued', type: '' }],
    createdAt: Date.now(),
    resultUrl: null,
  };

  state.jobs.unshift(job);
  renderQueue();
  startPolling(job);
  updateMetrics();
}

function removeJob(jobId) {
  stopPolling(jobId);
  state.jobs = state.jobs.filter(j => j.id !== jobId);
  renderQueue();
  updateMetrics();
}

clearBtn.addEventListener('click', () => {
  state.jobs.forEach(j => stopPolling(j.id));
  state.jobs = [];
  renderQueue();
  updateMetrics();
  toast('Queue cleared', 'info');
});

/* ============================================================
   POLLING
============================================================ */
function startPolling(job) {
  if (state.polling[job.id]) return;

  state.polling[job.id] = setInterval(async () => {
    try {
      const data = await pollJob(job.id);
      updateJobFromPoll(job.id, data);
    } catch (e) {
      updateJobStatus(job.id, 'error', 0);
      stopPolling(job.id);
      toast(`Polling error for ${shortId(job.id)}: ${e.message}`, 'error');
    }
  }, 1500);
}

function stopPolling(jobId) {
  clearInterval(state.polling[jobId]);
  delete state.polling[jobId];
}

function updateJobFromPoll(jobId, data) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;

  const prev = job.status;

  if (data.status === 'queued') {
    job.status   = 'queued';
    job.progress = 0;

  } else if (data.status === 'processing') {
    job.status   = 'processing';
    job.progress = data.progress || 50;
    if (prev !== 'processing') {
      job.logs.push({ t: Date.now(), msg: 'Worker picked up job', type: 'proc' });
    }

  } else if (data.status === 'done') {
    job.status    = 'done';
    job.progress  = 100;
    job.resultUrl = data.result_url || null;
    job.logs.push({ t: Date.now(), msg: 'Processing complete ✓', type: 'ok' });
    stopPolling(jobId);
    toast(`Job ${shortId(jobId)} completed`, 'success');

  } else if (data.status === 'error') {
    job.status   = 'error';
    job.progress = 0;
    job.logs.push({ t: Date.now(), msg: 'Error: ' + (data.error || 'Unknown'), type: 'err' });
    stopPolling(jobId);
    toast(`Job ${shortId(jobId)} failed`, 'error');
  }

  renderJobCard(job);
  updateMetrics();
  updateHpa();
}

function updateJobStatus(jobId, status, progress) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;
  job.status   = status;
  job.progress = progress;
  renderJobCard(job);
}

/* ============================================================
   RENDER
============================================================ */
function renderQueue() {
  [...queueList.querySelectorAll('.job-card')].forEach(el => el.remove());

  if (state.jobs.length === 0) {
    queueEmpty.style.display = 'flex';
  } else {
    queueEmpty.style.display = 'none';
    state.jobs.forEach(job => queueList.appendChild(buildJobCard(job)));
  }
}

function renderJobCard(job) {
  const existing = queueList.querySelector(`[data-job-id="${job.id}"]`);
  if (!existing) return;
  existing.replaceWith(buildJobCard(job));
}

function buildJobCard(job) {
  const card = document.createElement('div');
  card.className = 'job-card';
  card.dataset.status = job.status;
  card.dataset.jobId  = job.id;

  const badgeClass = {
    queued:     'badge-queued',
    processing: 'badge-processing',
    done:       'badge-done',
    error:      'badge-error',
  }[job.status] || 'badge-queued';

  const progressClass = job.status === 'done' ? 'done' : job.status === 'error' ? 'error' : '';

  card.innerHTML = `
    <img class="job-thumb" src="${job.thumb}" alt="thumb" />
    <div class="job-info">
      <div class="job-name" title="${job.name}">${job.name}</div>
      <div class="job-meta">
        <span>${formatBytes(job.size)}</span>
        <span>${formatTime(job.createdAt)}</span>
        <span>${job.priority.toUpperCase()}</span>
      </div>
      <div class="job-transforms">
        ${job.transforms.map(t => `<span class="transform-tag">${t}</span>`).join('')}
      </div>
    </div>
    <div class="job-status">
      <span class="status-badge ${badgeClass}">${job.status.toUpperCase()}</span>
      <div class="job-progress ${progressClass}">
        <div class="job-progress-fill" style="width: ${job.progress}%"></div>
      </div>
    </div>
  `;

  card.addEventListener('click', () => openModal(job));
  return card;
}

/* ============================================================
   MODAL
============================================================ */
function openModal(job) {
  modalId.textContent = job.id;

  modalImages.innerHTML = `
    <div class="modal-img-wrap">
      <span class="modal-img-label">ORIGINAL</span>
      <img src="${job.thumb}" alt="original" />
    </div>
    <div class="modal-img-wrap">
      <span class="modal-img-label">RESULT</span>
      <img src="${job.resultUrl || job.thumb}"
           alt="result"
           style="${job.status !== 'done' ? 'filter: grayscale(1) opacity(0.3)' : ''}" />
    </div>
  `;

  modalMeta.innerHTML = `
    <div class="meta-item"><span class="meta-key">FILE</span><span class="meta-val">${job.name}</span></div>
    <div class="meta-item"><span class="meta-key">SIZE</span><span class="meta-val">${formatBytes(job.size)}</span></div>
    <div class="meta-item"><span class="meta-key">PRIORITY</span><span class="meta-val">${job.priority.toUpperCase()}</span></div>
    <div class="meta-item"><span class="meta-key">STATUS</span><span class="meta-val">${job.status.toUpperCase()}</span></div>
    <div class="meta-item"><span class="meta-key">TRANSFORMS</span><span class="meta-val">${job.transforms.join(', ')}</span></div>
    <div class="meta-item"><span class="meta-key">JOB ID</span><span class="meta-val" style="font-size:0.6rem">${shortId(job.id)}</span></div>
  `;

  modalLog.innerHTML = job.logs
    .map(l => `<div class="log-line">
      <span class="log-time">${formatTime(l.t)}</span>
      <span class="log-msg ${l.type}">${l.msg}</span>
    </div>`)
    .join('');

  modalActions.innerHTML = '';

  if (job.status === 'done' && job.resultUrl) {
    const dl = document.createElement('a');
    dl.href        = job.resultUrl;
    dl.download    = 'result_' + job.name;
    dl.className   = 'btn btn-primary';
    dl.textContent = 'DOWNLOAD RESULT';
    modalActions.appendChild(dl);
  }

  const delBtn = document.createElement('button');
  delBtn.className   = 'btn btn-danger';
  delBtn.textContent = 'REMOVE JOB';
  delBtn.addEventListener('click', () => {
    removeJob(job.id);
    closeModal();
    toast('Job removed', 'info');
  });
  modalActions.appendChild(delBtn);

  const closeGhost = document.createElement('button');
  closeGhost.className   = 'btn btn-ghost';
  closeGhost.textContent = 'CLOSE';
  closeGhost.addEventListener('click', closeModal);
  modalActions.appendChild(closeGhost);

  modalOverlay.classList.add('open');
}

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

function closeModal() {
  modalOverlay.classList.remove('open');
}

/* ============================================================
   TOAST
============================================================ */
function toast(msg, type = 'info') {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span class="toast-msg">${msg}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 350);
  }, 3500);
}

/* ============================================================
   HEALTH CHECK & HEADER METRICS
============================================================ */
async function checkHealth() {
  try {
    const data = await fetchHealth();
    clusterDot.className     = 'status-dot online';
    clusterLabel.textContent = 'CLUSTER ONLINE';
    workerCount.textContent  = data.workers ?? '—';
    queueCount.textContent   = data.queue   ?? '—';
  } catch {
    clusterDot.className     = 'status-dot offline';
    clusterLabel.textContent = 'CLUSTER OFFLINE';
    workerCount.textContent  = '—';
    queueCount.textContent   = '—';
  }
}

function updateMetrics() {
  jobCount.textContent   = state.jobs.length;
  queueCount.textContent = state.jobs.filter(j => j.status === 'queued').length;
}

/* ============================================================
   HPA — driven by real job states
============================================================ */
function updateHpa() {
  const processing = state.jobs.filter(j => j.status === 'processing').length;
  const queued     = state.jobs.filter(j => j.status === 'queued').length;

  // Replica estimate: 1 worker per 2 active jobs, min 1, max 10
  const replicas = Math.max(1, Math.min(10, Math.ceil((processing + queued) / 2)));
  state.workerCount = replicas;

  // CPU estimate: proportional to processing jobs (visual only)
  const cpuTarget = processing > 0 ? Math.min(95, 15 + processing * 20) : 5;
  state.cpuLoad = state.cpuLoad + (cpuTarget - state.cpuLoad) * 0.4;

  renderHpa(replicas, state.cpuLoad);
}

function renderHpa(replicas, cpu) {
  const MAX = 10;
  hpaReplicas.innerHTML = '';

  for (let i = 1; i <= MAX; i++) {
    const dot = document.createElement('div');
    dot.className = 'replica-dot';
    dot.dataset.num = i;
    if (i <= replicas) dot.classList.add(cpu > 60 ? 'busy' : 'active');
    hpaReplicas.appendChild(dot);
  }

  const maxLabel = document.createElement('span');
  maxLabel.className   = 'replica-max mono';
  maxLabel.textContent = `/ ${MAX} max`;
  hpaReplicas.appendChild(maxLabel);

  const pct = Math.round(cpu);
  cpuFill.style.width      = pct + '%';
  cpuFill.style.background = cpu > 80 ? 'var(--red)' : cpu > 60 ? 'var(--accent2)' : 'var(--accent4)';
  cpuVal.textContent        = pct + '%';
  workerCount.textContent   = replicas;
}

/* ============================================================
   INIT
============================================================ */
(function init() {
  renderHpa(1, 0);
  checkHealth();
  setInterval(checkHealth, 10000);
})();