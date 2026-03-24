// HTML entity escaping to prevent XSS
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ---- Auth-aware fetch wrapper ----
async function authFetch(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401 || (res.status === 302 && !res.ok)) {
    // Session expired — redirect to login
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  return res;
}

// Safe delete helper — confirms, calls API, shows toast, runs callback on success
async function safeDelete(url, confirmTitle, confirmMsg, successMsg, onSuccess) {
  if (!await confirmAction(confirmTitle, confirmMsg)) return;
  try {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) { const err = await res.json().catch(() => ({})); toast(err.error || 'Delete failed'); return; }
    toast(successMsg);
    if (onSuccess) onSuccess();
  } catch (err) { toast('Delete failed: ' + err.message); }
}

// ---- State ----
let videoFiles = [];
let thumbFiles = [];
let modalTranscodeId = null;     // active transcode job in the film modal
let modalVideoPath = null;       // resolved video path after transcode
let modalTranscodeInterval = null;

// ---- Section Navigation ----
function showSection(name, skipPush) {
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section-${name}`).classList.add('active');
  if (name === 'films') loadFilms();
  if (name === 'home') loadHomeStats();
  if (name === 'requests') loadRequests();
  if (!skipPush) history.pushState({ section: name }, '', `/admin#${name}`);

  // Update sidebar active state
  document.querySelectorAll('.sidebar-nav-item[data-section]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === name);
  });

  // Update mobile section title
  const titles = { home: 'Clients', films: 'Films', requests: 'Requests' };
  const mobileTitleEl = document.getElementById('mobile-section-title');
  if (mobileTitleEl) mobileTitleEl.textContent = titles[name] || '';

  // Show/hide breadcrumb (only for detail views)
  const breadcrumb = document.getElementById('admin-breadcrumb');
  if (breadcrumb) {
    breadcrumb.style.display = (name === 'client-detail' || name === 'client-project-detail') ? '' : 'none';
  }

  // Close mobile sidebar if open
  closeMobileSidebar();
}

