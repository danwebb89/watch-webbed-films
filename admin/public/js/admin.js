// ---- State ----
let videoFiles = [];
let thumbFiles = [];
let modalTranscodeId = null;     // active transcode job in the film modal
let modalVideoPath = null;       // resolved video path after transcode
let modalTranscodeInterval = null;

// Version upload state
let versionTranscodeId = null;
let versionVideoPath = null;
let versionTranscodeInterval = null;

// ---- Section Navigation ----
function showSection(name) {
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section-${name}`).classList.add('active');
  if (name === 'films') loadFilms();
  if (name === 'projects') loadProjects();
  if (name === 'home') loadHomeStats();
  if (name === 'requests') loadRequests();
}

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
  if (id === 'film-modal') clearModalTranscode();
  if (id === 'version-modal') clearVersionTranscode();
}

// Background transcode tracking
let bgTranscodeId = null;
let bgTranscodeInterval = null;
let bgTranscodeFilename = null;
let bgFormData = null; // captured form data for auto-save after bg transcode

function clearModalTranscode() {
  // If a transcode is actively running, move it to background instead of cancelling
  if (modalTranscodeInterval && modalTranscodeId) {
    bgTranscodeId = modalTranscodeId;
    bgTranscodeFilename = null;
    // Capture form data now so we can auto-save when transcode finishes
    bgFormData = captureFilmFormData();
    clearInterval(modalTranscodeInterval);
    modalTranscodeInterval = null;
    startBgTranscodePoll();
    toast('Transcoding in background — will auto-save when done');
  } else if (modalTranscodeInterval) {
    clearInterval(modalTranscodeInterval);
    modalTranscodeInterval = null;
  }
  modalTranscodeId = null;
  modalVideoPath = null;
}

function captureFilmFormData() {
  const editSlug = document.getElementById('film-edit-slug').value;
  const visValue = document.querySelector('input[name="film-visibility"]:checked')?.value || 'public';
  const isPublic = visValue === 'public' || visValue === 'private';
  return {
    isEdit: !!editSlug,
    editSlug,
    title: document.getElementById('film-title').value,
    slug: document.getElementById('film-slug').value,
    category: document.getElementById('film-category').value,
    year: document.getElementById('film-year').value,
    description: document.getElementById('film-description').value,
    public: isPublic,
    eligible_for_featured: document.getElementById('film-featured').checked,
    password: document.getElementById('film-password').value
  };
}

function startBgTranscodePoll() {
  if (bgTranscodeInterval) clearInterval(bgTranscodeInterval);
  bgTranscodeInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/transcode/${bgTranscodeId}`);
      const job = await res.json();
      if (job.status === 'done') {
        clearInterval(bgTranscodeInterval);
        bgTranscodeInterval = null;

        // Auto-save the film with the transcode results
        if (bgFormData) {
          await autoSaveFromBackground(job, bgFormData);
          bgFormData = null;
        } else {
          toast('Transcode complete');
        }
        bgTranscodeId = null;
      } else if (job.status === 'error') {
        clearInterval(bgTranscodeInterval);
        bgTranscodeInterval = null;
        toast('Background transcode failed: ' + (job.error || 'unknown'));
        bgTranscodeId = null;
        bgFormData = null;
      }
    } catch {
      clearInterval(bgTranscodeInterval);
      bgTranscodeInterval = null;
    }
  }, 3000);
}

