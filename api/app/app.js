/**
 * image-processor-k8s — app.js
 *
 * All API calls target:
 *   POST   /upload            → { job_id, status }
 *   GET    /result/{job_id}   → { status, result_url?, error? }
 *   GET    /files/{filename}  → binary image
 *   GET    /healthz           → { status: "ok", workers, queue }
 *
 * Change BASE_URL to point to your actual cluster ingress.
 */

const BASE_URL = 'http://image-processor.local'; // ← change if needed

/* ============================================================
   STATE
============================================================ */
const state = {
  file:     null,
  priority: 'normal',
  jobs:     [],          // [{ id, name, size, thumb, transforms, priority, status, progress, logs, createdAt, resultUrl }]
  polling:  {},          // { [job_id]: intervalId }
  mockWorkers: 1,
  mockCpu:     0,
};

/* ============================================================
   DOM REFS
============================================================ */
const $ = id => document.getElementById(id);

const dropzone     = $('dropzone');
const dropInner    = $('dropInner');
const dropPreview  = $('dropPreview');
const previewImg   = $('previewImg');
const previewName  = $('previewName');
const previewSize  = $('previewSize');
const previewClear = $('previewClear');
const fileInput    = $('fileInput');
const submitBtn    = $('submitBtn');
const queueList    = $('queueList');
const queueEmpty   = $('queueEmpty');
const clearBtn     = $('clearBtn');
const clusterDot   = $('clusterDot');
const clusterLabel = $('clusterLabel');
const workerCount  = $('workerCount');
const queueCount   = $('queueCount');
const jobCount     = $('jobCount');
const hpaReplicas  = $('hpaReplicas');
const cpuFill      = $('cpuFill');
const cpuVal       = $('cpuVal');
const toastContainer = $('toastContainer');
const modalOverlay = $('modalOverlay');
const modalClose   = $('modalClose');
const modalId      = $('modalId');
const modalImages  = $('modalImages');
const modalMeta    = $('modalMeta');
const modalLog     = $('modalLog');
const modalActions = $('modalActions');

/* ============================================================
   UTILS
============================================================ */
function formatBytes(bytes) {
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1048576)    return (bytes / 1024).toFixed(1) + ' KB';
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
   API CALLS
============================================================ */

/**
 * Real implementation — uncomment when your cluster is live.
 *
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

async function pollJob(jobId) {
  const res = await fetch(`${BASE_URL}/result/${jobId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json(); // { status, result_url?, error? }
}

async function fetchHealth() {
  const res = await fetch(`${BASE_URL}/healthz`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json(); // { status, workers, queue }
}
 */

/* ---- MOCK API (remove when cluster is live) ---- */

async function uploadImage(file, transforms, priority) {
  await delay(600 + Math.random() * 400);
  return crypto.randomUUID();
}

async function pollJob(jobId) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return { status: 'error', error: 'Not found' };

  const elapsed = Date.now() - job.createdAt;
  const processingTime = 3000 + Math.random() * 4000;

  if (elapsed < 800)             return { status: 'queued' };
  if (elapsed < processingTime)  return { status: 'processing', progress: Math.min(95, Math.round((elapsed - 800) / (processingTime - 800) * 100)) };

  // Simulate 8% error rate
  if (!job._resolved) {
    job._resolved = true;
    job._success  = Math.random() > 0.08;
  }

  if (job._success) {
    return { status: 'done', result_url: job.thumb }; // reuse thumb as mock result
  } else {
    return { status: 'error', error: 'Worker encountered an unexpected error.' };
  }
}

async function fetchHealth() {
  await delay(200);
  return { status: 'ok', workers: state.mockWorkers, queue: state.jobs.filter(j => j.status === 'queued').length };
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
/* ---- end mock ---- */

/* ============================================================
   JOB MANAGEMENT
============================================================ */
function addJob(jobId, transforms) {
  const job = {
    id:         jobId,
    name:       state.file.name,
    size:       state.file.size,
    thumb:      previewImg.src,
    transforms,
    priority:   state.priority,
    status:     'queued',
    progress:   0,
    logs:       [{ t: Date.now(), msg: 'Job enqueued', type: '' }],
    createdAt:  Date.now(),
    resultUrl:  null,
    _resolved:  false,
    _success:   false,
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
  const ids = state.jobs.map(j => j.id);
  ids.forEach(id => stopPolling(id));
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
    }
  }, 1200);
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
    job.status  = 'error';
    job.progress = 0;
    job.logs.push({ t: Date.now(), msg: 'Error: ' + (data.error || 'Unknown'), type: 'err' });
    stopPolling(jobId);
    toast(`Job ${shortId(jobId)} failed`, 'error');
  }

  renderJobCard(job);
  updateMetrics();
  simulateHpa();
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
  // Remove all cards (keep empty placeholder)
  [...queueList.querySelectorAll('.job-card')].forEach(el => el.remove());

  if (state.jobs.length === 0) {
    queueEmpty.style.display = 'flex';
  } else {
    queueEmpty.style.display = 'none';
    state.jobs.forEach(job => {
      const card = buildJobCard(job);
      queueList.appendChild(card);
    });
  }
}