// ---- Mobile Sidebar ----
function toggleMobileSidebar() {
  document.getElementById('admin-sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}
function closeMobileSidebar() {
  const sidebar = document.getElementById('admin-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
}

// ---- Breadcrumb ----
function updateBreadcrumb(items) {
  const container = document.getElementById('breadcrumb-items');
  const breadcrumb = document.getElementById('admin-breadcrumb');
  if (!container || !breadcrumb) return;
  breadcrumb.style.display = '';
  container.innerHTML = items.map((item, i) => {
    const isLast = i === items.length - 1;
    if (isLast) {
      return `<span class="breadcrumb-current">${escHtml(item.label)}</span>`;
    }
    return `<button class="breadcrumb-link" onclick="${item.onclick}">${escHtml(item.label)}</button><span class="breadcrumb-sep">/</span>`;
  }).join('');
}

// ---- Loading Indicator ----
function showLoading(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = '<div class="admin-loading"><div class="admin-spinner"></div></div>';
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
  if (id === 'client-version-modal') clearClientVersionTranscode();
}

function confirmAction(title, message, confirmLabel = 'Delete') {
  return new Promise((resolve) => {
    const result = window.confirm(message || title);
    resolve(result);
  });
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
    // Save pending metadata server-side so auto-save works even if browser closes
    fetch(`/api/transcode/${bgTranscodeId}/pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bgFormData)
    }).catch(() => {});
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
  const isPublic = visValue !== 'client';
  return {
    isEdit: !!editSlug,
    editSlug,
    title: document.getElementById('film-title').value,
    slug: document.getElementById('film-slug').value,
    category: document.getElementById('film-category').value,
    year: document.getElementById('film-year').value,
    description: document.getElementById('film-description').value,
    synopsis: document.getElementById('film-synopsis').value,
    credits: document.getElementById('film-credits').value,
    duration_minutes: document.getElementById('film-duration').value || undefined,
    role_description: document.getElementById('film-role').value,
    public: isPublic,
    eligible_for_featured: document.getElementById('film-featured').checked,
    password: document.getElementById('film-password').value
  };
}

function startBgTranscodePoll() {
  if (bgTranscodeInterval) clearInterval(bgTranscodeInterval);
  bgTranscodeInterval = setInterval(async () => {
    try {
      const res = await authFetch(`/api/transcode/${bgTranscodeId}`);
      if (!res.ok) return;
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
  const videoPath = job.videoPath || `/assets/videos/${job.output}`;

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
    synopsis: formData.synopsis,
    credits: formData.credits,
    duration_minutes: formData.duration_minutes || null,
    role_description: formData.role_description,
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

// ---- Kebab Menu ----
function toggleKebab(btn) {
  const menu = btn.nextElementSibling;
  const wasOpen = menu.classList.contains('open');
  document.querySelectorAll('.kebab-menu.open').forEach(m => m.classList.remove('open'));
  if (!wasOpen) menu.classList.add('open');
}

// Close kebab menus on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.kebab-wrap')) {
    document.querySelectorAll('.kebab-menu.open').forEach(m => m.classList.remove('open'));
  }
});

// ---- Kebab Event Delegation ----
// All kebab-item clicks are handled here via data-action attributes.
// No inline onclick on any .kebab-item — this bypasses event bubbling issues.
document.addEventListener('click', function(e) {
  const item = e.target.closest('.kebab-item[data-action]');
  if (!item) return;

  e.stopPropagation();

  // Close all kebab menus
  document.querySelectorAll('.kebab-menu.open').forEach(m => m.classList.remove('open'));

  const action = item.dataset.action;
  const slug = item.dataset.slug;
  const clientSlug = item.dataset.clientSlug;
  const projectSlug = item.dataset.projectSlug;
  const id = item.dataset.id ? parseInt(item.dataset.id, 10) : null;

  switch (action) {
    // Film actions
    case 'toggle-film': toggleFilm(slug, item.dataset.makePublic === 'true'); break;
    case 'delete-film': deleteFilm(slug); break;
    // Client actions
    case 'view-portal': window.open('/portal/' + slug, '_blank'); break;
    case 'copy-portal-link': copyLink(item.dataset.link); break;
    case 'delete-client': deleteClient(slug); break;
    // Project card actions
    case 'upload-video': openClientVersionUploadForFirstFormat(clientSlug, slug); break;
    case 'copy-project-link': copyLink(item.dataset.link); break;
    case 'manage-project': showClientProjectDetail(clientSlug, slug); break;
    // Project detail actions
    case 'view-in-portal': window.open(item.dataset.link, '_blank'); break;
    case 'delete-project': deleteClientProject(clientSlug, slug); break;
    // Deliverable actions
    case 'make-hero': setHeroFormat(clientSlug, projectSlug, id); break;
    case 'move-deliverable': moveDeliverable(clientSlug, projectSlug, id, item.dataset.direction); break;
    case 'delete-deliverable': deleteFormat(clientSlug, projectSlug, id); break;
    // Version actions
    case 'delete-version': deleteClientVersion(clientSlug, projectSlug, id); break;
    // External link actions
    case 'edit-link': editExternalLink(id); break;
    case 'delete-link': deleteExternalLink(id); break;
  }
});

// ---- Format Card Collapse/Expand ----
function toggleFormatCard(head) {
  const card = head.closest('.format-card, .pd-deliv-card');
  if (card) card.classList.toggle('collapsed');
}
function toggleDelivCard(row) {
  const card = row.closest('.dl-card');
  if (card) card.classList.toggle('collapsed');
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', (e) => {
    if (e.target === el) {
      if (el.id === 'film-modal') clearModalTranscode();
      if (el.id === 'client-version-modal') clearClientVersionTranscode();
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

// File type icon based on extension and mime type
function getResourceIcon(filename, mimeType, size) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const mime = mimeType || '';
  const s = size || 18;
  // Video
  if (['mp4','mov','avi','mkv','webm'].includes(ext) || mime.startsWith('video/')) {
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>`;
  }
  // PDF
  if (ext === 'pdf' || mime.includes('pdf')) {
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor"><path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z"/></svg>`;
  }
  // Image
  if (['png','jpg','jpeg','gif','webp','svg','tiff','bmp'].includes(ext) || mime.startsWith('image/')) {
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>`;
  }
  // Document
  if (['doc','docx'].includes(ext)) {
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`;
  }
  // Design
  if (['psd','ai','sketch','fig','xd','eps'].includes(ext)) {
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor"><path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0112 22zm0-18c-4.41 0-8 3.59-8 8s3.59 8 8 8c.28 0 .5-.22.5-.5a.54.54 0 00-.14-.35c-.41-.46-.63-1.05-.63-1.65a2.5 2.5 0 012.5-2.5H16c2.21 0 4-1.79 4-4 0-3.86-3.59-7-8-7z"/></svg>`;
  }
  // Audio
  if (['mp3','wav','aac','flac','ogg','m4a'].includes(ext) || mime.startsWith('audio/')) {
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`;
  }
  // Generic document
  return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>`;
}

// ---- Home Page Stats ----
let homeClients = []; // cached for search filtering

async function loadHomeStats() {
  try {
    const [requestsRes, clientsRes] = await Promise.all([
      authFetch('/api/access-requests'),
      authFetch('/api/clients')
    ]);
    const requests = await requestsRes.json();
    homeClients = await clientsRes.json();

    // Load project counts for each client
    for (const client of homeClients) {
      try {
        const projRes = await fetch(`/api/clients/${client.slug}/projects`);
        const projects = await projRes.json();
        client._projectCount = projects.length;
        client._lastUpdated = projects.reduce((max, p) => p.updated_at > max ? p.updated_at : max, client.created_at || '');
      } catch {
        client._projectCount = 0;
        client._lastUpdated = client.created_at || '';
      }
    }

    // Sort by last updated (most recent first)
    homeClients.sort((a, b) => (b._lastUpdated || '').localeCompare(a._lastUpdated || ''));

    renderHomeClients(homeClients);

    const pending = requests.filter(r => r.status === 'pending');
    const alertEl = document.getElementById('home-requests-alert');

    // Update sidebar badge
    const sidebarBadge = document.getElementById('sidebar-requests-badge');
    if (sidebarBadge) {
      if (pending.length > 0) {
        sidebarBadge.textContent = pending.length;
        sidebarBadge.style.display = '';
      } else {
        sidebarBadge.style.display = 'none';
      }
    }

    if (pending.length > 0) {
      alertEl.innerHTML = `
        <div class="requests-alert-bar">
          <div class="requests-alert-content">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="color:var(--accent);flex-shrink:0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            <span><strong>${pending.length}</strong> pending access request${pending.length !== 1 ? 's' : ''} waiting for review</span>
          </div>
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

function renderHomeClients(clients) {
  const el = document.getElementById('home-clients-list');
  if (!el) return;
  if (clients.length === 0) {
    el.innerHTML = `<div class="admin-empty">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" style="color:var(--text-dim);margin-bottom:16px;"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
      <p>No clients yet</p>
      <p style="color:var(--text-dim);font-size:13px;margin-top:4px;">Create your first client to start managing projects</p>
      <button class="btn-primary" style="margin-top:16px;" onclick="document.getElementById('btn-add-client').click()">New Client</button>
    </div>`;
    return;
  }
  el.innerHTML = clients.map(c => {
    const initials = c.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    const logoHtml = c.logo
      ? `<img src="${c.logo}" alt="" class="hc-logo">`
      : `<div class="hc-logo hc-logo-initials">${initials}</div>`;
    const projCount = c._projectCount || 0;
    const resCount = c.resource_count || 0;
    const openComments = c.open_comment_count || 0;
    const inactiveClass = c.active ? '' : ' hc-inactive';
    return `
      <div class="hc-card${inactiveClass}" onclick="showClientDetail('${c.slug}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showClientDetail('${c.slug}')}" tabindex="0" role="button">
        ${logoHtml}
        <div class="hc-name-block">
          <div class="hc-name">${escHtml(c.name)}</div>
          <div class="hc-url">/portal/${c.slug}</div>
        </div>
        <div class="hc-meta">
          <span class="hc-count"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg> ${projCount}</span>
          <span class="hc-count"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg> ${resCount}</span>
          ${openComments > 0 ? `<span class="hc-count hc-count-notes"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2z"/></svg> ${openComments}</span>` : ''}
          <span class="status-badge ${c.active ? 'status-active' : 'status-inactive'}">${c.active ? 'Active' : 'Inactive'}</span>
        </div>
        <span class="hc-chevron"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></span>
      </div>
    `;
  }).join('');
}

// Home client search
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('home-client-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      if (!q) return renderHomeClients(homeClients);
      renderHomeClients(homeClients.filter(c => c.name.toLowerCase().includes(q)));
    });
  }
  // Drag-and-drop for version upload
  const dropZone = document.getElementById('client-version-drop-zone');
  const fileInput = document.getElementById('client-version-video-input');
  if (dropZone && fileInput) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        // Transfer dropped file to the input and trigger change
        const dt = new DataTransfer();
        dt.items.add(e.dataTransfer.files[0]);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change'));
      }
    });
  }
  // Project file category — show custom input when "Other" selected
  const catSelect = document.getElementById('project-file-category');
  const catCustom = document.getElementById('project-file-category-custom');
  if (catSelect && catCustom) {
    catSelect.addEventListener('change', () => {
      catCustom.style.display = catSelect.value === 'other' ? '' : 'none';
      if (catSelect.value === 'other') catCustom.focus();
    });
  }
});

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

// Drag-and-drop for film video upload
const filmDropZone = document.getElementById('film-video-picker');
if (filmDropZone) {
  filmDropZone.addEventListener('dragover', (e) => { e.preventDefault(); filmDropZone.classList.add('dragover'); });
  filmDropZone.addEventListener('dragleave', () => filmDropZone.classList.remove('dragover'));
  filmDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    filmDropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      const dt = new DataTransfer();
      dt.items.add(e.dataTransfer.files[0]);
      filmVideoInput.files = dt.files;
      filmVideoInput.dispatchEvent(new Event('change'));
    }
  });
  filmDropZone.addEventListener('click', (e) => {
    if (e.target === filmDropZone || e.target.tagName === 'P') {
      filmVideoInput.click();
    }
  });
}

function uploadVideoInModal(file) {
  clearModalTranscode();
  filmVideoName.textContent = file.name;
  filmVideoBtn.textContent = 'Change file';
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
  const uploadStartTime = Date.now();

  // Beforeunload warning
  const beforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', beforeUnload);

  try {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      let chunkOk = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
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

          if (res.ok) { chunkOk = true; break; }
          if (res.status >= 400 && res.status < 500) {
            const err = await res.json().catch(() => ({ error: 'Upload failed' }));
            throw new Error(err.error || `Chunk ${i} failed with status ${res.status}`);
          }
        } catch (e) {
          if (attempt === 2 || (e.message && !e.message.includes('fetch'))) throw e;
        }
        // Wait before retry: 1s, 3s
        const delay = (attempt + 1) * 2000;
        opts.progressText.textContent = `Retrying chunk ${i + 1}/${totalChunks}...`;
        await new Promise(r => setTimeout(r, delay));
      }
      if (!chunkOk) throw new Error(`Chunk ${i + 1} failed after 3 attempts`);

      const uploaded = end;
      const pct = Math.round((uploaded / file.size) * 100);
      opts.progressFilled.style.width = pct + '%';
      const sizeMB = (uploaded / 1024 / 1024).toFixed(1);
      const totalMB = (file.size / 1024 / 1024).toFixed(1);
      const elapsed = (Date.now() - uploadStartTime) / 1000;
      const speedMBs = elapsed > 0 ? (uploaded / 1024 / 1024 / elapsed).toFixed(1) : '—';
      opts.progressText.textContent = `Uploading ${sizeMB} / ${totalMB} MB  (${pct}%)  ${speedMBs} MB/s`;
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

    window.removeEventListener('beforeunload', beforeUnload);

    if (data.transcodeId) {
      opts.onTranscode(data.transcodeId, data.filename);
    }
  } catch (err) {
    window.removeEventListener('beforeunload', beforeUnload);
    console.error('Upload error:', err);
    opts.onError(err);
  }
}

// Generic chunked upload for non-video files (uses /api/upload/file-assemble instead of video-assemble)
async function uploadFileChunkedGeneric(file, opts) {
  const CHUNK_SIZE = 5 * 1024 * 1024;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const uploadId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  let cancelled = false;
  let startTime = Date.now();

  // Cancel support
  if (opts.cancelBtn) {
    opts.cancelBtn.style.display = '';
    opts.cancelBtn.onclick = () => { cancelled = true; };
  }

  // Beforeunload warning
  const beforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', beforeUnload);

  try {
    for (let i = 0; i < totalChunks; i++) {
      if (cancelled) {
        // Clean up chunks on server
        opts.progressText.textContent = 'Cancelled';
        window.removeEventListener('beforeunload', beforeUnload);
        if (opts.cancelBtn) opts.cancelBtn.style.display = 'none';
        return;
      }

      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      let chunkOk = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const formData = new FormData();
          formData.append('uploadId', uploadId);
          formData.append('chunkIndex', i.toString());
          formData.append('totalChunks', totalChunks.toString());
          formData.append('filename', safeName);
          formData.append('fileSize', file.size.toString());
          formData.append('chunk', chunk);

          const res = await fetch('/api/upload/chunk', { method: 'POST', body: formData });
          if (res.ok) { chunkOk = true; break; }
          if (res.status >= 400 && res.status < 500) {
            const err = await res.json().catch(() => ({ error: 'Upload failed' }));
            throw new Error(err.error || `Chunk ${i} failed with status ${res.status}`);
          }
        } catch (e) {
          if (attempt === 2 || (e.message && !e.message.includes('fetch'))) throw e;
        }
        const delay = (attempt + 1) * 2000;
        opts.progressText.textContent = `Retrying chunk ${i + 1}/${totalChunks}...`;
        await new Promise(r => setTimeout(r, delay));
      }
      if (!chunkOk) throw new Error(`Chunk ${i + 1} failed after 3 attempts`);

      const uploaded = end;
      const pct = Math.round((uploaded / file.size) * 100);
      opts.progressFilled.style.width = pct + '%';
      const sizeMB = (uploaded / 1024 / 1024).toFixed(1);
      const totalMB = (file.size / 1024 / 1024).toFixed(1);
      const elapsed = (Date.now() - startTime) / 1000;
      const speedMBs = elapsed > 0 ? (uploaded / 1024 / 1024 / elapsed).toFixed(1) : '—';
      opts.progressText.textContent = `Uploading ${sizeMB} / ${totalMB} MB  (${pct}%)  ${speedMBs} MB/s`;
    }

    // Assemble (no transcode)
    opts.progressText.textContent = 'Assembling file...';
    const assembleRes = await fetch('/api/upload/file-assemble', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, filename: safeName, category: opts.category || null }),
    });

    if (!assembleRes.ok) {
      const err = await assembleRes.json().catch(() => ({ error: 'Assembly failed' }));
      throw new Error(err.error || 'Failed to assemble file');
    }

    const data = await assembleRes.json();
    opts.progressFilled.style.width = '100%';
    opts.progressText.textContent = 'Upload complete';

    window.removeEventListener('beforeunload', beforeUnload);
    if (opts.cancelBtn) opts.cancelBtn.style.display = 'none';

    if (opts.onComplete) opts.onComplete(data);
  } catch (err) {
    window.removeEventListener('beforeunload', beforeUnload);
    if (opts.cancelBtn) opts.cancelBtn.style.display = 'none';
    console.error('Upload error:', err);
    if (opts.onError) opts.onError(err);
  }
}

// File type and size validation (client-side)
const CLIENT_FILE_RULES = {
  video:    { exts: ['.mp4', '.mov'], maxMB: 5120 },
  document: { exts: ['.pdf', '.doc', '.docx'], maxMB: 100 },
  image:    { exts: ['.png', '.jpg', '.jpeg', '.svg'], maxMB: 50 },
  design:   { exts: ['.ai', '.eps', '.psd'], maxMB: 200 },
  audio:    { exts: ['.wav', '.mp3'], maxMB: 500 },
};

function validateFileClientSide(file, category) {
  if (!category || !CLIENT_FILE_RULES[category]) return { valid: true };
  const rule = CLIENT_FILE_RULES[category];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!rule.exts.includes(ext)) {
    return { valid: false, error: `File type ${ext} is not accepted for ${category}. Allowed: ${rule.exts.join(', ')}` };
  }
  const sizeMB = file.size / 1024 / 1024;
  if (sizeMB > rule.maxMB) {
    return { valid: false, error: `File is ${sizeMB.toFixed(1)} MB. Maximum for ${category} is ${rule.maxMB} MB.` };
  }
  return { valid: true };
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

        modalVideoPath = job.videoPath || `/assets/videos/${job.output}`;
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
let allAdminFilms = [];
let adminPrivacyFilter = 'all'; // 'all', 'public', 'client', 'locked'

async function loadFilms() {
  showLoading('admin-film-grid');
  try {
    const res = await authFetch('/api/films');
    const data = await res.json();
    allAdminFilms = Array.isArray(data) ? data : [];
  } catch (e) {
    allAdminFilms = [];
    return;
  }
  adminPrivacyFilter = 'all';
  const searchInput = document.getElementById('films-search');
  if (searchInput) {
    searchInput.value = '';
    searchInput.oninput = () => applyAdminFilters();
  }
  renderAdminFilters();
  applyAdminFilters();
}

function applyAdminFilters() {
  const searchInput = document.getElementById('films-search');
  const query = searchInput ? searchInput.value : '';
  let films = allAdminFilms;
  if (adminPrivacyFilter === 'public') films = films.filter(f => f.public && !f.password_hash && f.visibility !== 'unlisted');
  else if (adminPrivacyFilter === 'unlisted') films = films.filter(f => f.visibility === 'unlisted');
  else if (adminPrivacyFilter === 'client') films = films.filter(f => !f.public);
  else if (adminPrivacyFilter === 'password') films = films.filter(f => f.password_hash);
  else if (adminPrivacyFilter === 'no-password') films = films.filter(f => f.public && !f.password_hash);
  renderAdminFilms(films, query);
}

function renderAdminFilters() {
  const container = document.getElementById('admin-privacy-filters');
  if (!container) return;
  const noPwCount = allAdminFilms.filter(f => f.public && !f.password_hash && f.visibility !== 'unlisted').length;
  const unlistedCount = allAdminFilms.filter(f => f.visibility === 'unlisted').length;
  const pwCount = allAdminFilms.filter(f => f.password_hash).length;
  const clientCount = allAdminFilms.filter(f => !f.public).length;
  const filters = [
    { key: 'all', label: 'All', count: allAdminFilms.length },
    { key: 'public', label: 'Public', count: noPwCount },
    { key: 'unlisted', label: 'Unlisted', count: unlistedCount },
    { key: 'password', label: 'Password', count: pwCount },
    { key: 'client', label: 'Client', count: clientCount },
  ];
  container.innerHTML = filters.map(f =>
    `<button class="film-filter-pill${adminPrivacyFilter === f.key ? ' active' : ''}" data-filter="${f.key}">${f.label} <span class="film-filter-count">${f.count}</span></button>`
  ).join('');
  container.querySelectorAll('.film-filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      adminPrivacyFilter = btn.dataset.filter;
      renderAdminFilters();
      applyAdminFilters();
    });
  });
}

function renderAdminFilms(films, query) {
  const el = document.getElementById('films-list');

  if (allAdminFilms.length === 0) {
    el.innerHTML = `<div class="admin-empty">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" style="color:var(--text-dim);margin-bottom:16px;"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>
      <p>No films yet</p>
      <p style="color:var(--text-dim);font-size:13px;margin-top:4px;">Upload your first film to get started</p>
      <button class="btn-primary btn-sm" style="margin-top:12px;" onclick="document.getElementById('btn-add-film').click()">Add Film</button>
    </div>`;
    return;
  }

  let filtered = films;
  if (query && query.trim()) {
    const q = query.trim().toLowerCase();
    filtered = films.filter(f =>
      (f.title || '').toLowerCase().includes(q) ||
      (f.category || '').toLowerCase().includes(q) ||
      String(f.year).includes(q)
    );
  }

  // Group filtered films by category
  const groups = {};
  filtered.forEach(f => {
    const cat = f.category || 'Uncategorised';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(f);
  });

  const categoryOrder = ['Podcast Video', 'Brand Film', 'Documentary', 'Charity', 'External Communications', 'Short Films'];
  const sortedCats = Object.keys(groups).sort((a, b) => {
    const ia = categoryOrder.indexOf(a);
    const ib = categoryOrder.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  const filmCard = f => `
    <div class="admin-film-card" onclick="editFilm('${f.slug}')">
      <div class="admin-card-thumb">
        ${f.thumbnail ? `<img src="${f.thumbnail}" alt="${escHtml(f.title)}" loading="lazy" onerror="this.parentElement.classList.add('thumb-missing')">` : ''}
        <div class="admin-card-thumb-gradient"></div>
        <div class="admin-card-badges">
          <span class="admin-badge ${f.visibility === 'unlisted' ? 'badge-unlisted' : f.public ? 'badge-public' : 'badge-client'}">${f.visibility === 'unlisted' ? 'UNLISTED' : f.public ? 'PUBLIC' : 'CLIENT'}</span>
          ${f.password_hash ? '<span class="admin-badge badge-locked">LOCKED</span>' : ''}
          ${f.eligible_for_featured ? '<span class="admin-badge badge-featured">FEATURED</span>' : ''}
        </div>
      </div>
      <div class="admin-card-info">
        <div class="admin-card-title">${escHtml(f.title)}</div>
        <div class="admin-card-meta">${f.category || 'Uncategorised'} &middot; ${f.year}</div>
      </div>
      <div class="admin-card-actions">
        <button class="btn btn-sm" onclick="event.stopPropagation(); editFilm('${f.slug}')">Edit</button>
        <div class="kebab-wrap">
          <button class="kebab-btn" onclick="event.stopPropagation(); toggleKebab(this)" >&#8943;</button>
          <div class="kebab-menu">
            <button class="kebab-item" data-action="toggle-film" data-slug="${f.slug}" data-make-public="${!f.public}">${f.public ? 'Hide from site' : 'Show on site'}</button>
            <div class="kebab-divider"></div>
            <button class="kebab-item danger" data-action="delete-film" data-slug="${f.slug}">Delete Film</button>
          </div>
        </div>
      </div>
    </div>`;

  const groupsHtml = sortedCats.map(cat => `
    <div class="admin-category-group">
      <div class="admin-category-heading">${cat} <span class="cat-count">${groups[cat].length}</span></div>
      <div class="admin-film-grid">${groups[cat].map(filmCard).join('')}</div>
    </div>
  `).join('');

  el.innerHTML = filtered.length === 0
    ? '<div class="admin-empty"><p>No matching films</p></div>'
    : groupsHtml;
}

// ---- Add Film ----
document.getElementById('btn-add-film').addEventListener('click', () => {
  document.getElementById('film-form').reset();
  document.getElementById('film-edit-slug').value = '';
  document.getElementById('film-video-path').value = '';
  document.getElementById('film-modal-title').textContent = 'Add Film';
  document.getElementById('film-submit-btn').textContent = 'Add Film';
  document.getElementById('film-submit-btn').disabled = false;
  document.getElementById('film-slug').disabled = false;
  document.getElementById('film-year').value = new Date().getFullYear();
  delete document.getElementById('film-slug').dataset.manual;

  filmVideoBtn.textContent = 'Choose file';
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
  document.getElementById('film-synopsis').value = film.synopsis || '';
  document.getElementById('film-credits').value = film.credits || '';
  document.getElementById('film-duration').value = film.duration_minutes || '';
  document.getElementById('film-role').value = film.role_description || '';

  document.getElementById('film-video-path').value = film.video || '';
  modalVideoPath = film.video || null;

  if (film.video) {
    const videoName = film.video.split('/').pop();
    filmVideoBtn.textContent = 'Change file';
    filmVideoName.textContent = videoName;
  } else {
    filmVideoBtn.textContent = 'Choose file';
    filmVideoName.textContent = '';
  }

  filmProgressWrap.style.display = 'none';
  filmProgressFilled.style.width = '0%';
  filmProgressFilled.classList.remove('progress-done', 'progress-error');

  let vis = film.visibility || 'public';
  if (!film.public && vis !== 'unlisted') vis = 'client';
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

async function regenThumbnails() {
  const editSlug = document.getElementById('film-edit-slug').value;
  if (!editSlug) return toast('Save the film first before regenerating thumbnails');

  const btn = document.getElementById('regen-thumbs-btn');
  btn.disabled = true;
  btn.textContent = 'Regenerating...';

  try {
    const res = await fetch(`/api/films/${editSlug}/regenerate-thumbs`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.options) {
      const optionsGrid = document.getElementById('thumb-options-grid');
      optionsGrid.innerHTML = data.options.map(opt => `
        <img src="${opt}" alt="Option" class="thumb-option${opt === data.thumbnail ? ' selected' : ''}"
             onclick="selectThumbnail(this, '${opt}')" loading="lazy">
      `).join('');
      document.getElementById('thumb-options').style.display = 'block';
      if (data.thumbnail) {
        document.getElementById('thumb-preview-img').src = data.thumbnail;
        document.getElementById('thumb-preview').style.display = 'block';
        document.getElementById('film-thumbnail-path').value = data.thumbnail;
      }
      toast('Thumbnails regenerated');
    } else {
      toast(data.error || 'Failed to regenerate thumbnails');
    }
  } catch (e) {
    toast('Error: ' + e.message);
  }

  btn.disabled = false;
  btn.textContent = 'Regenerate thumbnails';
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
  const isPublic = visValue !== 'client';
  const visibility = visValue === 'client' ? 'private' : visValue;

  const data = {
    title: document.getElementById('film-title').value,
    category: document.getElementById('film-category').value,
    year: document.getElementById('film-year').value,
    description: document.getElementById('film-description').value,
    synopsis: document.getElementById('film-synopsis').value,
    credits: document.getElementById('film-credits').value,
    duration_minutes: document.getElementById('film-duration').value || null,
    role_description: document.getElementById('film-role').value,
    video: videoPath,
    thumbnail,
    public: isPublic,
    eligible_for_featured: document.getElementById('film-featured').checked,
    visibility,
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
  await safeDelete(`/api/films/${slug}`, 'Delete Film', 'Are you sure you want to delete this film? This cannot be undone.', 'Film deleted', loadFilms);
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

  if (requests.length === 0) {
    el.innerHTML = '<div class="admin-empty"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.25;margin-bottom:12px"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg><p>No access requests</p></div>';
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
  await safeDelete(`/api/access-requests/${id}`, 'Delete Request', 'Are you sure you want to delete this access request?', 'Request deleted', loadRequests);
}

// ---- Visibility radio change ----
function updateVisibilityUI(value) {
  const hint = document.getElementById('visibility-hint');
  const pwGroup = document.getElementById('film-password-group');
  if (value === 'public') {
    hint.textContent = 'Visible to everyone';
    pwGroup.style.display = 'none';
  } else if (value === 'unlisted') {
    hint.textContent = 'Hidden from listings — only accessible via direct link';
    pwGroup.style.display = 'block';
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

// ---- Global Transcode Status ----
let globalTranscodeInterval = null;

function startGlobalTranscodePoll() {
  if (globalTranscodeInterval) return;
  pollTranscodeStatus(); // immediate first check
  globalTranscodeInterval = setInterval(pollTranscodeStatus, 3000);
}

async function pollTranscodeStatus() {
  const el = document.getElementById('transcode-status');
  try {
    const res = await fetch('/api/transcode');
    if (!res.ok) {
      if (res.status === 401 || res.status === 302) {
        // Session expired — stop polling, redirect to login
        clearInterval(globalTranscodeInterval);
        globalTranscodeInterval = null;
        window.location.href = '/login';
        return;
      }
      return; // Other errors — skip silently
    }
    const jobs = await res.json();
    const active = jobs.filter(j => j.status !== 'done' && j.status !== 'error');
    const done = jobs.filter(j => j.status === 'done');

    if (active.length === 0 && done.length === 0) {
      el.innerHTML = '';
      return;
    }

    let html = '';
    for (const job of active) {
      const name = job.input.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      const statusText = job.status === 'generating_thumbnail' ? 'Generating thumbnails...'
        : job.status === 'transcoding' ? `Transcoding ${job.progress || 0}%`
        : job.status === 'probing' ? 'Analysing...'
        : 'Queued...';
      html += `
        <div class="transcode-job">
          <div class="transcode-job-name">${name}</div>
          <div class="transcode-job-bar">
            <div class="transcode-job-fill" style="width:${job.progress || 0}%"></div>
          </div>
          <div class="transcode-job-status">${statusText}</div>
        </div>`;
    }
    for (const job of done) {
      const name = job.input.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      html += `
        <div class="transcode-job transcode-done">
          <div class="transcode-job-name">${name}</div>
          <div class="transcode-job-status">Complete</div>
        </div>`;
    }

    el.innerHTML = `<div class="transcode-status-wrap"><h4 class="transcode-status-title">Active Transcodes</h4>${html}</div>`;
  } catch {
    // ignore
  }
}

// ════════════════════════════════════════
// CLIENT PORTAL ADMIN
// ════════════════════════════════════════

let currentClientSlug = null;
let currentClientProjectSlug = null;
let clientVersionTranscodeId = null;
let clientVersionVideoPath = null;
let clientVersionTranscodeInterval = null;

function clearClientVersionTranscode() {
  // If a transcode is still running, don't clear the interval — inject an inline indicator instead
  if (clientVersionTranscodeInterval && clientVersionTranscodeId) {
    // Inject inline progress indicator into the format card body
    const formatCards = document.querySelectorAll('.format-card-body');
    const targetCard = formatCards.length > 0 ? formatCards[formatCards.length - 1] : null;
    if (targetCard && !document.getElementById('bg-transcode-wrap')) {
      const indicator = document.createElement('div');
      indicator.id = 'bg-transcode-wrap';
      indicator.className = 'transcode-card';
      indicator.innerHTML = `
        <div class="transcode-card-inner">
          <svg class="transcode-card-icon" viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
          <span class="transcode-card-label" id="bg-transcode-text">Transcoding...</span>
          <div class="transcode-card-bar">
            <div class="transcode-card-bar-fill" id="bg-transcode-bar" style="width:0%"></div>
          </div>
        </div>
      `;
      targetCard.prepend(indicator);
    }
    return; // Keep interval running
  }
  if (clientVersionTranscodeInterval) {
    clearInterval(clientVersionTranscodeInterval);
    clientVersionTranscodeInterval = null;
  }
  clientVersionTranscodeId = null;
  clientVersionVideoPath = null;
}

async function loadClients() {
  showLoading('clients-list');
  const res = await fetch('/api/clients');
  const clients = await res.json();
  const el = document.getElementById('clients-list');

  if (clients.length === 0) {
    el.innerHTML = '<div class="admin-empty"><p>No clients yet — create your first client portal</p></div>';
    return;
  }

  el.innerHTML = `
    <div class="project-grid">
      ${clients.map(c => `
        <div class="project-card" onclick="showClientDetail('${c.slug}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showClientDetail('${c.slug}')}" tabindex="0" role="button">
          <div class="project-card-title">${c.name}</div>
          <div class="project-card-meta">
            <span>${c.project_count} project${c.project_count !== 1 ? 's' : ''}</span>
            <span>${c.resource_count} resource${c.resource_count !== 1 ? 's' : ''}</span>
            <span class="${c.active ? 'status-active' : 'status-inactive'}">${c.active ? 'ACTIVE' : 'DISABLED'}</span>
          </div>
          <div class="project-card-link">/portal/${c.slug}${c.password_protected ? ' &middot; <span class="status-locked">LOCKED</span>' : ''}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// ---- Add Client ----
// Auto-generate client slug from name
document.getElementById('client-name').addEventListener('input', (e) => {
  const slugField = document.getElementById('client-slug');
  // Only auto-fill if not editing and slug hasn't been manually set
  if (!document.getElementById('client-edit-slug').value && !slugField.dataset.manual) {
    slugField.value = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  // Update slug preview
  updateClientSlugPreview();
});
document.getElementById('client-slug').addEventListener('input', () => {
  document.getElementById('client-slug').dataset.manual = '1';
  updateClientSlugPreview();
});
function updateClientSlugPreview() {
  const val = document.getElementById('client-slug').value || '...';
  const preview = document.getElementById('client-slug-preview-val');
  if (preview) preview.textContent = val;
}
document.getElementById('client-slug').addEventListener('input', () => {
  document.getElementById('client-slug').dataset.manual = '1';
});

document.getElementById('btn-add-client').addEventListener('click', () => {
  document.getElementById('client-form').reset();
  document.getElementById('client-edit-slug').value = '';
  delete document.getElementById('client-slug').dataset.manual;
  document.getElementById('client-modal-title').textContent = 'New Client';
  document.getElementById('client-submit-btn').textContent = 'Create Client';
  openModal('client-modal');
});

document.getElementById('client-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editSlug = document.getElementById('client-edit-slug').value;
  const isEdit = !!editSlug;

  const data = {
    name: document.getElementById('client-name').value,
    slug: document.getElementById('client-slug').value || undefined,
    notes: document.getElementById('client-notes').value,
  };

  if (!isEdit) {
    data.password = document.getElementById('client-password').value || undefined;
  }

  const url = isEdit ? `/api/clients/${editSlug}` : '/api/clients';
  const method = isEdit ? 'PUT' : 'POST';

  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (res.ok) {
    const client = await res.json();
    closeModal('client-modal');

    // Set or update password if provided (for edits)
    if (isEdit) {
      const pw = document.getElementById('client-password').value;
      if (pw) {
        await fetch(`/api/clients/${client.slug}/password`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw })
        });
      }
    }

    // Upload logo if selected
    const logoInput = document.getElementById('client-logo-input');
    if (logoInput && logoInput.files.length > 0) {
      const fd = new FormData();
      fd.append('file', logoInput.files[0]);
      await fetch(`/api/clients/${client.slug}/logo`, { method: 'POST', body: fd });
    }

    toast(isEdit ? 'Client updated' : 'Client created');
    if (isEdit) showClientDetail(client.slug);
    else {
      const link = `${window.location.origin}/portal/${client.slug}`;
      copyLink(link);
      toast('Client created — portal link copied');
      showClientDetail(client.slug);
    }
  } else {
    const err = await res.json();
    toast(err.error || 'Error');
  }
});

// ---- Client Detail ----
async function showClientDetail(slug) {
  currentClientSlug = slug;
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-client-detail').classList.add('active');
  history.pushState({ section: 'client-detail', slug }, '', `/admin#client/${slug}`);

  // Keep Clients highlighted in sidebar
  document.querySelectorAll('.sidebar-nav-item[data-section]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === 'home');
  });

  showLoading('client-detail-content');
  const el = document.getElementById('client-detail-content');

  try {
    const [clientRes, projectsRes, resourcesRes] = await Promise.all([
      fetch(`/api/clients/${slug}`),
      fetch(`/api/clients/${slug}/projects`),
      fetch(`/api/clients/${slug}/resources`)
    ]);
    const client = await clientRes.json();
    const projects = await projectsRes.json();
    const resources = await resourcesRes.json();

    // Fetch client-level external links
    const clientLinksRes = await fetch(`/api/external-links?type=client_resource&parent_id=${client.id}`);
    const clientLinks = clientLinksRes.ok ? await clientLinksRes.json() : [];

    const portalLink = `${window.location.origin}/portal/${slug}`;
    const locked = !!client.password_hash;

    // Update breadcrumb
    updateBreadcrumb([
      { label: client.name }
    ]);

    el.innerHTML = `
      <div class="cd-header">
        <div class="cd-header-top">
          <div class="cd-header-info">
            <h2 class="cd-title">${client.name}</h2>
            <div class="cd-meta-line">
              <button class="cd-portal-url" onclick="copyLink('${portalLink}')" title="Click to copy portal link">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>
                watch.webbedfilms.com/portal/${slug}
              </button>
              <span class="status-badge ${client.active ? 'status-active' : 'status-inactive'}">${client.active ? 'Active' : 'Disabled'}</span>
              ${locked ? '<span class="status-badge" style="background:var(--accent-dim);color:var(--accent);">Password Protected</span>' : ''}
            </div>
          </div>
          <div class="cd-actions">
            <button class="btn btn-sm" onclick="editClient('${slug}')">Edit</button>
            <div class="kebab-wrap">
              <button class="kebab-btn" onclick="toggleKebab(this)" title="More">&#8943;</button>
              <div class="kebab-menu">
                <button class="kebab-item" data-action="view-portal" data-slug="${slug}">View Portal</button>
                <button class="kebab-item" data-action="copy-portal-link" data-link="${portalLink}">Copy Portal Link</button>
                <div class="kebab-divider"></div>
                <button class="kebab-item danger" data-action="delete-client" data-slug="${slug}">Delete Client</button>
              </div>
            </div>
          </div>
        </div>
        ${client.notes ? `<div class="cd-notes">${escHtml(client.notes)}</div>` : ''}
      </div>

      <div class="cd-section">
        <div class="cd-section-head">
          <span class="cd-section-label">Projects <span class="cd-section-count">${projects.length}</span></span>
          <button class="btn-primary btn-sm" onclick="openNewClientProject('${slug}')">New Project</button>
        </div>
        <div id="client-projects-list">
          ${projects.length === 0 ? `<div class="admin-empty">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" style="color:var(--text-dim);margin-bottom:12px;"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>
            <p>No projects yet</p>
            <p style="color:var(--text-dim);font-size:13px;margin-top:4px;">Projects organise deliverables for this client</p>
            <button class="btn-primary btn-sm" style="margin-top:12px;" onclick="openNewClientProject('${slug}')">New Project</button>
          </div>` : `
            <div class="cd-project-grid">
              ${projects.map(p => {
                const initials = p.title.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
                const thumbHtml = p.latest_thumbnail
                  ? `<img src="${p.latest_thumbnail}" alt="${escHtml(p.title)}" loading="lazy" class="cd-proj-thumb">`
                  : `<div class="cd-proj-thumb cd-proj-thumb-initials">${initials}</div>`;
                const updated = p.updated_at ? new Date(p.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
                return `
                <div class="cd-proj-card" onclick="showClientProjectDetail('${slug}', '${p.slug}')" tabindex="0" role="button">
                  ${thumbHtml}
                  <div class="cd-proj-body">
                    <div class="cd-proj-title">${escHtml(p.title)}</div>
                    <div class="cd-proj-meta">
                      <span>${p.version_count} version${p.version_count !== 1 ? 's' : ''}</span>
                      ${p.rf_number ? `<span class="cd-proj-ref">${escHtml(p.rf_number)}</span>` : ''}
                    </div>
                    ${updated ? `<div class="cd-proj-date">Updated ${updated}</div>` : ''}
                  </div>
                  <div class="cd-proj-kebab">
                    <div class="kebab-wrap">
                      <button class="kebab-btn" onclick="event.stopPropagation();toggleKebab(this)" title="More">&#8943;</button>
                      <div class="kebab-menu">
                        <button class="kebab-item" data-action="upload-video" data-client-slug="${slug}" data-slug="${p.slug}">Upload Video</button>
                        <button class="kebab-item" data-action="copy-project-link" data-link="${window.location.origin}/portal/${slug}/project/${p.slug}">Copy Portal Link</button>
                        <div class="kebab-divider"></div>
                        <button class="kebab-item" data-action="manage-project" data-client-slug="${slug}" data-slug="${p.slug}">Manage Project</button>
                      </div>
                    </div>
                  </div>
                </div>`;
              }).join('')}
            </div>
          `}
        </div>
      </div>

      <div class="cd-section">
        <div class="cd-section-head">
          <span class="cd-section-label">Resources${(resources.length + clientLinks.length) > 0 ? ` <span class="cd-section-count">${resources.length + clientLinks.length}</span>` : ''}</span>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-sm" onclick="openResourceUpload('${slug}')">Upload</button>
            <button class="btn btn-sm" onclick="openLinkModal('client_resource', ${client.id})">+ Link</button>
          </div>
        </div>
        <div id="client-resources-list">
          ${resources.length === 0 && clientLinks.length === 0 ? `<div class="admin-empty">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" style="color:var(--text-dim);margin-bottom:12px;"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
            <p>No resources yet</p>
            <p style="color:var(--text-dim);font-size:13px;margin-top:4px;">Upload brand guidelines, logos, and shared files</p>
          </div>` : `
            <div class="cd-file-list">
              ${resources.map(r => {
                const icon = getResourceIcon(r.original_name, r.mime_type, 18);
                const isVisible = r.client_visible !== 0;
                return `
                <div class="cd-file-row${isVisible ? '' : ' cd-file-internal'}">
                  <span class="cd-file-icon">${icon}</span>
                  <a href="${r.file_path}" target="_blank" rel="noopener noreferrer" class="cd-file-name">${escHtml(r.original_name)}</a>
                  <span class="cd-file-cat">${r.category}</span>
                  <span class="cd-file-vis ${isVisible ? 'cd-vis-client' : 'cd-vis-internal'}">${isVisible ? 'CLIENT VISIBLE' : 'INTERNAL'}</span>
                  <span class="cd-file-size">${formatSize(r.file_size)}</span>
                  <div class="cd-file-actions">
                    <button class="btn-ghost" onclick="event.stopPropagation();toggleResourceVisibility('${slug}', ${r.id}, ${isVisible ? 0 : 1})" title="${isVisible ? 'Hide from client' : 'Show to client'}">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="${isVisible ? 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z' : 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2z'}"/></svg>
                    </button>
                    <a href="${r.file_path}" download="${escHtml(r.original_name)}" class="btn-ghost" title="Download">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                    </a>
                    <button class="btn-ghost btn-ghost-danger" onclick="event.stopPropagation();deleteResource('${slug}', ${r.id})" title="Delete">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    </button>
                  </div>
                </div>`;
              }).join('')}
              ${clientLinks.map(l => linkCardHtml(l)).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  } catch (err) {
    el.innerHTML = '<div class="admin-empty"><p>Error loading client</p></div>';
  }
}

function editClient(slug) {
  fetch(`/api/clients/${slug}`).then(r => r.json()).then(client => {
    document.getElementById('client-edit-slug').value = slug;
    document.getElementById('client-name').value = client.name;
    document.getElementById('client-slug').value = client.slug;
    document.getElementById('client-notes').value = client.notes || '';
    document.getElementById('client-password').value = '';
    document.getElementById('client-modal-title').textContent = 'Edit Client';
    document.getElementById('client-submit-btn').textContent = 'Save Changes';
    // Show existing logo preview
    const logoPreview = document.getElementById('client-logo-preview');
    if (logoPreview) {
      if (client.logo) {
        logoPreview.querySelector('img').src = client.logo;
        logoPreview.style.display = '';
      } else {
        logoPreview.style.display = 'none';
      }
    }
    const logoInput = document.getElementById('client-logo-input');
    if (logoInput) logoInput.value = '';
    openModal('client-modal');
  });
}

async function deleteClient(slug) {
  await safeDelete(`/api/clients/${slug}`, 'Delete Client', 'This will permanently delete this client and all their projects, deliverables, and resources. This cannot be undone.', 'Client deleted', () => showSection('home'));
}

// ---- Client Projects ----
function openNewClientProject(clientSlug) {
  document.getElementById('client-project-form').reset();
  document.getElementById('client-project-edit-slug').value = '';
  document.getElementById('client-project-client-slug').value = clientSlug;
  document.getElementById('client-project-modal-title').textContent = 'New Project';
  document.getElementById('client-project-submit-btn').textContent = 'Create Project';
  openModal('client-project-modal');
}

document.getElementById('client-project-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const clientSlug = document.getElementById('client-project-client-slug').value;
  const editSlug = document.getElementById('client-project-edit-slug').value;
  const isEdit = !!editSlug;

  const data = {
    title: document.getElementById('client-project-title').value,
    description: document.getElementById('client-project-description').value,
    rf_number: document.getElementById('client-project-rf-number').value,
  };

  const url = isEdit ? `/api/clients/${clientSlug}/projects/${editSlug}` : `/api/clients/${clientSlug}/projects`;
  const method = isEdit ? 'PUT' : 'POST';

  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (res.ok) {
    closeModal('client-project-modal');
    toast(isEdit ? 'Project updated' : 'Project created');
    showClientDetail(clientSlug);
  } else {
    const err = await res.json();
    toast(err.error || 'Error');
  }
});

// ---- Client Project Detail ----
async function showClientProjectDetail(clientSlug, projectSlug) {
  currentClientSlug = clientSlug;
  currentClientProjectSlug = projectSlug;
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-client-project-detail').classList.add('active');
  history.pushState({ section: 'client-project-detail', clientSlug, projectSlug }, '', `/admin#client/${clientSlug}/${projectSlug}`);

  // Keep Clients highlighted in sidebar
  document.querySelectorAll('.sidebar-nav-item[data-section]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === 'home');
  });

  showLoading('client-project-detail-content');
  const el = document.getElementById('client-project-detail-content');

  try {
    const [projectRes, formatsRes, filesRes] = await Promise.all([
      fetch(`/api/clients/${clientSlug}/projects`),
      fetch(`/api/clients/${clientSlug}/projects/${projectSlug}/formats`),
      fetch(`/api/clients/${clientSlug}/projects/${projectSlug}/files`)
    ]);
    const projects = await projectRes.json();
    const project = projects.find(p => p.slug === projectSlug);
    if (!project) { el.innerHTML = '<div class="admin-empty"><p>Project not found</p></div>'; return; }
    const formats = await formatsRes.json();
    const files = await filesRes.json();

    // Update breadcrumb: Clients / ClientName / ProjectName
    updateBreadcrumb([
      { label: clientSlug, onclick: `showClientDetail('${clientSlug}')` },
      { label: project.title }
    ]);

    // Fetch project-level external links
    const projectLinksRes = await fetch(`/api/external-links?type=project_file&parent_id=${project.id}`);
    const projectLinks = projectLinksRes.ok ? await projectLinksRes.json() : [];

    // Determine deliverable status
    function delivStatus(fmtVersions) {
      if (fmtVersions.length === 0) return { key: 'empty', label: 'No content', css: 'pd-status-empty' };
      const approval = fmtVersions[0].approval_status || null;
      if (approval === 'approved') return { key: 'approved', label: 'Approved', css: 'pd-status-approved' };
      if (approval === 'changes_requested') return { key: 'changes', label: 'Changes requested', css: 'pd-status-changes' };
      return { key: 'review', label: 'Awaiting review', css: 'pd-status-review' };
    }

    // Build deliverable list HTML
    let formatsHtml = '';
    if (formats.length === 0) {
      formatsHtml = `<div class="admin-empty">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" style="color:var(--text-dim);margin-bottom:12px;"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
        <p>No deliverables yet</p>
        <p style="color:var(--text-dim);font-size:13px;margin-top:4px;">Add a deliverable to start uploading versions</p>
        <button class="btn-primary btn-sm" style="margin-top:12px;" onclick="addFormat('${clientSlug}', '${projectSlug}')">Add Deliverable</button>
      </div>`;
    } else {
      for (let fi = 0; fi < formats.length; fi++) {
        const fmt = formats[fi];
        const [fmtVersionsRes, fmtLinksRes] = await Promise.all([
          fetch(`/api/clients/${clientSlug}/projects/${projectSlug}/formats/${fmt.id}/versions`),
          fetch(`/api/external-links?type=deliverable&parent_id=${fmt.id}`)
        ]);
        const fmtVersions = fmtVersionsRes.ok ? await fmtVersionsRes.json() : [];
        const fmtLinks = fmtLinksRes.ok ? await fmtLinksRes.json() : [];
        const status = delivStatus(fmtVersions);
        const vCount = fmtVersions.length;
        const lastUpdated = vCount > 0 ? new Date(fmtVersions[0].created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

        // Kebab items
        const kebabItems = [];
        if (!fmt.is_hero) kebabItems.push(`<button class="kebab-item" data-action="make-hero" data-client-slug="${clientSlug}" data-project-slug="${projectSlug}" data-id="${fmt.id}">Make Hero</button>`);
        if (fi > 0) kebabItems.push(`<button class="kebab-item" data-action="move-deliverable" data-client-slug="${clientSlug}" data-project-slug="${projectSlug}" data-id="${fmt.id}" data-direction="up">Move Up</button>`);
        if (fi < formats.length - 1) kebabItems.push(`<button class="kebab-item" data-action="move-deliverable" data-client-slug="${clientSlug}" data-project-slug="${projectSlug}" data-id="${fmt.id}" data-direction="down">Move Down</button>`);
        if (kebabItems.length > 0) kebabItems.push('<div class="kebab-divider"></div>');
        kebabItems.push(`<button class="kebab-item danger" data-action="delete-deliverable" data-client-slug="${clientSlug}" data-project-slug="${projectSlug}" data-id="${fmt.id}">Delete Deliverable</button>`);

        // Version rows (show max 3 collapsed, with "show all" link)
        const visibleVersions = fmtVersions.slice(0, 3);
        const hiddenCount = fmtVersions.length - 3;
        const versionsHtml = vCount === 0
          ? `<div class="dl-empty-body">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>
              <span>Upload your first version</span>
              <button class="btn-primary btn-sm" onclick="event.stopPropagation();openClientVersionUploadForFormat('${clientSlug}','${projectSlug}',${fmt.id},'${fmt.type||'video'}')">Upload</button>
            </div>`
          : `<div class="dl-versions">
              ${visibleVersions.map((v, vi) => {
                const hasFile = v.file_path && v.file_path.length > 0;
                const isLatest = vi === 0;
                return `<div class="dl-ver${isLatest ? ' dl-ver-latest' : ''}">
                  <span class="dl-ver-num">v${v.version_number}</span>
                  ${isLatest ? '<span class="dl-ver-latest-badge">LATEST</span>' : ''}
                  <span class="dl-ver-note">${v.note ? escHtml(v.note) : (v.file_path ? escHtml(v.file_path.split('/').pop()) : '—')}</span>
                  ${v.file_size ? `<span class="dl-ver-size">${formatSize(v.file_size)}</span>` : ''}
                  <span class="dl-ver-date">${new Date(v.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                  <div class="dl-ver-actions">
                    ${hasFile ? `<a href="/api/download/version/${v.id}" class="btn-ghost" title="Download"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg></a>` : ''}
                    <a href="/portal/${clientSlug}/project/${projectSlug}" target="_blank" rel="noopener noreferrer" class="btn-ghost" title="View in portal"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg></a>
                    <div class="kebab-wrap"><button class="kebab-btn" onclick="event.stopPropagation();toggleKebab(this)" >&#8943;</button><div class="kebab-menu">
                      ${hasFile ? `<a href="/api/download/version/${v.id}" class="kebab-item" style="text-decoration:none">Download</a>` : ''}
                      <a href="/portal/${clientSlug}/project/${projectSlug}" target="_blank" rel="noopener noreferrer" class="kebab-item" style="text-decoration:none">View in Portal</a>
                      <div class="kebab-divider"></div>
                      <button class="kebab-item danger" data-action="delete-version" data-client-slug="${clientSlug}" data-project-slug="${projectSlug}" data-id="${v.id}">Delete Version</button>
                    </div></div>
                  </div>
                </div>`;
              }).join('')}
              ${hiddenCount > 0 ? `<button class="dl-show-all" onclick="event.stopPropagation();this.parentElement.innerHTML=\`${fmtVersions.map((v, vi) => {
                const hasFile = v.file_path && v.file_path.length > 0;
                const isLatest = vi === 0;
                return `<div class='dl-ver${isLatest ? ' dl-ver-latest' : ''}'><span class='dl-ver-num'>v${v.version_number}</span>${isLatest ? '<span class=\\"dl-ver-latest-badge\\">LATEST</span>' : ''}<span class='dl-ver-note'>${v.note ? escHtml(v.note).replace(/'/g,'&#39;') : '—'}</span>${v.file_size ? `<span class='dl-ver-size'>${formatSize(v.file_size)}</span>` : ''}<span class='dl-ver-date'>${new Date(v.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span><div class='dl-ver-actions'>${hasFile ? `<a href='/api/download/version/${v.id}' class='btn-ghost' title='Download'><svg viewBox='0 0 24 24' width='14' height='14' fill='currentColor'><path d='M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z'/></svg></a>` : ''}</div></div>`;
              }).join('')}\`">Show all ${fmtVersions.length} versions</button>` : ''}
            </div>`;

        // Notes/feedback placeholder (populated async by loadProjectFeedback)
        formatsHtml += `
          <div class="dl-card collapsed" data-format-id="${fmt.id}">
            <div class="dl-row" onclick="toggleDelivCard(this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleDelivCard(this)}" tabindex="0" role="button">
              <div class="dl-stripe dl-stripe-${status.key}"></div>
              <span class="dl-name">${escHtml(fmt.label)}</span>
              ${fmt.is_hero ? '<span class="dl-hero-badge">Hero</span>' : ''}
              ${fmt.type === 'video' && fmt.aspect_ratio ? `<span class="dl-ratio">${fmt.aspect_ratio}</span>` : ''}
              <span class="dl-spacer"></span>
              <span class="dl-status dl-status-${status.key}">${status.label}</span>
              <span class="dl-vcount">&middot; ${vCount === 0 ? 'No versions' : vCount + ' version' + (vCount !== 1 ? 's' : '')}</span>
              ${(() => { const oc = fmtVersions.reduce((s,v) => s + (v.open_comment_count || 0), 0); return oc > 0 ? `<span class="dl-notes-badge">${oc} open</span>` : ''; })()}
              ${lastUpdated ? `<span class="dl-updated">Updated ${lastUpdated}</span>` : ''}
              <span class="dl-chevron"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></span>
            </div>
            <div class="dl-expand">
              <div class="dl-expand-header" onclick="event.stopPropagation()">
                <button class="btn btn-sm" onclick="openClientVersionUploadForFormat('${clientSlug}','${projectSlug}',${fmt.id},'${fmt.type||'video'}')">+ Version</button>
                <div class="kebab-wrap">
                  <button class="kebab-btn" onclick="toggleKebab(this)" title="More">&#8943;</button>
                  <div class="kebab-menu">${kebabItems.join('')}</div>
                </div>
              </div>
              ${versionsHtml}
              ${fmtLinks.length > 0 ? `<div class="dl-links">${fmtLinks.map(l => linkCardHtml(l)).join('')}</div>` : ''}
              ${vCount > 0 ? `<div class="dl-footer" onclick="event.stopPropagation()"><button class="btn btn-muted btn-sm" onclick="openLinkModal('deliverable',${fmt.id})">+ Link</button></div>` : ''}
            </div>
            <div class="format-inline-comments" data-format-id="${fmt.id}" id="inline-comments-${fmt.id}"></div>
          </div>
        `;
      }
    }

    // Build files HTML — using cd-file-row pattern from Client Detail
    let filesHtml = '';
    if (files.length > 0 || projectLinks.length > 0) {
      filesHtml = `<div class="cd-file-list">
        ${files.map(f => {
          const isVis = f.client_visible !== 0;
          return `
          <div class="cd-file-row${isVis ? '' : ' cd-file-internal'}">
            <span class="cd-file-icon">${getResourceIcon(f.original_name, f.mime_type, 18)}</span>
            <a href="${f.file_path}" target="_blank" rel="noopener noreferrer" class="cd-file-name">${escHtml(f.original_name)}</a>
            <span class="cd-file-cat">${f.category}</span>
            <span class="cd-file-vis ${isVis ? 'cd-vis-client' : 'cd-vis-internal'}">${isVis ? 'CLIENT VISIBLE' : 'INTERNAL'}</span>
            <span class="cd-file-size">${formatSize(f.file_size)}</span>
            <div class="cd-file-actions">
              <button class="btn-ghost" onclick="event.stopPropagation();toggleProjectFileVisibility('${clientSlug}', '${projectSlug}', ${f.id}, ${isVis ? 0 : 1})" title="${isVis ? 'Hide from client' : 'Show to client'}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="${isVis ? 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z' : 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2z'}"/></svg>
              </button>
              <button class="btn-ghost btn-ghost-danger" onclick="deleteProjectFile('${clientSlug}', '${projectSlug}', ${f.id})" title="Delete">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              </button>
            </div>
          </div>`;
        }).join('')}
        ${projectLinks.map(l => linkCardHtml(l)).join('')}
      </div>`;
    } else {
      filesHtml = `<div class="admin-empty">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" style="color:var(--text-dim);margin-bottom:12px;"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
        <p>No project files</p>
      </div>`;
    }

    el.innerHTML = `
      <div class="cd-header">
        <div class="cd-header-top">
          <div class="cd-header-info">
            <h2 class="cd-title">${escHtml(project.title)}</h2>
            <div class="cd-meta-line">
              ${project.rf_number ? `<span class="pd-ref">${escHtml(project.rf_number)}</span>` : ''}
            </div>
            ${project.description ? `<p class="pd-desc">${escHtml(project.description)}</p>` : ''}
          </div>
          <div class="cd-actions">
            <button class="btn btn-sm" onclick="copyLink('${window.location.origin}/portal/${clientSlug}/project/${projectSlug}')">Copy Link</button>
            <button class="btn btn-sm" onclick="editClientProject('${clientSlug}', '${projectSlug}')">Edit</button>
            <div class="kebab-wrap">
              <button class="kebab-btn" onclick="toggleKebab(this)" title="More">&#8943;</button>
              <div class="kebab-menu">
                <button class="kebab-item" data-action="view-in-portal" data-link="/portal/${clientSlug}/project/${projectSlug}">View in Portal</button>
                <div class="kebab-divider"></div>
                <button class="kebab-item danger" data-action="delete-project" data-client-slug="${clientSlug}" data-slug="${projectSlug}">Delete Project</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="cd-section">
        <div class="cd-section-head">
          <span class="cd-section-label">Deliverables <span class="cd-section-count">${formats.length}</span></span>
          <button class="btn-primary btn-sm" onclick="addFormat('${clientSlug}', '${projectSlug}')">+ Add Deliverable</button>
        </div>
        ${formatsHtml}
      </div>

      <div class="cd-section">
        <div class="cd-section-head">
          <span class="cd-section-label">Project Files <span class="cd-section-count">${files.length + projectLinks.length}</span></span>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-sm" onclick="openProjectFileUpload('${clientSlug}', '${projectSlug}')">Upload</button>
            <button class="btn btn-sm" onclick="openLinkModal('project_file', ${project.id})">+ Link</button>
          </div>
        </div>
        ${filesHtml}
      </div>

      <div id="project-feedback-panel" style="display:none"></div>
    `;

    // Load feedback asynchronously
    loadProjectFeedback(clientSlug, projectSlug);
  } catch (err) {
    el.innerHTML = '<div class="admin-empty"><p>Error loading project</p></div>';
  }
}

function applyFeedbackFilters(clientSlug, projectSlug) {
  const delivFilter = document.getElementById('feedback-filter-deliverable')?.value || '';
  const statusFilter = document.getElementById('feedback-filter-status')?.value || '';
  const blocks = document.querySelectorAll('.feedback-version-block');
  blocks.forEach(block => {
    const fmtId = block.dataset.formatId || '';
    const matchDeliv = !delivFilter || fmtId === delivFilter;
    const comments = block.querySelectorAll('.feedback-comment');
    let anyVisible = false;
    comments.forEach(c => {
      const isResolved = c.classList.contains('feedback-comment-resolved');
      const matchStatus = !statusFilter || (statusFilter === 'resolved' ? isResolved : !isResolved);
      c.style.display = matchStatus ? '' : 'none';
      if (matchStatus) anyVisible = true;
    });
    block.style.display = matchDeliv && (anyVisible || comments.length === 0) ? '' : 'none';
  });
}

async function loadProjectFeedback(clientSlug, projectSlug) {
  try {
    const res = await fetch(`/api/clients/${clientSlug}/projects/${projectSlug}/feedback`);
    const data = await res.json();
    if (!data.formats || data.formats.length === 0) return;

    // Populate inline comments on each deliverable card
    // Match by finding the format card with matching label since API doesn't return format id
    for (const fmt of data.formats) {
      // Find the inline-comments container by matching data-format-id on format cards
      let container = null;
      const formatCards = document.querySelectorAll('.format-card, .pd-deliv-card, .dl-card');
      for (const card of formatCards) {
        const labelEl = card.querySelector('.format-label strong, .pd-deliv-name, .dl-name');
        if (labelEl && labelEl.textContent === fmt.label) {
          container = card.querySelector('.format-inline-comments');
          break;
        }
      }
      if (!container) continue;

      // Collect all comments across versions for this format
      const allComments = [];
      for (const ver of fmt.versions) {
        if (ver.comments) {
          for (const c of ver.comments) {
            allComments.push({ ...c, version_number: ver.version_number });
          }
        }
      }

      if (allComments.length === 0) {
        container.style.display = 'none';
        continue;
      }

      const unresolvedCount = allComments.filter(c => !c.resolved).length;
      const displayComments = allComments.slice(0, 4); // Show first 4

      const shouldCollapse = allComments.length > 2;
      let html = `<div class="format-inline-comments-header${shouldCollapse ? ' comments-collapsed' : ''}" ${shouldCollapse ? `onclick="this.classList.toggle('comments-collapsed');this.nextElementSibling.classList.toggle('comments-hidden')"` : ''}>
        <span><span class="comment-count">${allComments.length}</span> note${allComments.length !== 1 ? 's' : ''}${unresolvedCount > 0 ? ` · ${unresolvedCount} open` : ''}</span>
        ${shouldCollapse ? '<span class="comments-toggle-hint">View notes ▾</span>' : ''}
      </div>`;
      html += `<div class="inline-comments-body${shouldCollapse ? ' comments-hidden' : ''}">`;

      for (const c of displayComments) {
        const mins = Math.floor(c.timecode_seconds / 60);
        const secs = Math.floor(c.timecode_seconds % 60).toString().padStart(2, '0');
        html += `
          <div class="inline-comment ${c.resolved ? 'inline-comment-resolved' : ''}">
            <span class="inline-comment-timecode">${mins}:${secs}</span>
            <span class="inline-comment-author">${escHtml(c.author_name)}</span>
            <span class="inline-comment-text">${escHtml(c.text)}</span>
            <div class="inline-comment-actions">
              <button class="btn-ghost" style="font-size:10px;padding:2px 6px;" onclick="toggleResolveComment('${clientSlug}', '${projectSlug}', ${c.id}, ${!c.resolved})">${c.resolved ? 'Unresolve' : 'Resolve'}</button>
              <button class="btn-ghost btn-ghost-danger" style="font-size:10px;padding:2px 6px;" onclick="deleteFeedbackComment('${clientSlug}', '${projectSlug}', ${c.id})">Delete</button>
            </div>
          </div>`;
      }

      if (allComments.length > 4) {
        html += `<button class="inline-comment-link" onclick="showAllComments('${clientSlug}','${projectSlug}',${fmt.id})">View all ${allComments.length} notes</button>`;
      }
      html += `</div>`; // close inline-comments-body

      container.innerHTML = html;
      container.style.display = '';
    }
  } catch (err) {
    // Silently fail — inline comments are supplementary
  }
}

// Show all comments (scrolls to legacy panel or expands)
function showAllComments(clientSlug, projectSlug, formatId) {
  // For now, just reload the project detail which shows all inline
  showClientProjectDetail(clientSlug, projectSlug);
}

async function toggleResolveComment(clientSlug, projectSlug, commentId, resolved) {
  await fetch(`/api/clients/${clientSlug}/projects/${projectSlug}/comments/${commentId}/resolve`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolved })
  });
  toast(resolved ? 'Comment resolved' : 'Comment unresolved');
  loadProjectFeedback(clientSlug, projectSlug);
}

async function deleteFeedbackComment(clientSlug, projectSlug, commentId) {
  await safeDelete(`/api/clients/${clientSlug}/projects/${projectSlug}/comments/${commentId}`, 'Delete Comment', 'Are you sure you want to delete this comment?', 'Comment deleted', () => loadProjectFeedback(clientSlug, projectSlug));
}

function deliverableTypeIcon(type) {
  const icons = {
    video: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>',
    document: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>',
    design: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0112 22zm0-18c-4.41 0-8 3.59-8 8s3.59 8 8 8c.28 0 .5-.22.5-.5a.54.54 0 00-.14-.35c-.41-.46-.63-1.05-.63-1.65a2.5 2.5 0 012.5-2.5H16c2.21 0 4-1.79 4-4 0-3.86-3.59-7-8-7z"/></svg>',
    audio: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
  };
  return icons[type] || icons.document;
}

function versionRowHtml(v, clientSlug, projectSlug, delivType, isLatest) {
  const hasFile = v.file_path && v.file_path.length > 0;
  const sizeStr = v.file_size ? formatSize(v.file_size) : '';
  const portalUrl = `/portal/${clientSlug}/project/${projectSlug}`;
  const filename = v.file_path ? v.file_path.split('/').pop() : '';
  const thumbHtml = v.thumbnail
    ? `<img src="${v.thumbnail}" alt="" class="ver-thumb">`
    : `<div class="ver-thumb ver-thumb-placeholder"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg></div>`;

  return `
    <div class="ver-row${isLatest ? ' ver-row-latest' : ''}">
      ${thumbHtml}
      <div class="ver-info">
        <span class="ver-num">v${v.version_number}</span>
        ${isLatest ? '<span class="ver-latest-badge">LATEST</span>' : ''}
        ${v.note ? `<span class="ver-note">${escHtml(v.note)}</span>` : `<span class="ver-filename">${escHtml(filename) || '—'}</span>`}
      </div>
      ${sizeStr ? `<span class="ver-size">${sizeStr}</span>` : ''}
      <span class="ver-date">${new Date(v.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
      <div class="ver-actions">
        ${hasFile ? `<a href="/api/download/version/${v.id}" class="btn-ghost" title="Download"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg></a>` : ''}
        <a href="${portalUrl}" target="_blank" rel="noopener noreferrer" class="btn-ghost" title="View in portal"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg></a>
        <div class="kebab-wrap">
          <button class="kebab-btn" onclick="toggleKebab(this)" title="More" >&#8943;</button>
          <div class="kebab-menu">
            ${hasFile ? `<a href="/api/download/version/${v.id}" class="kebab-item" style="text-decoration:none">Download</a>` : ''}
            <a href="${portalUrl}" target="_blank" rel="noopener noreferrer" class="kebab-item" style="text-decoration:none">View in Portal</a>
            <div class="kebab-divider"></div>
            <button class="kebab-item danger" data-action="delete-version" data-client-slug="${clientSlug}" data-project-slug="${projectSlug}" data-id="${v.id}">Delete Version</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function addFormat(clientSlug, projectSlug) {
  document.getElementById('format-client-slug').value = clientSlug;
  document.getElementById('format-project-slug').value = projectSlug;
  document.getElementById('format-custom-label').value = '';
  document.getElementById('format-type').value = 'video';
  document.getElementById('format-custom-ratio').value = '16:9';
  document.getElementById('format-ratio-group').style.display = '';
  document.getElementById('format-is-hero').checked = false;
  openModal('format-modal');
}

// Show/hide aspect ratio based on type
document.getElementById('format-type').addEventListener('change', (e) => {
  document.getElementById('format-ratio-group').style.display = e.target.value === 'video' ? '' : 'none';
});

document.getElementById('format-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const clientSlug = document.getElementById('format-client-slug').value;
  const projectSlug = document.getElementById('format-project-slug').value;
  const label = document.getElementById('format-custom-label').value.trim();
  const type = document.getElementById('format-type').value;
  const aspect_ratio = type === 'video' ? document.getElementById('format-custom-ratio').value : null;
  const is_hero = document.getElementById('format-is-hero').checked;

  if (!label) { toast('Enter a name'); return; }

  const res = await fetch(`/api/clients/${clientSlug}/projects/${projectSlug}/formats`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, type, aspect_ratio, is_hero })
  });
  if (res.ok) { closeModal('format-modal'); toast('Deliverable added'); showClientProjectDetail(clientSlug, projectSlug); }
  else { const err = await res.json(); toast(err.error || 'Error'); }
});

async function deleteFormat(clientSlug, projectSlug, formatId) {
  await safeDelete(`/api/clients/${clientSlug}/projects/${projectSlug}/formats/${formatId}`, 'Delete Deliverable', 'This will permanently delete this deliverable and all its versions. This cannot be undone.', 'Deliverable deleted', () => showClientProjectDetail(clientSlug, projectSlug));
}

async function setHeroFormat(clientSlug, projectSlug, formatId) {
  // Clear hero on all formats, then set this one
  const fmtRes = await fetch(`/api/clients/${clientSlug}/projects/${projectSlug}/formats`);
  const formats = await fmtRes.json();
  for (const f of formats) {
    if (f.is_hero && f.id !== formatId) {
      await fetch(`/api/clients/${clientSlug}/projects/${projectSlug}/formats/${f.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_hero: false })
      });
    }
  }
  await fetch(`/api/clients/${clientSlug}/projects/${projectSlug}/formats/${formatId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_hero: true })
  });
  toast('Default format set');
  showClientProjectDetail(clientSlug, projectSlug);
}

async function openClientVersionUploadForFirstFormat(clientSlug, projectSlug) {
  try {
    const res = await fetch(`/api/clients/${clientSlug}/projects/${projectSlug}/formats`);
    const formats = await res.json();
    if (formats.length > 0) {
      const hero = formats.find(f => f.is_hero) || formats[0];
      openClientVersionUploadForFormat(clientSlug, projectSlug, hero.id);
    } else {
      openClientVersionUpload(clientSlug, projectSlug);
    }
  } catch {
    openClientVersionUpload(clientSlug, projectSlug);
  }
}

function openClientVersionUploadForFormat(clientSlug, projectSlug, formatId, delivType) {
  openClientVersionUpload(clientSlug, projectSlug);
  const form = document.getElementById('client-version-form');
  form.dataset.formatId = formatId;
  // Set deliverable type for file validation
  document.getElementById('client-version-deliverable-type').value = delivType || 'video';

  // Update file input accept attribute based on type
  const acceptMap = {
    video: 'video/mp4,video/quicktime,.mp4,.mov',
    document: '.pdf,.doc,.docx,application/pdf',
    image: '.png,.jpg,.jpeg,.svg,image/*',
    design: '.ai,.eps,.psd',
    audio: '.wav,.mp3,audio/*',
  };
  const fileInput = document.getElementById('client-version-video-input');
  fileInput.accept = acceptMap[delivType] || '*/*';

  // Update modal title and label
  const typeLabel = { video: 'Video', document: 'Document', image: 'Image', design: 'Design File', audio: 'Audio' }[delivType] || 'File';
  document.getElementById('client-version-modal-title').textContent = `Add ${typeLabel} Version`;
  document.getElementById('client-version-file-label').textContent = `${typeLabel} File`;
}

async function moveDeliverable(clientSlug, projectSlug, formatId, direction) {
  const fmtRes = await fetch(`/api/clients/${clientSlug}/projects/${projectSlug}/formats`);
  const formats = await fmtRes.json();
  const idx = formats.findIndex(f => f.id === formatId);
  if (idx < 0) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= formats.length) return;

  // Swap sort_order values
  const a = formats[idx];
  const b = formats[swapIdx];
  await Promise.all([
    fetch(`/api/clients/${clientSlug}/projects/${projectSlug}/formats/${a.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sort_order: b.sort_order })
    }),
    fetch(`/api/clients/${clientSlug}/projects/${projectSlug}/formats/${b.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sort_order: a.sort_order })
    })
  ]);
  showClientProjectDetail(clientSlug, projectSlug);
}

function openProjectFileUpload(clientSlug, projectSlug) {
  document.getElementById('project-file-client-slug').value = clientSlug;
  document.getElementById('project-file-project-slug').value = projectSlug;
  document.getElementById('project-file-form').reset();
  document.getElementById('project-file-client-slug').value = clientSlug;
  document.getElementById('project-file-project-slug').value = projectSlug;
  openModal('project-file-modal');
}

document.getElementById('project-file-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const clientSlug = document.getElementById('project-file-client-slug').value;
  const projectSlug = document.getElementById('project-file-project-slug').value;
  const file = document.getElementById('project-file-input').files[0];
  if (!file) { toast('Choose a file'); return; }

  const catSelect = document.getElementById('project-file-category');
  const catCustom = document.getElementById('project-file-category-custom');
  const category = catSelect.value === 'other' ? (catCustom.value.trim().toLowerCase().replace(/\s+/g, '-') || 'other') : catSelect.value;

  const fd = new FormData();
  fd.append('file', file);
  fd.append('category', category);

  const res = await fetch(`/api/clients/${clientSlug}/projects/${projectSlug}/files`, { method: 'POST', body: fd });
  if (res.ok) { closeModal('project-file-modal'); toast('File uploaded'); showClientProjectDetail(clientSlug, projectSlug); }
  else { toast('Upload failed'); }
});

async function deleteProjectFile(clientSlug, projectSlug, fileId) {
  await safeDelete(`/api/clients/${clientSlug}/projects/${projectSlug}/files/${fileId}`, 'Delete File', 'Are you sure you want to delete this file?', 'File deleted', () => showClientProjectDetail(clientSlug, projectSlug));
}

async function editClientProject(clientSlug, projectSlug) {
  const res = await fetch(`/api/clients/${clientSlug}/projects`);
  const projects = await res.json();
  const project = projects.find(p => p.slug === projectSlug);
  if (!project) return toast('Project not found');
  document.getElementById('client-project-client-slug').value = clientSlug;
  document.getElementById('client-project-edit-slug').value = projectSlug;
  document.getElementById('client-project-title').value = project.title;
  document.getElementById('client-project-description').value = project.description || '';
  document.getElementById('client-project-rf-number').value = project.rf_number || '';
  document.getElementById('client-project-modal-title').textContent = 'Edit Project';
  document.getElementById('client-project-submit-btn').textContent = 'Save Changes';
  openModal('client-project-modal');
}

async function deleteClientProject(clientSlug, projectSlug) {
  await safeDelete(`/api/clients/${clientSlug}/projects/${projectSlug}`, 'Delete Project', 'Are you sure you want to delete this project and all its versions? This cannot be undone.', 'Project deleted', () => showClientDetail(clientSlug));
}

async function deleteClientVersion(clientSlug, projectSlug, versionId) {
  await safeDelete(`/api/clients/${clientSlug}/projects/${projectSlug}/versions/${versionId}`, 'Delete Version', 'Are you sure you want to delete this version?', 'Version deleted', () => showClientProjectDetail(clientSlug, projectSlug));
}

// ---- Client Version Upload ----
function openClientVersionUpload(clientSlug, projectSlug) {
  document.getElementById('client-version-form').reset();
  delete document.getElementById('client-version-form').dataset.formatId;
  document.getElementById('client-version-client-slug').value = clientSlug;
  document.getElementById('client-version-project-slug').value = projectSlug;
  document.getElementById('client-version-video-path').value = '';
  document.getElementById('client-version-video-name').textContent = '';
  document.getElementById('client-version-submit-btn').disabled = true;
  document.getElementById('client-version-upload-progress').style.display = 'none';
  openModal('client-version-modal');
}

document.getElementById('client-version-video-btn').addEventListener('click', () => {
  document.getElementById('client-version-video-input').click();
});

document.getElementById('client-version-video-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const progressFilled = document.getElementById('client-version-progress-filled');
  const progressText = document.getElementById('client-version-progress-text');
  const progressWrap = document.getElementById('client-version-upload-progress');
  const submitBtn = document.getElementById('client-version-submit-btn');
  const delivType = document.getElementById('client-version-deliverable-type').value || 'video';

  // Client-side validation
  const validation = validateFileClientSide(file, delivType);
  if (!validation.valid) {
    toast(validation.error);
    return;
  }

  document.getElementById('client-version-video-name').textContent = file.name;
  progressWrap.style.display = '';
  progressText.textContent = 'Uploading...';
  submitBtn.disabled = true;
  submitBtn.style.display = 'none';

  // Switch cancel button to "Continue in Background" during upload/transcode
  const cancelBtn = document.querySelector('#client-version-modal .btn-danger');
  const origCancelText = cancelBtn ? cancelBtn.textContent : 'Cancel';

  // Save context for background auto-add
  const clientSlug = document.getElementById('client-version-client-slug').value;
  const projectSlug = document.getElementById('client-version-project-slug').value;
  const formatId = document.getElementById('client-version-form').dataset.formatId;

  // Non-video: use generic upload (no transcode)
  if (delivType !== 'video') {
    await uploadFileChunkedGeneric(file, {
      progressFilled,
      progressText,
      category: delivType,
      cancelBtn,
      onComplete: async (data) => {
        // Create version from assembled file
        const note = document.getElementById('client-version-note').value || '';
        const url = formatId
          ? `/api/clients/${clientSlug}/projects/${projectSlug}/formats/${formatId}/versions`
          : `/api/clients/${clientSlug}/projects/${projectSlug}/versions`;
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ staging_file: data.filename, note, file_size: data.file_size, mime_type: data.mime_type })
          });
          if (res.ok) {
            closeModal('client-version-modal');
            toast('Version added');
            showClientProjectDetail(clientSlug, projectSlug);
          } else {
            const err = await res.json();
            toast(err.error || 'Error adding version');
          }
        } catch (e) {
          toast('Error: ' + e.message);
        }
      },
      onError: (err) => {
        progressText.textContent = 'Upload failed — close and try again';
        toast('Upload failed: ' + err.message);
      }
    });
    document.getElementById('client-version-video-input').value = '';
    return;
  }

  // Video: use existing chunked upload with transcode
  await uploadFileChunked(file, {
    progressFilled,
    progressText,
    progressWrap,
    submitBtn,
    onTranscode: (jobId) => {
      clientVersionTranscodeId = jobId;

      // Show "Continue in Background" option
      if (cancelBtn) cancelBtn.textContent = 'Continue in Background';

      clientVersionTranscodeInterval = setInterval(async () => {
        try {
          const tres = await fetch(`/api/transcode/${clientVersionTranscodeId}`);
          const job = await tres.json();
          const pct = job.progress || 0;

          const modal = document.getElementById('client-version-modal');
          const modalOpen = modal && !modal.classList.contains('hidden');

          // Update modal progress if open
          if (modalOpen) {
            progressFilled.style.width = pct + '%';
            if (job.status === 'generating_thumbnail') {
              progressText.textContent = 'Generating thumbnails...';
            } else if (job.status === 'transcoding') {
              progressText.textContent = `Transcoding ${pct}%`;
            }
          }

          // Update inline indicator on format card (if it exists)
          const inlineBar = document.getElementById('bg-transcode-bar');
          const inlineText = document.getElementById('bg-transcode-text');
          if (inlineBar) inlineBar.style.width = pct + '%';
          if (inlineText) {
            if (job.status === 'generating_thumbnail') inlineText.textContent = 'Generating thumbnails...';
            else if (job.status === 'transcoding') inlineText.textContent = `Transcoding ${pct}%`;
            else if (job.status === 'probing') inlineText.textContent = 'Analysing video...';
            else inlineText.textContent = `Processing... ${pct}%`;
          }

          if (job.status === 'done') {
            clearInterval(clientVersionTranscodeInterval);
            clientVersionTranscodeInterval = null;
            clientVersionVideoPath = job.videoPath;
            if (cancelBtn) cancelBtn.textContent = origCancelText;

            if (modalOpen) {
              document.getElementById('client-version-video-path').value = job.videoPath;
              progressText.textContent = 'Ready';
              submitBtn.disabled = false;
              submitBtn.style.display = '';
            } else {
              // Modal was closed — auto-add the version in background
              const note = document.getElementById('client-version-note').value || '';
              const url = formatId
                ? `/api/clients/${clientSlug}/projects/${projectSlug}/formats/${formatId}/versions`
                : `/api/clients/${clientSlug}/projects/${projectSlug}/versions`;
              try {
                await fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ file_path: job.videoPath, thumbnail: job.thumbnail || '', note })
                });
                toast('Version added (background transcode)');
                // Refresh current view
                if (typeof showClientProjectDetail === 'function') {
                  showClientProjectDetail(clientSlug, projectSlug);
                }
              } catch (e) {
                toast('Background auto-add failed: ' + e.message);
              }
            }
          } else if (job.status === 'error') {
            clearInterval(clientVersionTranscodeInterval);
            clientVersionTranscodeInterval = null;
            if (cancelBtn) cancelBtn.textContent = origCancelText;
            // Remove inline indicator
            const inlineWrap = document.getElementById('bg-transcode-wrap');
            if (inlineWrap) inlineWrap.remove();
            if (modalOpen) {
              progressText.textContent = 'Transcode failed — close and try again';
              submitBtn.disabled = false;
              submitBtn.style.display = '';
            }
            toast('Transcode failed');
          }
        } catch {
          clearInterval(clientVersionTranscodeInterval);
          clientVersionTranscodeInterval = null;
          if (cancelBtn) cancelBtn.textContent = origCancelText;
          if (document.getElementById('client-version-modal') && !document.getElementById('client-version-modal').classList.contains('hidden')) {
            progressText.textContent = 'Connection error — close and try again';
          }
        }
      }, 2000);
    },
    onError: (err) => {
      if (cancelBtn) cancelBtn.textContent = origCancelText;
      progressText.textContent = 'Upload failed — close and try again';
      toast('Upload failed: ' + err.message);
    }
  });

  document.getElementById('client-version-video-input').value = '';
});

