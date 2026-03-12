// ---- State ----
let videoFiles = [];
let thumbFiles = [];
let modalTranscodeId = null;     // active transcode job in the film modal
let modalVideoPath = null;       // resolved video path after transcode
let modalTranscodeInterval = null;

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
  // Clean up transcode polling if closing film modal
  if (id === 'film-modal') {
    clearModalTranscode();
  }
}

function clearModalTranscode() {
  if (modalTranscodeInterval) {
    clearInterval(modalTranscodeInterval);
    modalTranscodeInterval = null;
  }
  modalTranscodeId = null;
  modalVideoPath = null;
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', (e) => {
    if (e.target === el) {
      if (el.id === 'film-modal') clearModalTranscode();
      el.classList.add('hidden');
    }
  });
});

// ---- Logout ----
document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

// ---- Helpers ----
function formatSize(bytes) {
  if (bytes > 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(0) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

function titleFromFilename(filename) {
  return filename
    .replace(/\.[^.]+$/, '')         // strip extension
    .replace(/[-_]+/g, ' ')          // dashes/underscores → spaces
    .replace(/\b\w/g, c => c.toUpperCase()); // title case
}

// ---- Film Modal: Video Upload ----
const filmVideoBtn = document.getElementById('film-video-btn');
const filmVideoInput = document.getElementById('film-video-input');
const filmVideoName = document.getElementById('film-video-name');
const filmProgressWrap = document.getElementById('film-upload-progress');
const filmProgressFilled = document.getElementById('film-progress-filled');
const filmProgressText = document.getElementById('film-progress-text');
const filmSubmitBtn = document.getElementById('film-submit-btn');

filmVideoBtn.addEventListener('click', () => {
  filmVideoInput.click();
});

filmVideoInput.addEventListener('change', () => {
  if (filmVideoInput.files.length) {
    uploadVideoInModal(filmVideoInput.files[0]);
  }
});

function uploadVideoInModal(file) {
  // Reset any previous state
  clearModalTranscode();

  filmVideoName.textContent = file.name;
  filmVideoBtn.textContent = 'Change video...';
  filmProgressWrap.style.display = 'block';
  filmProgressFilled.style.width = '0%';
  filmProgressText.textContent = 'Uploading...';
  filmSubmitBtn.disabled = true;

  // Auto-populate title if empty
  const titleField = document.getElementById('film-title');
  if (!titleField.value.trim()) {
    titleField.value = titleFromFilename(file.name);
    titleField.dispatchEvent(new Event('input')); // trigger slug auto-gen
  }

  // Use chunked upload to avoid browser XHR stalling on large files
  uploadFileChunked(file);
}

async function uploadFileChunked(file) {
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB chunks
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const uploadId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');

  try {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      const formData = new FormData();
      // Fields MUST come before the file blob for multer to parse them
      formData.append('uploadId', uploadId);
      formData.append('chunkIndex', i.toString());
      formData.append('totalChunks', totalChunks.toString());
      formData.append('filename', safeName);
      formData.append('fileSize', file.size.toString());
      formData.append('chunk', chunk);

      const res = await fetch('/api/upload/video-chunk', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || `Chunk ${i} failed with status ${res.status}`);
      }

      // Update progress
      const uploaded = end;
      const pct = Math.round((uploaded / file.size) * 100);
      filmProgressFilled.style.width = pct + '%';
      const sizeMB = (uploaded / 1024 / 1024).toFixed(1);
      const totalMB = (file.size / 1024 / 1024).toFixed(1);
      filmProgressText.textContent = `Uploading ${sizeMB} MB / ${totalMB} MB  (${pct}%)`;

      // On final chunk, server returns transcode info
      if (i === totalChunks - 1) {
        const data = await res.json().catch(() => null);
        if (data) {
          // Re-parse since we already consumed it above...
          // Actually let's restructure
        }
      }
    }

    // All chunks sent — tell server to assemble and transcode
    const assembleRes = await fetch('/api/upload/video-assemble', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, filename: safeName }),
    });

    if (!assembleRes.ok) {
      const err = await assembleRes.json().catch(() => ({ error: 'Assembly failed' }));
      throw new Error(err.error || 'Failed to assemble video');
    }

    const data = await assembleRes.json();
    filmProgressFilled.style.width = '100%';
    filmProgressText.textContent = 'Upload complete — transcoding...';

    if (data.transcodeId) {
      pollModalTranscode(data.transcodeId, data.filename);
    }

  } catch (err) {
    console.error('Upload error:', err);
    toast('Upload failed: ' + err.message);
    filmProgressWrap.style.display = 'none';
    filmSubmitBtn.disabled = false;
  }

  filmVideoInput.value = '';
}