async function autoSaveFromBackground(job, formData) {
  // Build video and thumbnail paths from transcode job
  const videoPath = `/assets/videos/${job.output}`;

  // Fetch thumb files to find the auto-generated thumbnail
  await loadThumbFiles();
  const videoName = job.output.replace(/\.[^.]+$/, '');
  const autoThumb = thumbFiles.find(f => f.name === videoName + '_thumb.jpg');
  const thumbnail = autoThumb ? autoThumb.path : (job.thumbnail || '');

  const data = {
    title: formData.title,
    category: formData.category,
    year: formData.year,
    description: formData.description,
    video: videoPath,
    thumbnail,
    public: formData.public,
    eligible_for_featured: formData.eligible_for_featured,
  };

  if (!formData.isEdit) {
    data.slug = formData.slug;
  }

  const url = formData.isEdit ? `/api/films/${formData.editSlug}` : '/api/films';
  const method = formData.isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      const savedFilm = await res.json();
      const filmSlug = savedFilm.slug || data.slug || formData.editSlug;

      // Set password if provided
      if (formData.password) {
        await fetch(`/api/films/${filmSlug}/password`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: formData.password })
        });
      }

      toast(`Film "${formData.title}" added`);
      // Refresh film list if we're on the films section
      const filmsSection = document.getElementById('section-films');
      if (filmsSection && filmsSection.classList.contains('active')) {
        loadFilms();
      }
    } else {
      const err = await res.json();
      toast('Auto-save failed: ' + (err.error || 'unknown error'));
    }
  } catch (e) {
    toast('Auto-save failed: ' + e.message);
  }
}