document.getElementById('client-version-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const clientSlug = document.getElementById('client-version-client-slug').value;
  const projectSlug = document.getElementById('client-version-project-slug').value;
  const videoPath = document.getElementById('client-version-video-path').value;
  const note = document.getElementById('client-version-note').value;

  if (!videoPath) return;

  // If a format ID was set, post to the format-specific endpoint
  const formatId = document.getElementById('client-version-form').dataset.formatId;
  const url = formatId
    ? `/api/clients/${clientSlug}/projects/${projectSlug}/formats/${formatId}/versions`
    : `/api/clients/${clientSlug}/projects/${projectSlug}/versions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_path: videoPath, note })
  });
  // Clear formatId after use
  delete document.getElementById('client-version-form').dataset.formatId;

  if (res.ok) {
    closeModal('client-version-modal');
    toast('Version added');
    showClientProjectDetail(clientSlug, projectSlug);
  } else {
    const err = await res.json();
    toast(err.error || 'Error adding version');
  }
});

// ---- Resource Upload ----
function openResourceUpload(clientSlug) {
  document.getElementById('resource-form').reset();
  document.getElementById('resource-client-slug').value = clientSlug;
  openModal('resource-modal');
}

document.getElementById('resource-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const clientSlug = document.getElementById('resource-client-slug').value;
  const file = document.getElementById('resource-file-input').files[0];
  if (!file) { toast('Choose a file'); return; }

  const fd = new FormData();
  fd.append('file', file);
  fd.append('category', document.getElementById('resource-category').value);

  const res = await fetch(`/api/clients/${clientSlug}/resources`, { method: 'POST', body: fd });
  if (res.ok) {
    closeModal('resource-modal');
    toast('Resource uploaded');
    showClientDetail(clientSlug);
  } else {
    const err = await res.json();
    toast(err.error || 'Upload failed');
  }
});

async function deleteResource(clientSlug, resourceId) {
  await safeDelete(`/api/clients/${clientSlug}/resources/${resourceId}`, 'Delete Resource', 'Are you sure you want to delete this resource?', 'Resource deleted', () => showClientDetail(clientSlug));
}

async function toggleResourceVisibility(clientSlug, resourceId, visible) {
  await fetch(`/api/clients/${clientSlug}/resources/${resourceId}/visibility`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_visible: visible })
  });
  toast(visible ? 'Resource visible to client' : 'Resource hidden from client');
  showClientDetail(clientSlug);
}

async function toggleProjectFileVisibility(clientSlug, projectSlug, fileId, visible) {
  await fetch(`/api/clients/${clientSlug}/projects/${projectSlug}/files/${fileId}/visibility`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_visible: visible })
  });
  toast(visible ? 'File visible to client' : 'File hidden from client');
  showClientProjectDetail(clientSlug, projectSlug);
}

function uploadClientLogo(slug) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/clients/${slug}/logo`, { method: 'POST', body: fd });
    if (res.ok) {
      toast('Logo uploaded');
      showClientDetail(slug);
    } else {
      toast('Logo upload failed');
    }
  };
  input.click();
}