function renderJobCard(job) {
  const existing = queueList.querySelector(`[data-job-id="${job.id}"]`);
  if (!existing) return;
  const fresh = buildJobCard(job);
  existing.replaceWith(fresh);
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

  // Images
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

  // Metadata
  modalMeta.innerHTML = `
    <div class="meta-item"><span class="meta-key">FILE</span><span class="meta-val">${job.name}</span></div>
    <div class="meta-item"><span class="meta-key">SIZE</span><span class="meta-val">${formatBytes(job.size)}</span></div>
    <div class="meta-item"><span class="meta-key">PRIORITY</span><span class="meta-val">${job.priority.toUpperCase()}</span></div>
    <div class="meta-item"><span class="meta-key">STATUS</span><span class="meta-val">${job.status.toUpperCase()}</span></div>
    <div class="meta-item"><span class="meta-key">TRANSFORMS</span><span class="meta-val">${job.transforms.join(', ')}</span></div>
    <div class="meta-item"><span class="meta-key">JOB ID</span><span class="meta-val" style="font-size:0.6rem">${shortId(job.id)}</span></div>
  `;

  // Log
  modalLog.innerHTML = job.logs
    .map(l => `<div class="log-line">
      <span class="log-time">${formatTime(l.t)}</span>
      <span class="log-msg ${l.type}">${l.msg}</span>
    </div>`)
    .join('');

  // Actions
  modalActions.innerHTML = '';

  if (job.status === 'done' && job.resultUrl) {
    const dl = document.createElement('a');
    dl.href     = job.resultUrl;
    dl.download = 'result_' + job.name;
    dl.className = 'btn btn-primary';
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

modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) closeModal();
});

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
    clusterDot.className   = 'status-dot online';
    clusterLabel.textContent = 'CLUSTER ONLINE';
    workerCount.textContent  = data.workers ?? '—';
    queueCount.textContent   = data.queue   ?? '—';
    state.mockWorkers = data.workers ?? 1;
  } catch {
    clusterDot.className     = 'status-dot offline';
    clusterLabel.textContent = 'CLUSTER OFFLINE';
    workerCount.textContent  = '—';
    queueCount.textContent   = '—';
  }
}

function updateMetrics() {
  jobCount.textContent = state.jobs.length;
  queueCount.textContent = state.jobs.filter(j => j.status === 'queued').length;
}

/* ============================================================
   HPA SIMULATION
============================================================ */
function simulateHpa() {
  const processing = state.jobs.filter(j => j.status === 'processing').length;

  // Target workers = clamp between 1 and 10
  const target = Math.max(1, Math.min(10, Math.ceil(processing / 2) + 1));
  state.mockWorkers = target;

  // CPU: simulate load proportional to processing jobs
  const cpuTarget = processing > 0
    ? Math.min(95, 20 + processing * 15 + Math.random() * 10)
    : Math.max(5, Math.random() * 18);

  // Smooth approach
  state.mockCpu = state.mockCpu + (cpuTarget - state.mockCpu) * 0.3;

  renderHpa(target, state.mockCpu);
}

function renderHpa(replicas, cpu) {
  const MAX = 10;
  hpaReplicas.innerHTML = '';

  for (let i = 1; i <= MAX; i++) {
    const dot = document.createElement('div');
    dot.className = 'replica-dot';
    dot.dataset.num = i;
    if (i <= replicas) {
      dot.classList.add(cpu > 60 ? 'busy' : 'active');
    }
    hpaReplicas.appendChild(dot);
  }

  const maxLabel = document.createElement('span');
  maxLabel.className   = 'replica-max mono';
  maxLabel.textContent = `/ ${MAX} max`;
  hpaReplicas.appendChild(maxLabel);

  const pct = Math.round(cpu);
  cpuFill.style.width = pct + '%';
  cpuFill.style.background = cpu > 80 ? 'var(--red)' : cpu > 60 ? 'var(--accent2)' : 'var(--accent4)';
  cpuVal.textContent = pct + '%';
  workerCount.textContent = replicas;
}

/* ============================================================
   INIT
============================================================ */
(function init() {
  renderHpa(1, 0);
  checkHealth();
  setInterval(checkHealth,   10000);
  setInterval(simulateHpa,   2000);
})();