function clearVersionTranscode() {
  if (versionTranscodeInterval) {
    clearInterval(versionTranscodeInterval);
    versionTranscodeInterval = null;
  }
  versionTranscodeId = null;
  versionVideoPath = null;
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', (e) => {
    if (e.target === el) {
      if (el.id === 'film-modal') clearModalTranscode();
      if (el.id === 'version-modal') clearVersionTranscode();
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
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ---- Home Page Stats ----
async function loadHomeStats() {
  try {
    const [filmsRes, projectsRes, requestsRes] = await Promise.all([
      fetch('/api/films'),
      fetch('/api/projects'),
      fetch('/api/access-requests')
    ]);
    const films = await filmsRes.json();
    const projects = await projectsRes.json();
    const requests = await requestsRes.json();

    const filmsCount = document.getElementById('home-films-count');
    const projectsCount = document.getElementById('home-projects-count');
    if (filmsCount) filmsCount.textContent = films.length ? `${films.length} film${films.length !== 1 ? 's' : ''}` : '';
    if (projectsCount) projectsCount.textContent = projects.length ? `${projects.length} project${projects.length !== 1 ? 's' : ''}` : '';

    const pending = requests.filter(r => r.status === 'pending');
    const alertEl = document.getElementById('home-requests-alert');
    if (pending.length > 0) {
      alertEl.innerHTML = `
        <div class="requests-alert">
          <span class="requests-alert-text"><strong>${pending.length}</strong> pending access request${pending.length !== 1 ? 's' : ''}</span>
          <button class="btn btn-sm" onclick="showSection('requests')">Review</button>
        </div>
      `;
    } else {
      alertEl.innerHTML = '';
    }
  } catch (e) {
    console.error('Failed to load home stats:', e);
  }
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
  clearModalTranscode();
  filmVideoName.textContent = file.name;
  filmVideoBtn.textContent = 'Change video...';
  filmProgressWrap.style.display = 'block';
  filmProgressFilled.style.width = '0%';
  filmProgressText.textContent = 'Uploading...';
  filmSubmitBtn.disabled = true;

  // Update cancel button to indicate background option
  const cancelBtn = document.querySelector('#film-modal .btn-danger');
  if (cancelBtn) {
    cancelBtn.textContent = 'Continue in Background';
    cancelBtn._wasTranscoding = true;
  }

  const titleField = document.getElementById('film-title');
  if (!titleField.value.trim()) {
    titleField.value = titleFromFilename(file.name);
    titleField.dispatchEvent(new Event('input'));
  }

  uploadFileChunked(file, {
    progressFilled: filmProgressFilled,
    progressText: filmProgressText,
    progressWrap: filmProgressWrap,
    submitBtn: filmSubmitBtn,
    onTranscode: (jobId, filename) => pollModalTranscode(jobId, filename),
    onError: (err) => {
      toast('Upload failed: ' + err.message);
      filmProgressWrap.style.display = 'none';
      filmSubmitBtn.disabled = false;
    }
  });

  filmVideoInput.value = '';
}

async function uploadFileChunked(file, opts) {
  const CHUNK_SIZE = 5 * 1024 * 1024;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const uploadId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');

  try {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      const formData = new FormData();
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

      const uploaded = end;
      const pct = Math.round((uploaded / file.size) * 100);
      opts.progressFilled.style.width = pct + '%';
      const sizeMB = (uploaded / 1024 / 1024).toFixed(1);
      const totalMB = (file.size / 1024 / 1024).toFixed(1);
      opts.progressText.textContent = `Uploading ${sizeMB} MB / ${totalMB} MB  (${pct}%)`;
    }

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
    opts.progressFilled.style.width = '100%';
    opts.progressText.textContent = 'Upload complete — transcoding...';

    if (data.transcodeId) {
      opts.onTranscode(data.transcodeId, data.filename);
    }
  } catch (err) {
    console.error('Upload error:', err);
    opts.onError(err);
  }
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

        const videoName = filename.replace(/\.[^.]+$/, '') + '.mp4';
        modalVideoPath = `/assets/videos/${videoName}`;
        document.getElementById('film-video-path').value = modalVideoPath;

        filmProgressFilled.style.width = '100%';
        filmProgressFilled.classList.add('progress-done');
        filmProgressText.textContent = 'Saving...';

        await loadThumbFiles();
        await autoSaveFilm();

      } else if (job.status === 'error') {
        clearInterval(modalTranscodeInterval);
        modalTranscodeInterval = null;
        filmProgressText.textContent = `Transcode failed: ${job.error}`;
        filmProgressFilled.classList.add('progress-error');
        filmSubmitBtn.disabled = false;
        toast(`Transcode failed: ${job.error}`);

      } else {
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

// ---- Load Files ----
async function loadVideoFiles() {
  const res = await fetch('/api/files/videos');
  videoFiles = await res.json();
}

async function loadThumbFiles() {
  const res = await fetch('/api/files/thumbs');
  thumbFiles = await res.json();
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

// ---- Add Film ----
document.getElementById('btn-add-film').addEventListener('click', () => {
  document.getElementById('film-form').reset();
  document.getElementById('film-edit-slug').value = '';
  document.getElementById('film-video-path').value = '';
  document.getElementById('film-modal-title').textContent = 'Add Film';
  document.getElementById('film-submit-btn').textContent = 'Add Film';
  document.getElementById('film-submit-btn').disabled = true;
  document.getElementById('film-slug').disabled = false;
  document.getElementById('film-year').value = new Date().getFullYear();
  delete document.getElementById('film-slug').dataset.manual;

  filmVideoBtn.textContent = 'Choose video file...';
  filmVideoName.textContent = '';
  filmProgressWrap.style.display = 'none';
  filmProgressFilled.style.width = '0%';
  filmProgressFilled.classList.remove('progress-done', 'progress-error');

  // Reset cancel button text
  const cancelBtn = document.querySelector('#film-modal .btn-danger');
  if (cancelBtn) cancelBtn.textContent = 'Cancel';

  document.getElementById('thumb-preview').style.display = 'none';
  document.getElementById('thumb-options').style.display = 'none';
  document.getElementById('thumb-options-grid').innerHTML = '';
  document.getElementById('film-thumbnail-path').value = '';

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

  document.getElementById('film-video-path').value = film.video || '';
  modalVideoPath = film.video || null;

  if (film.video) {
    const videoName = film.video.split('/').pop();
    filmVideoBtn.textContent = 'Change video...';
    filmVideoName.textContent = videoName;
  } else {
    filmVideoBtn.textContent = 'Choose video file...';
    filmVideoName.textContent = '';
  }

  filmProgressWrap.style.display = 'none';
  filmProgressFilled.style.width = '0%';
  filmProgressFilled.classList.remove('progress-done', 'progress-error');

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

  updateThumbPreview(film.video, film.thumbnail);

  clearModalTranscode();
  openModal('film-modal');
}

async function updateThumbPreview(videoPath, thumbnailPath) {
  const preview = document.getElementById('thumb-preview');
  const previewImg = document.getElementById('thumb-preview-img');
  const optionsWrap = document.getElementById('thumb-options');
  const optionsGrid = document.getElementById('thumb-options-grid');
  const thumbPathInput = document.getElementById('film-thumbnail-path');
  if (!preview) return;

  // Show current thumbnail
  let currentThumb = thumbnailPath;
  if (!currentThumb && videoPath) {
    const videoName = videoPath.split('/').pop().replace(/\.[^.]+$/, '');
    const autoThumb = thumbFiles.find(f => f.name === videoName + '_thumb.jpg');
    if (autoThumb) currentThumb = autoThumb.path;
  }

  if (currentThumb) {
    preview.style.display = 'block';
    previewImg.src = currentThumb;
    if (thumbPathInput) thumbPathInput.value = currentThumb;
  } else {
    preview.style.display = 'none';
  }

  // Load thumbnail options
  if (videoPath) {
    const videoBase = videoPath.split('/').pop();
    try {
      const res = await fetch(`/api/files/thumb-options/${encodeURIComponent(videoBase)}`);
      const options = await res.json();
      if (options.length > 1) {
        optionsGrid.innerHTML = options.map(opt => `
          <img src="${opt}" alt="Option" class="thumb-option${opt === currentThumb ? ' selected' : ''}"
               onclick="selectThumbnail(this, '${opt}')" loading="lazy">
        `).join('');
        optionsWrap.style.display = 'block';
      } else {
        optionsWrap.style.display = 'none';
      }
    } catch {
      optionsWrap.style.display = 'none';
    }
  } else {
    optionsWrap.style.display = 'none';
  }
}

function selectThumbnail(imgEl, thumbPath) {
  // Update selection
  document.querySelectorAll('.thumb-option').forEach(el => el.classList.remove('selected'));
  imgEl.classList.add('selected');
  // Update preview
  document.getElementById('thumb-preview-img').src = thumbPath;
  document.getElementById('thumb-preview').style.display = 'block';
  document.getElementById('film-thumbnail-path').value = thumbPath;
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
  const form = document.getElementById('film-form');
  form.requestSubmit();
}

// ---- Film Form Submit ----
document.getElementById('film-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const videoPath = document.getElementById('film-video-path').value || modalVideoPath;

  // Use user-selected thumbnail, or fall back to auto-generated
  let thumbnail = document.getElementById('film-thumbnail-path').value || '';
  if (!thumbnail && videoPath) {
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
    <div class="project-grid">
      ${projects.map(p => `
        <div class="project-card" onclick="showProjectDetail('${p.uuid}')">
          <div class="project-card-title">${p.title}</div>
          <div class="project-card-meta">
            <span>${p.version_count || 0} version${(p.version_count || 0) !== 1 ? 's' : ''}</span>
            <span>${p.created}</span>
            <span class="${p.active ? 'status-active' : 'status-inactive'}">${p.active ? 'ACTIVE' : 'DISABLED'}</span>
          </div>
          <div class="project-card-link">/screening?id=${p.uuid}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// ---- Add Project ----
document.getElementById('btn-add-project').addEventListener('click', () => {
  document.getElementById('project-form').reset();
  document.getElementById('project-edit-uuid').value = '';
  document.getElementById('project-modal-title').textContent = 'New Client Project';
  document.getElementById('project-submit-btn').textContent = 'Create Project';
  openModal('project-modal');
});

document.getElementById('project-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const editUuid = document.getElementById('project-edit-uuid').value;
  const isEdit = !!editUuid;

  const data = {
    title: document.getElementById('project-title').value,
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
      loadProjects();
    } else {
      const link = `${window.location.origin}/screening.html?id=${project.uuid}`;
      toast('Project created — link copied');
      copyLink(link);
      // Go to the project detail to add first version
      showProjectDetail(project.uuid);
    }
  } else {
    const err = await res.json();
    toast(err.error || (isEdit ? 'Error updating project' : 'Error creating project'));
  }
});

// ---- Project Detail ----
async function showProjectDetail(uuid) {
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-project-detail').classList.add('active');

  const el = document.getElementById('project-detail-content');
  el.innerHTML = '<div class="admin-empty"><p>Loading...</p></div>';

  try {
    const [projectRes, versionsRes] = await Promise.all([
      fetch('/api/projects'),
      fetch(`/api/projects/${uuid}/versions`)
    ]);
    const projects = await projectRes.json();
    const project = projects.find(p => p.uuid === uuid);
    if (!project) {
      el.innerHTML = '<div class="admin-empty"><p>Project not found</p></div>';
      return;
    }

    const versions = await versionsRes.json();
    const baseUrl = window.location.origin;
    const screeningLink = `${baseUrl}/screening.html?id=${uuid}`;

    el.innerHTML = `
      <div class="project-detail-header">
        <div>
          <h2 class="project-detail-title">${project.title}</h2>
          <div class="project-detail-meta">
            <span class="link-copy" onclick="copyLink('${screeningLink}')" title="Click to copy">
              ${screeningLink}
            </span>
            <span class="${project.active ? 'status-active' : 'status-inactive'}">${project.active ? 'ACTIVE' : 'DISABLED'}</span>
          </div>
        </div>
        <div class="project-detail-actions">
          <button class="btn btn-sm" onclick="editProjectTitle('${uuid}', '${project.title.replace(/'/g, "\\'")}')">Rename</button>
          <button class="btn btn-sm" onclick="toggleProject('${uuid}', ${!project.active})">${project.active ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-sm btn-danger" onclick="deleteProjectFromDetail('${uuid}')">Delete</button>
        </div>
      </div>

      <div class="version-section-head">
        <h3>Versions (${versions.length})</h3>
        <button class="btn btn-sm" onclick="openVersionUpload('${uuid}')">+ Add Version</button>
      </div>

      ${versions.length === 0 ? `
        <div class="admin-empty"><p>// No versions yet — upload the first cut</p></div>
      ` : `
        <div class="version-list">
          ${versions.map((v, i) => `
            <div class="version-item ${i === 0 ? 'latest' : ''}">
              <div class="version-item-thumb">
                ${v.thumbnail ? `<img src="${v.thumbnail}" alt="v${v.version_number}" onerror="this.style.display='none'">` : ''}
              </div>
              <div class="version-item-info">
                <div class="version-item-title">v${v.version_number}${v.note ? ' — ' + v.note : ''}</div>
                <div class="version-item-date">${v.created_at ? v.created_at.split('T')[0] : ''}</div>
              </div>
              ${i === 0 ? '<span class="version-badge-latest">Latest</span>' : ''}
              <div class="version-item-actions">
                <button class="btn btn-sm btn-danger" onclick="deleteVersion('${uuid}', ${v.id})">Delete</button>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;
  } catch (e) {
    console.error('Failed to load project detail:', e);
    el.innerHTML = '<div class="admin-empty"><p>Error loading project</p></div>';
  }
}

function editProjectTitle(uuid, currentTitle) {
  const newTitle = prompt('Rename project:', currentTitle);
  if (newTitle && newTitle !== currentTitle) {
    fetch(`/api/projects/${uuid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle })
    }).then(() => {
      toast('Project renamed');
      showProjectDetail(uuid);
    });
  }
}

async function toggleProject(uuid, active) {
  await fetch(`/api/projects/${uuid}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active })
  });
  toast(active ? 'Project enabled' : 'Project disabled');
  showProjectDetail(uuid);
}

async function deleteProjectFromDetail(uuid) {
  if (!confirm('Delete this project and all its versions?')) return;
  await fetch(`/api/projects/${uuid}`, { method: 'DELETE' });
  toast('Project deleted');
  showSection('projects');
}

async function deleteVersion(uuid, versionId) {
  if (!confirm('Delete this version?')) return;
  await fetch(`/api/projects/${uuid}/versions/${versionId}`, { method: 'DELETE' });
  toast('Version deleted');
  showProjectDetail(uuid);
}

// ---- Version Upload ----
function openVersionUpload(uuid) {
  clearVersionTranscode();
  document.getElementById('version-form').reset();
  document.getElementById('version-project-uuid').value = uuid;
  document.getElementById('version-video-path').value = '';
  document.getElementById('version-video-btn').textContent = 'Choose video file...';
  document.getElementById('version-video-name').textContent = '';
  document.getElementById('version-upload-progress').style.display = 'none';
  document.getElementById('version-progress-filled').style.width = '0%';
  document.getElementById('version-progress-filled').classList.remove('progress-done', 'progress-error');
  document.getElementById('version-submit-btn').disabled = true;
  openModal('version-modal');
}

const versionVideoBtn = document.getElementById('version-video-btn');
const versionVideoInput = document.getElementById('version-video-input');
const versionVideoName = document.getElementById('version-video-name');
const versionProgressWrap = document.getElementById('version-upload-progress');
const versionProgressFilled = document.getElementById('version-progress-filled');
const versionProgressText = document.getElementById('version-progress-text');
const versionSubmitBtn = document.getElementById('version-submit-btn');

versionVideoBtn.addEventListener('click', () => {
  versionVideoInput.click();
});

versionVideoInput.addEventListener('change', () => {
  if (versionVideoInput.files.length) {
    uploadVersionVideo(versionVideoInput.files[0]);
  }
});

function uploadVersionVideo(file) {
  clearVersionTranscode();
  versionVideoName.textContent = file.name;
  versionVideoBtn.textContent = 'Change video...';
  versionProgressWrap.style.display = 'block';
  versionProgressFilled.style.width = '0%';
  versionProgressText.textContent = 'Uploading...';
  versionSubmitBtn.disabled = true;

  uploadFileChunked(file, {
    progressFilled: versionProgressFilled,
    progressText: versionProgressText,
    progressWrap: versionProgressWrap,
    submitBtn: versionSubmitBtn,
    onTranscode: (jobId, filename) => pollVersionTranscode(jobId, filename),
    onError: (err) => {
      toast('Upload failed: ' + err.message);
      versionProgressWrap.style.display = 'none';
      versionSubmitBtn.disabled = false;
    }
  });

  versionVideoInput.value = '';
}

function pollVersionTranscode(jobId, filename) {
  versionTranscodeId = jobId;

  versionTranscodeInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/transcode/${jobId}`);
      const job = await res.json();

      if (job.status === 'done') {
        clearInterval(versionTranscodeInterval);
        versionTranscodeInterval = null;
        versionSubmitBtn.disabled = false;

        const videoName = filename.replace(/\.[^.]+$/, '') + '.mp4';
        versionVideoPath = `/assets/videos/${videoName}`;
        document.getElementById('version-video-path').value = versionVideoPath;

        versionProgressFilled.style.width = '100%';
        versionProgressFilled.classList.add('progress-done');
        versionProgressText.textContent = 'Ready to save';

        // Store thumbnail path if available
        await loadThumbFiles();
        const thumbName = videoName.replace(/\.[^.]+$/, '') + '_thumb.jpg';
        const autoThumb = thumbFiles.find(f => f.name === thumbName);
        if (autoThumb) {
          document.getElementById('version-video-path').dataset.thumbnail = autoThumb.path;
        }

      } else if (job.status === 'error') {
        clearInterval(versionTranscodeInterval);
        versionTranscodeInterval = null;
        versionProgressText.textContent = `Transcode failed: ${job.error}`;
        versionProgressFilled.classList.add('progress-error');
        versionSubmitBtn.disabled = false;
        toast(`Transcode failed: ${job.error}`);

      } else {
        const statusText = job.status === 'generating_thumbnail' ? 'Generating thumbnail...'
          : job.status === 'transcoding' ? `Transcoding ${job.progress || 0}%`
          : job.status === 'probing' ? 'Analysing...'
          : 'Queued...';
        versionProgressText.textContent = statusText;
        if (job.status === 'transcoding' && job.progress) {
          versionProgressFilled.style.width = job.progress + '%';
        }
      }
    } catch (e) {
      clearInterval(versionTranscodeInterval);
      versionTranscodeInterval = null;
    }
  }, 2000);
}

document.getElementById('version-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const uuid = document.getElementById('version-project-uuid').value;
  const video = document.getElementById('version-video-path').value || versionVideoPath;
  const note = document.getElementById('version-note').value;
  const thumbnail = document.getElementById('version-video-path').dataset.thumbnail || '';

  if (!video) {
    toast('Upload a video first');
    return;
  }

  const res = await fetch(`/api/projects/${uuid}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video, thumbnail, note })
  });

  if (res.ok) {
    closeModal('version-modal');
    toast('Version added');
    showProjectDetail(uuid);
  } else {
    const err = await res.json();
    toast(err.error || 'Error adding version');
  }
});

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
loadHomeStats();
loadVideoFiles();
loadThumbFiles();