// ---- Delegated event handlers (CSP-safe) ----
document.addEventListener('click', (e) => {
  const sectionBtn = e.target.closest('[data-section]');
  if (sectionBtn) { showSection(sectionBtn.dataset.section); return; }
  const closeBtn = e.target.closest('[data-close-modal]');
  if (closeBtn) { closeModal(closeBtn.dataset.closeModal); return; }
});

// ---- Browser History ----
window.addEventListener('popstate', (e) => {
  if (e.state?.section === 'client-detail' && e.state.slug) {
    showClientDetail(e.state.slug);
  } else if (e.state?.section === 'client-project-detail' && e.state.clientSlug) {
    showClientProjectDetail(e.state.clientSlug, e.state.projectSlug);
  } else if (e.state?.section) {
    showSection(e.state.section, true);
  } else {
    showSection('home', true);
  }
});

// ---- External Links ----

function detectDocType(url) {
  if (!url) return { type: 'document', label: 'Link' };
  if (url.includes('docs.google.com/document')) return { type: 'document', label: 'Google Doc' };
  if (url.includes('docs.google.com/spreadsheets')) return { type: 'spreadsheet', label: 'Google Sheet' };
  if (url.includes('docs.google.com/presentation')) return { type: 'presentation', label: 'Google Slides' };
  if (url.includes('drive.google.com/drive/folders')) return { type: 'folder', label: 'Google Drive Folder' };
  if (url.includes('drive.google.com/file')) return { type: 'drive_file', label: 'Google Drive File' };
  if (url.includes('google.com')) return { type: 'document', label: 'Google Document' };
  if (url.includes('dropbox.com')) return { type: 'external', label: 'Dropbox Link' };
  if (url.includes('wetransfer.com')) return { type: 'external', label: 'WeTransfer Link' };
  return { type: 'external', label: 'External Link' };
}