function pollModalTranscode(jobId, filename) {
  modalTranscodeId = jobId;

  modalTranscodeInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/transcode/${jobId}`);
      const job = await res.json();

      if (job.status === 'done') {
        clearInterval(modalTranscodeInterval);
        modalTranscodeInterval = null;
        filmSubmitBtn.disabled = false;

        // Get the output path from the job
        const videoName = filename.replace(/\.[^.]+$/, '') + '.mp4';
        modalVideoPath = `/assets/videos/${videoName}`;
        document.getElementById('film-video-path').value = modalVideoPath;

        filmProgressFilled.style.width = '100%';
        filmProgressFilled.classList.add('progress-done');
        filmProgressText.textContent = 'Saving...';

        // Reload files so thumb is available, then auto-save
        await loadThumbFiles();
        await autoSaveFilm();

      } else if (job.status === 'error') {
        clearInterval(modalTranscodeInterval);
        modalTranscodeInterval = null;
        filmProgressText.textContent = `Transcode failed: ${job.error}`;
        filmProgressFilled.classList.add('progress-error');
        filmSubmitBtn.disabled = false; // allow retry/cancel
        toast(`Transcode failed: ${job.error}`);

      } else {
        // In progress
        const statusText = job.status === 'generating_thumbnail' ? 'Generating thumbnail...'
          : job.status === 'transcoding' ? `Transcoding ${job.progress || 0}%`
          : job.status === 'probing' ? 'Analysing...'
          : 'Queued...';

        filmProgressText.textContent = statusText;

        if (job.status === 'transcoding' && job.progress) {
          filmProgressFilled.style.width = job.progress + '%';
        }
      }
    } catch (e) {
      clearInterval(modalTranscodeInterval);
      modalTranscodeInterval = null;
    }
  }, 2000);
}

// ---- Load Files (for projects dropdown + thumb resolution) ----
async function loadVideoFiles() {
  const res = await fetch('/api/files/videos');
  videoFiles = await res.json();
  populateVideoSelects();
}

async function loadThumbFiles() {
  const res = await fetch('/api/files/thumbs');
  thumbFiles = await res.json();
}

function populateVideoSelects() {
  // Only project-video uses a dropdown now
  const sel = document.getElementById('project-video');
  if (!sel) return;
  const val = sel.value;
  sel.innerHTML = '<option value="">Select video...</option>' +
    videoFiles.map(f => `<option value="${f.path}">${f.name} (${formatSize(f.size)})</option>`).join('');
  sel.value = val;
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

  const publicCount = films.filter(f => f.public).length;
  const clientCount = films.filter(f => !f.public).length;
  const catCount = new Set(films.map(f => f.category).filter(Boolean)).size;

  el.innerHTML = `
    <div class="admin-stats">
      <div class="stat-item">
        <span class="stat-value">${films.length}</span>
        <span class="stat-label">// Total</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${publicCount}</span>
        <span class="stat-label">// Public</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${clientCount}</span>
        <span class="stat-label">// Client</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${catCount}</span>
        <span class="stat-label">// Categories</span>
      </div>
    </div>
    <div class="admin-film-grid">
      ${films.map(f => `
        <div class="admin-film-card" onclick="editFilm('${f.slug}')">
          <div class="admin-card-thumb">
            ${f.thumbnail ? `<img src="${f.thumbnail}" alt="${f.title}" loading="lazy" onerror="this.style.display='none'">` : ''}
            <div class="admin-card-badges">
              <span class="admin-badge ${f.public ? 'badge-public' : 'badge-client'}">${f.public ? 'PUBLIC' : 'CLIENT'}</span>
              ${f.password_hash ? '<span class="admin-badge badge-locked">LOCKED</span>' : ''}
              ${f.eligible_for_featured ? '<span class="admin-badge badge-featured">FOTD</span>' : ''}
            </div>
          </div>
          <div class="admin-card-info">
            <div class="admin-card-title">${f.title}</div>
            <div class="admin-card-meta">${f.category || 'Uncategorised'} — ${f.year}</div>
          </div>
          <div class="admin-card-actions">
            <button class="btn btn-sm" onclick="event.stopPropagation(); editFilm('${f.slug}')">Edit</button>
            <button class="btn btn-sm" onclick="event.stopPropagation(); toggleFilm('${f.slug}', ${!f.public})">${f.public ? 'Hide' : 'Show'}</button>
            <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteFilm('${f.slug}')">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ---- Add Film (+ button) ----
document.getElementById('btn-add-film').addEventListener('click', () => {
  // Reset form
  document.getElementById('film-form').reset();
  document.getElementById('film-edit-slug').value = '';
  document.getElementById('film-video-path').value = '';
  document.getElementById('film-modal-title').textContent = 'Add Film';
  document.getElementById('film-submit-btn').textContent = 'Add Film';
  document.getElementById('film-submit-btn').disabled = true;
  document.getElementById('film-slug').disabled = false;
  document.getElementById('film-year').value = new Date().getFullYear();
  delete document.getElementById('film-slug').dataset.manual;

  // Reset video picker
  filmVideoBtn.textContent = 'Choose video file...';
  filmVideoName.textContent = '';
  filmProgressWrap.style.display = 'none';
  filmProgressFilled.style.width = '0%';
  filmProgressFilled.classList.remove('progress-done', 'progress-error');

  // Reset thumb preview
  document.getElementById('thumb-preview').style.display = 'none';

  // Reset visibility to public
  document.querySelector('input[name="film-visibility"][value="public"]').checked = true;
  document.getElementById('film-featured').checked = false;
  document.getElementById('film-password').value = '';
  document.getElementById('film-password-status').textContent = '';
  document.getElementById('film-password-group').style.display = 'none';
  document.getElementById('visibility-hint').textContent = 'Visible to everyone';

  clearModalTranscode();
  openModal('film-modal');
});

// ---- Edit Film ----
async function editFilm(slug) {
  const res = await fetch('/api/films');
  const films = await res.json();
  const film = films.find(f => f.slug === slug);
  if (!film) return toast('Film not found');

  document.getElementById('film-edit-slug').value = slug;
  document.getElementById('film-modal-title').textContent = 'Edit Film';
  document.getElementById('film-submit-btn').textContent = 'Update Film';
  document.getElementById('film-submit-btn').disabled = false;
  document.getElementById('film-title').value = film.title;
  document.getElementById('film-slug').value = film.slug;
  document.getElementById('film-slug').disabled = true;
  document.getElementById('film-slug').dataset.manual = '1';
  document.getElementById('film-category').value = film.category || '';
  document.getElementById('film-year').value = film.year || new Date().getFullYear();
  document.getElementById('film-description').value = film.description || '';

  // Set video path
  document.getElementById('film-video-path').value = film.video || '';
  modalVideoPath = film.video || null;

  // Show current video in picker
  if (film.video) {
    const videoName = film.video.split('/').pop();
    filmVideoBtn.textContent = 'Change video...';
    filmVideoName.textContent = videoName;
  } else {
    filmVideoBtn.textContent = 'Choose video file...';
    filmVideoName.textContent = '';
  }

  // Reset progress
  filmProgressWrap.style.display = 'none';
  filmProgressFilled.style.width = '0%';
  filmProgressFilled.classList.remove('progress-done', 'progress-error');

  // Set visibility: public, private (password-protected), or client
  let vis = 'public';
  if (!film.public) vis = 'client';
  else if (film.password_hash) vis = 'private';
  document.querySelector(`input[name="film-visibility"][value="${vis}"]`).checked = true;
  updateVisibilityUI(vis);
  document.getElementById('film-featured').checked = !!film.eligible_for_featured;
  document.getElementById('film-password').value = '';
  const pwStatus = document.getElementById('film-password-status');
  pwStatus.textContent = film.password_hash ? 'Currently set' : '';
  pwStatus.className = 'password-status' + (film.password_hash ? ' pw-set' : '');

  // Show thumbnail preview if available
  updateThumbPreview(film.video, film.thumbnail);

  clearModalTranscode();
  openModal('film-modal');
}

function updateThumbPreview(videoPath, thumbnailPath) {
  const preview = document.getElementById('thumb-preview');
  const previewImg = document.getElementById('thumb-preview-img');
  if (!preview) return;

  // Try manual thumbnail first
  if (thumbnailPath) {
    preview.style.display = 'block';
    previewImg.src = thumbnailPath;
    return;
  }

  // Try auto-generated
  if (videoPath) {
    const videoName = videoPath.split('/').pop().replace(/\.[^.]+$/, '');
    const autoThumb = thumbFiles.find(f => f.name === videoName + '_thumb.jpg');
    if (autoThumb) {
      preview.style.display = 'block';
      previewImg.src = autoThumb.path;
      return;
    }
  }

  preview.style.display = 'none';
}

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

// ---- Auto-save film after transcode ----
async function autoSaveFilm() {
  // Programmatically submit the form
  const form = document.getElementById('film-form');
  form.requestSubmit();
}

// ---- Film Form Submit ----
document.getElementById('film-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const videoPath = document.getElementById('film-video-path').value || modalVideoPath;

  // Resolve thumbnail: auto-generated from video
  let thumbnail = '';
  if (videoPath) {
    const videoName = videoPath.split('/').pop().replace(/\.[^.]+$/, '');
    const autoThumb = thumbFiles.find(f => f.name === videoName + '_thumb.jpg');
    if (autoThumb) thumbnail = autoThumb.path;
  }

  const editSlug = document.getElementById('film-edit-slug').value;
  const isEdit = !!editSlug;
  const visValue = document.querySelector('input[name="film-visibility"]:checked').value;
  const isPublic = visValue === 'public' || visValue === 'private';

  const data = {
    title: document.getElementById('film-title').value,
    category: document.getElementById('film-category').value,
    year: document.getElementById('film-year').value,
    description: document.getElementById('film-description').value,
    video: videoPath,
    thumbnail,
    public: isPublic,
    eligible_for_featured: document.getElementById('film-featured').checked,
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
    const savedFilm = await res.json();
    const filmSlug = savedFilm.slug || data.slug || editSlug;

    // Save password if provided
    const passwordVal = document.getElementById('film-password').value;
    if (passwordVal !== '') {
      await fetch(`/api/films/${filmSlug}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordVal })
      });
    }

    filmProgressFilled.style.width = '100%';
    filmProgressFilled.classList.add('progress-done');
    filmProgressText.textContent = 'Done ✓';
    toast(isEdit ? 'Film updated' : 'Film added');
    loadFilms();
    // Close modal after a brief pause so user sees "Done ✓"
    setTimeout(() => closeModal('film-modal'), 800);
  } else {
    const err = await res.json();
    filmProgressText.textContent = err.error || 'Error saving film';
    filmProgressFilled.classList.add('progress-error');
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
            <td style="font-family:var(--font);font-size:11px;color:var(--text-muted)">${p.created}</td>
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

// ---- Access Requests ----
async function loadRequests() {
  const res = await fetch('/api/access-requests');
  const requests = await res.json();
  const el = document.getElementById('requests-list');
  const badge = document.getElementById('requests-badge');
  const pending = requests.filter(r => r.status === 'pending');

  // Update badge
  if (pending.length > 0) {
    badge.textContent = pending.length;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }

  if (requests.length === 0) {
    el.innerHTML = '<div class="admin-empty"><p>// No access requests</p></div>';
    return;
  }

  el.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Film</th><th>Name</th><th>Email</th><th>Reason</th><th>Date</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
        ${requests.map(r => `
          <tr>
            <td style="font-family:var(--font);font-size:11px;color:var(--gold);letter-spacing:0.5px">${r.film_slug}</td>
            <td>${r.name}</td>
            <td><a href="mailto:${r.email}" style="color:var(--gold)">${r.email}</a></td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);font-size:12px">${r.reason || '—'}</td>
            <td style="font-family:var(--font);font-size:11px;color:var(--text-muted)">${r.requested_at ? r.requested_at.split('T')[0] : ''}</td>
            <td>
              <span class="${r.status === 'pending' ? 'status-pending' : r.status === 'approved' ? 'status-active' : 'status-inactive'}">${r.status.toUpperCase()}</span>
            </td>
            <td style="text-align:right">
              ${r.status === 'pending' ? `
                <button class="btn btn-sm" onclick="approveRequest(${r.id})">Approve</button>
                <button class="btn btn-sm" onclick="denyRequest(${r.id})">Deny</button>
              ` : ''}
              <button class="btn btn-sm btn-danger" onclick="deleteRequest(${r.id})">Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function approveRequest(id) {
  await fetch(`/api/access-requests/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'approved' })
  });
  toast('Request approved');
  loadRequests();
}

async function denyRequest(id) {
  await fetch(`/api/access-requests/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'denied' })
  });
  toast('Request denied');
  loadRequests();
}

async function deleteRequest(id) {
  if (!confirm('Delete this request?')) return;
  await fetch(`/api/access-requests/${id}`, { method: 'DELETE' });
  toast('Request deleted');
  loadRequests();
}

// ---- Visibility radio change ----
function updateVisibilityUI(value) {
  const hint = document.getElementById('visibility-hint');
  const pwGroup = document.getElementById('film-password-group');
  if (value === 'public') {
    hint.textContent = 'Visible to everyone';
    pwGroup.style.display = 'none';
  } else if (value === 'private') {
    hint.textContent = 'Requires a password to view';
    pwGroup.style.display = 'block';
  } else {
    hint.textContent = 'Only accessible via client screening link';
    pwGroup.style.display = 'none';
  }
}

document.querySelectorAll('input[name="film-visibility"]').forEach(radio => {
  radio.addEventListener('change', (e) => updateVisibilityUI(e.target.value));
});

// ---- Init ----
loadFilms();
loadProjects();
loadRequests();
loadVideoFiles();
loadThumbFiles();
