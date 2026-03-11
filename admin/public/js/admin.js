// ---- State ----
let videoFiles = [];
let thumbFiles = [];
let activeTranscodes = new Map();

// ---- Tabs ----
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ---- Toast ----
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2500);
}

// ---- Modal ----
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', (e) => {
    if (e.target === el) el.classList.add('hidden');
  });
});

// ---- Logout ----
document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

// ---- Transcode Polling ----
function pollTranscode(jobId, filename) {
  activeTranscodes.set(jobId, { filename, status: 'queued', progress: 0 });
  renderTranscodeStatus();

  const interval = setInterval(async () => {
    try {
      const res = await fetch(`/api/transcode/${jobId}`);
      const job = await res.json();
      activeTranscodes.set(jobId, { filename, ...job });
      renderTranscodeStatus();

      if (job.status === 'done') {
        clearInterval(interval);
        toast(`Transcode complete: ${filename}`);
        setTimeout(() => {
          activeTranscodes.delete(jobId);
          renderTranscodeStatus();
        }, 3000);
        loadVideoFiles();
        loadThumbFiles(); // Reload thumbs to pick up auto-generated thumbnail
      } else if (job.status === 'error') {
        clearInterval(interval);
        toast(`Transcode failed: ${job.error}`);
        setTimeout(() => {
          activeTranscodes.delete(jobId);
          renderTranscodeStatus();
        }, 5000);
      }
    } catch (e) {
      clearInterval(interval);
    }
  }, 2000);
}

function renderTranscodeStatus() {
  const el = document.getElementById('transcode-status');
  if (!el) return;

  if (activeTranscodes.size === 0) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = Array.from(activeTranscodes.entries()).map(([id, job]) => {
    const statusText = job.status === 'done' ? 'COMPLETE'
      : job.status === 'error' ? 'FAILED'
      : job.status === 'generating_thumbnail' ? 'GENERATING THUMBNAIL'
      : job.status === 'transcoding' ? `TRANSCODING ${job.progress || 0}%`
      : job.status === 'probing' ? 'ANALYZING'
      : 'QUEUED';

    const statusClass = job.status === 'done' ? 'status-active'
      : job.status === 'error' ? 'status-inactive'
      : '';

    return `
      <div class="transcode-job">
        <div class="transcode-job-name">${job.filename}</div>
        <div class="transcode-job-status">
          <span class="${statusClass}">${statusText}</span>
        </div>
        ${job.status === 'transcoding' ? `
          <div class="upload-progress-bar" style="margin-top:6px">
            <div class="upload-progress-filled" style="width:${job.progress || 0}%"></div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// ---- File Upload ----
function setupUpload(zoneId, inputId, progressId, filledId, textId, endpoint, onDone) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  const progressWrap = document.getElementById(progressId);
  const filled = document.getElementById(filledId);
  const text = document.getElementById(textId);

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
  });

  input.addEventListener('change', () => {
    if (input.files.length) uploadFile(input.files[0]);
  });

  function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint);

    progressWrap.style.display = 'block';
    filled.style.width = '0%';

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        filled.style.width = pct + '%';
        const sizeMB = (e.loaded / 1024 / 1024).toFixed(1);
        const totalMB = (e.total / 1024 / 1024).toFixed(1);
        text.textContent = `Uploading: ${sizeMB} MB / ${totalMB} MB  (${pct}%)`;
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);

        if (data.transcodeId) {
          // Video upload — show transcode progress
          text.textContent = `Upload complete — transcoding to H.264/AAC...`;
          filled.style.width = '100%';
          pollTranscode(data.transcodeId, data.filename);
          setTimeout(() => { progressWrap.style.display = 'none'; }, 2000);
        } else {
          toast(`Uploaded: ${data.filename}`);
          setTimeout(() => { progressWrap.style.display = 'none'; }, 1500);
        }
        onDone();
      } else {
        toast('Upload failed');
        setTimeout(() => { progressWrap.style.display = 'none'; }, 1500);
      }
      input.value = '';
    });

    xhr.addEventListener('error', () => {
      toast('Upload failed');
      progressWrap.style.display = 'none';
      input.value = '';
    });

    xhr.send(formData);
  }
}