function docTypeIcon(type) {
  const icons = {
    document: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="4" y="2" width="16" height="20" rx="2" fill="#4285F4" opacity="0.15" stroke="#4285F4" stroke-width="1.5"/><line x1="8" y1="8" x2="16" y2="8" stroke="#4285F4" stroke-width="1.5"/><line x1="8" y1="12" x2="16" y2="12" stroke="#4285F4" stroke-width="1.5"/><line x1="8" y1="16" x2="13" y2="16" stroke="#4285F4" stroke-width="1.5"/></svg>',
    spreadsheet: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="4" y="2" width="16" height="20" rx="2" fill="#34A853" opacity="0.15" stroke="#34A853" stroke-width="1.5"/><line x1="4" y1="9" x2="20" y2="9" stroke="#34A853" stroke-width="1"/><line x1="4" y1="15" x2="20" y2="15" stroke="#34A853" stroke-width="1"/><line x1="12" y1="2" x2="12" y2="22" stroke="#34A853" stroke-width="1"/></svg>',
    presentation: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="4" y="2" width="16" height="20" rx="2" fill="#FBBC04" opacity="0.15" stroke="#FBBC04" stroke-width="1.5"/><circle cx="12" cy="12" r="4" fill="none" stroke="#FBBC04" stroke-width="1.5"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" fill="#4285F4" opacity="0.2" stroke="#4285F4" stroke-width="1.2"/></svg>',
    drive_file: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z" fill="#4285F4" opacity="0.15" stroke="#4285F4" stroke-width="1.2"/><path d="M14 2v6h6" fill="none" stroke="#4285F4" stroke-width="1.2"/></svg>',
    external: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
  };
  return icons[type] || icons.external;
}