setupUpload(
  'video-upload-zone', 'video-file-input',
  'video-upload-progress', 'video-progress-filled', 'video-progress-text',
  '/api/upload/video', loadVideoFiles
);

setupUpload(
  'thumb-upload-zone', 'thumb-file-input',
  'thumb-upload-progress', 'thumb-progress-filled', 'thumb-progress-text',
  '/api/upload/thumb', loadThumbFiles
);

// ---- Load Files ----
async function loadVideoFiles() {
  const res = await fetch('/api/files/videos');
  videoFiles = await res.json();
  renderVideoFileList();
  populateVideoSelects();
}

async function loadThumbFiles() {
  const res = await fetch('/api/files/thumbs');
  thumbFiles = await res.json();
  renderThumbFileList();
  populateThumbSelects();
}

function formatSize(bytes) {
  if (bytes > 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(0) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

function renderVideoFileList() {
  const el = document.getElementById('video-file-list');
  el.innerHTML = videoFiles.map(f =>
    `<div class="file-chip">${f.name} (${formatSize(f.size)})</div>`
  ).join('');
}

function renderThumbFileList() {
  const el = document.getElementById('thumb-file-list');
  el.innerHTML = thumbFiles.map(f =>
    `<div class="file-chip">${f.name} (${formatSize(f.size)})</div>`
  ).join('');
}

function populateVideoSelects() {
  document.querySelectorAll('#film-video, #project-video').forEach(sel => {
    const val = sel.value;
    sel.innerHTML = '<option value="">Select video...</option>' +
      videoFiles.map(f => `<option value="${f.path}">${f.name} (${formatSize(f.size)})</option>`).join('');
    sel.value = val;
  });
}

function populateThumbSelects() {
  const sel = document.getElementById('film-thumb');
  if (!sel) return;
  const val = sel.value;
  sel.innerHTML = '<option value="">Auto-generated thumbnail</option>' +
    thumbFiles.map(f => `<option value="${f.path}">${f.name} (${formatSize(f.size)})</option>`).join('');
  sel.value = val;
}

// Show/hide thumbnail preview when video or thumb selection changes
function updateThumbPreview() {
  const videoSel = document.getElementById('film-video');
  const thumbSel = document.getElementById('film-thumb');
  const preview = document.getElementById('thumb-preview');
  const previewImg = document.getElementById('thumb-preview-img');
  const previewLabel = document.querySelector('.thumb-preview-label');
  if (!preview) return;

  // If user explicitly chose a thumbnail, show that
  if (thumbSel.value) {
    preview.style.display = 'block';
    previewImg.src = thumbSel.value;
    previewLabel.textContent = 'Manual thumbnail selected';
    return;
  }

  // Otherwise try to show the auto-generated one matching the video
  if (videoSel.value) {
    const videoName = videoSel.value.split('/').pop().replace(/\.[^.]+$/, '');
    const autoThumb = thumbFiles.find(f => f.name === videoName + '_thumb.jpg');
    if (autoThumb) {
      preview.style.display = 'block';
      previewImg.src = autoThumb.path;
      previewLabel.textContent = 'Auto-generated — change above to override';
      return;
    }
  }

  preview.style.display = 'none';
}

// ---- Films ----
async function loadFilms() {
  const res = await fetch('/api/films');
  const films = await res.json();
  const el = document.getElementById('films-list');

  if (films.length === 0) {
    el.innerHTML = '<div class="admin-empty"><p>// No films added yet</p></div>';
    return;
  }

  el.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Title</th><th>Category</th><th>Year</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
        ${films.map(f => `
          <tr>
            <td>${f.title}</td>
            <td style="font-family:var(--mono);font-size:11px;color:var(--text-muted);letter-spacing:1px">${f.category}</td>
            <td style="font-family:var(--mono);font-size:11px;color:var(--text-muted)">${f.year}</td>
            <td>
              <span class="${f.public ? 'status-active' : 'status-inactive'}">${f.public ? 'PUBLIC' : 'HIDDEN'}</span>
            </td>
            <td style="text-align:right">
              <button class="btn btn-sm" onclick="editFilm('${f.slug}')">Edit</button>
              <button class="btn btn-sm" onclick="toggleFilm('${f.slug}', ${!f.public})">${f.public ? 'Hide' : 'Show'}</button>
              <button class="btn btn-sm btn-danger" onclick="deleteFilm('${f.slug}')">Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

document.getElementById('btn-add-film').addEventListener('click', () => {
  document.getElementById('film-form').reset();
  document.getElementById('film-edit-slug').value = '';
  document.getElementById('film-modal-title').textContent = 'Add Film';
  document.getElementById('film-submit-btn').textContent = 'Save Film';
  document.getElementById('film-slug').disabled = false;
  document.getElementById('film-year').value = new Date().getFullYear();
  delete document.getElementById('film-slug').dataset.manual;
  populateVideoSelects();
  populateThumbSelects();
  updateThumbPreview();
  openModal('film-modal');
});

async function editFilm(slug) {
  const res = await fetch('/api/films');
  const films = await res.json();
  const film = films.find(f => f.slug === slug);
  if (!film) return toast('Film not found');

  document.getElementById('film-edit-slug').value = slug;
  document.getElementById('film-modal-title').textContent = 'Edit Film';
  document.getElementById('film-submit-btn').textContent = 'Update Film';
  document.getElementById('film-title').value = film.title;
  document.getElementById('film-slug').value = film.slug;
  document.getElementById('film-slug').disabled = true;
  document.getElementById('film-slug').dataset.manual = '1';
  document.getElementById('film-category').value = film.category || '';
  document.getElementById('film-year').value = film.year || new Date().getFullYear();
  document.getElementById('film-description').value = film.description || '';

  populateVideoSelects();
  populateThumbSelects();

  // Set selected video/thumb after populating
  document.getElementById('film-video').value = film.video || '';
  document.getElementById('film-thumb').value = film.thumbnail || '';

  updateThumbPreview();
  openModal('film-modal');
}

// Update preview when video or thumbnail selection changes
document.getElementById('film-video').addEventListener('change', updateThumbPreview);
document.getElementById('film-thumb').addEventListener('change', updateThumbPreview);

// Auto-generate slug from title
document.getElementById('film-title').addEventListener('input', (e) => {
  const slugField = document.getElementById('film-slug');
  if (!slugField.dataset.manual) {
    slugField.value = e.target.value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
});

document.getElementById('film-slug').addEventListener('input', function() {
  this.dataset.manual = '1';
});

document.getElementById('film-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  // Resolve thumbnail: manual choice > auto-generated > empty
  let thumbnail = document.getElementById('film-thumb').value;
  if (!thumbnail) {
    const videoPath = document.getElementById('film-video').value;
    if (videoPath) {
      const videoName = videoPath.split('/').pop().replace(/\.[^.]+$/, '');
      const autoThumb = thumbFiles.find(f => f.name === videoName + '_thumb.jpg');
      if (autoThumb) thumbnail = autoThumb.path;
    }
  }

  const editSlug = document.getElementById('film-edit-slug').value;
  const isEdit = !!editSlug;

  const data = {
    title: document.getElementById('film-title').value,
    category: document.getElementById('film-category').value,
    year: document.getElementById('film-year').value,
    description: document.getElementById('film-description').value,
    video: document.getElementById('film-video').value,
    thumbnail,
  };

  if (!isEdit) {
    data.slug = document.getElementById('film-slug').value;
  }

  const url = isEdit ? `/api/films/${editSlug}` : '/api/films';
  const method = isEdit ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  if (res.ok) {
    closeModal('film-modal');
    toast(isEdit ? 'Film updated' : 'Film added');
    loadFilms();
  } else {
    const err = await res.json();
    toast(err.error || (isEdit ? 'Error updating film' : 'Error adding film'));
  }
});

async function toggleFilm(slug, pub) {
  await fetch(`/api/films/${slug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public: pub })
  });
  loadFilms();
}

async function deleteFilm(slug) {
  if (!confirm('Delete this film?')) return;
  await fetch(`/api/films/${slug}`, { method: 'DELETE' });
  toast('Film deleted');
  loadFilms();
}

// ---- Projects ----
async function loadProjects() {
  const res = await fetch('/api/projects');
  const projects = await res.json();
  const el = document.getElementById('projects-list');

  if (projects.length === 0) {
    el.innerHTML = '<div class="admin-empty"><p>// No client projects yet</p></div>';
    return;
  }

  const baseUrl = window.location.origin;

  el.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Title</th><th>Screening Link</th><th>Created</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
        ${projects.map(p => `
          <tr>
            <td>${p.title}</td>
            <td>
              <span class="link-copy" onclick="copyLink('${baseUrl}/screening.html?id=${p.uuid}')" title="Click to copy">
                /screening?id=${p.uuid}
              </span>
            </td>
            <td style="font-family:var(--mono);font-size:11px;color:var(--text-muted)">${p.created}</td>
            <td>
              <span class="${p.active ? 'status-active' : 'status-inactive'}">${p.active ? 'ACTIVE' : 'DISABLED'}</span>
            </td>
            <td style="text-align:right">
              <button class="btn btn-sm" onclick="editProject('${p.uuid}')">Edit</button>
              <button class="btn btn-sm" onclick="toggleProject('${p.uuid}', ${!p.active})">${p.active ? 'Disable' : 'Enable'}</button>
              <button class="btn btn-sm btn-danger" onclick="deleteProject('${p.uuid}')">Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

document.getElementById('btn-add-project').addEventListener('click', () => {
  document.getElementById('project-form').reset();
  document.getElementById('project-edit-uuid').value = '';
  document.getElementById('project-modal-title').textContent = 'Add Client Project';
  document.getElementById('project-submit-btn').textContent = 'Create Project';
  populateVideoSelects();
  openModal('project-modal');
});

async function editProject(uuid) {
  const res = await fetch('/api/projects');
  const projects = await res.json();
  const project = projects.find(p => p.uuid === uuid);
  if (!project) return toast('Project not found');

  document.getElementById('project-edit-uuid').value = uuid;
  document.getElementById('project-modal-title').textContent = 'Edit Project';
  document.getElementById('project-submit-btn').textContent = 'Update Project';
  document.getElementById('project-title').value = project.title;

  populateVideoSelects();
  document.getElementById('project-video').value = project.video || '';

  openModal('project-modal');
}

document.getElementById('project-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const editUuid = document.getElementById('project-edit-uuid').value;
  const isEdit = !!editUuid;

  const data = {
    title: document.getElementById('project-title').value,
    video: document.getElementById('project-video').value,
  };

  const url = isEdit ? `/api/projects/${editUuid}` : '/api/projects';
  const method = isEdit ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  if (res.ok) {
    const project = await res.json();
    closeModal('project-modal');
    if (isEdit) {
      toast('Project updated');
    } else {
      const link = `${window.location.origin}/screening.html?id=${project.uuid}`;
      toast('Project created — link copied');
      copyLink(link);
    }
    loadProjects();
  } else {
    const err = await res.json();
    toast(err.error || (isEdit ? 'Error updating project' : 'Error creating project'));
  }
});

async function toggleProject(uuid, active) {
  await fetch(`/api/projects/${uuid}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active })
  });
  loadProjects();
}

async function deleteProject(uuid) {
  if (!confirm('Delete this project?')) return;
  await fetch(`/api/projects/${uuid}`, { method: 'DELETE' });
  toast('Project deleted');
  loadProjects();
}

function copyLink(url) {
  navigator.clipboard.writeText(url).then(() => {
    toast('Link copied');
  });
}

// ---- Init ----
loadFilms();
loadProjects();
loadVideoFiles();
loadThumbFiles();