function openLinkModal(linkType, parentId, existingLink) {
  document.getElementById('link-form').reset();
  document.getElementById('link-type').value = linkType;
  document.getElementById('link-parent-id').value = parentId;
  document.getElementById('link-edit-id').value = '';
  document.getElementById('link-modal-title').textContent = 'Add Link';
  document.getElementById('link-submit-btn').textContent = 'Add Link';
  document.getElementById('link-client-visible').checked = true;
  document.getElementById('link-doc-type').value = 'document';
  document.getElementById('link-doc-type-icon').innerHTML = '';
  document.getElementById('link-doc-type-label').textContent = 'Paste a URL to auto-detect';

  if (existingLink) {
    document.getElementById('link-edit-id').value = existingLink.id;
    document.getElementById('link-url').value = existingLink.url;
    document.getElementById('link-title').value = existingLink.title;
    document.getElementById('link-doc-type').value = existingLink.doc_type;
    document.getElementById('link-client-visible').checked = !!existingLink.client_visible;
    document.getElementById('link-modal-title').textContent = 'Edit Link';
    document.getElementById('link-submit-btn').textContent = 'Save';
    const dt = detectDocType(existingLink.url);
    document.getElementById('link-doc-type-icon').innerHTML = docTypeIcon(existingLink.doc_type);
    document.getElementById('link-doc-type-label').textContent = dt.label;
  }

  openModal('link-modal');
}

document.getElementById('link-url').addEventListener('input', (e) => {
  const url = e.target.value.trim();
  const dt = detectDocType(url);
  document.getElementById('link-doc-type').value = dt.type;
  document.getElementById('link-doc-type-icon').innerHTML = docTypeIcon(dt.type);
  document.getElementById('link-doc-type-label').textContent = dt.label;
  const titleField = document.getElementById('link-title');
  if (!titleField.value.trim()) {
    titleField.value = dt.label;
  }
});

document.getElementById('link-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editId = document.getElementById('link-edit-id').value;
  const isEdit = !!editId;
  const data = {
    link_type: document.getElementById('link-type').value,
    parent_id: parseInt(document.getElementById('link-parent-id').value),
    url: document.getElementById('link-url').value.trim(),
    title: document.getElementById('link-title').value.trim(),
    doc_type: document.getElementById('link-doc-type').value,
    client_visible: document.getElementById('link-client-visible').checked
  };

  const url = isEdit ? `/api/external-links/${editId}` : '/api/external-links';
  const method = isEdit ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (res.ok) {
    closeModal('link-modal');
    toast(isEdit ? 'Link updated' : 'Link added');
    if (currentClientProjectSlug && currentClientSlug) {
      showClientProjectDetail(currentClientSlug, currentClientProjectSlug);
    } else if (currentClientSlug) {
      showClientDetail(currentClientSlug);
    }
  } else {
    const err = await res.json();
    toast(err.error || 'Error');
  }
});

async function deleteExternalLink(id) {
  const refresh = () => {
    if (currentClientProjectSlug && currentClientSlug) showClientProjectDetail(currentClientSlug, currentClientProjectSlug);
    else if (currentClientSlug) showClientDetail(currentClientSlug);
  };
  await safeDelete(`/api/external-links/${id}`, 'Delete Link', 'Are you sure you want to delete this link?', 'Link deleted', refresh);
}

async function editExternalLink(id) {
  const linkRes = await fetch(`/api/external-links/${id}`);
  if (!linkRes.ok) { toast('Could not load link'); return; }
  const link = await linkRes.json();
  openLinkModal(link.link_type, link.parent_id, link);
}

function linkCardHtml(link) {
  const icon = docTypeIcon(link.doc_type);
  const internalBadge = !link.client_visible ? '<span class="internal-badge">INTERNAL</span>' : '';
  const internalClass = !link.client_visible ? ' link-card-internal' : '';
  return `
    <div class="link-card${internalClass}">
      <span class="link-card-icon">${icon}</span>
      <span class="link-card-title">${escHtml(link.title)}</span>
      ${internalBadge}
      <a href="${escHtml(link.url)}" target="_blank" rel="noopener" class="btn btn-sm" style="margin-left:auto;flex-shrink:0;">Open</a>
      <div class="kebab-wrap" style="flex-shrink:0;">
        <button class="kebab-btn" onclick="toggleKebab(this)" >&#8943;</button>
        <div class="kebab-menu">
          <button class="kebab-item" data-action="edit-link" data-id="${link.id}">Edit</button>
          <div class="kebab-divider"></div>
          <button class="kebab-item danger" data-action="delete-link" data-id="${link.id}">Delete</button>
        </div>
      </div>
    </div>`;
}

// ---- Init ----
const _initHash = window.location.hash.slice(1);
if (_initHash === 'films') showSection('films');
else if (_initHash === 'requests') showSection('requests');
else if (_initHash.startsWith('client/')) {
  const _parts = _initHash.split('/');
  if (_parts.length === 3) showClientProjectDetail(_parts[1], _parts[2]);
  else showClientDetail(_parts[1]);
} else showSection('home');

loadVideoFiles();
loadThumbFiles();
startGlobalTranscodePoll();
