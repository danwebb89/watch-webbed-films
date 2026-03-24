// Portal Review Page — Frame.io-style review experience
// All comment, approval, and marker logic lives here

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ---- Shared state ----
let _currentComments = [];
let _currentVersionId = null;
let _activeCommentCleanup = null;
let _commentFilter = 'all'; // 'all', 'unresolved', 'resolved'

document.addEventListener('DOMContentLoaded', async () => {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const clientSlug = pathParts[1];
  const projectSlug = pathParts[3];

  if (!clientSlug || !projectSlug) {
    window.location.href = '/portal';
    return;
  }

  // Set back button URL
  document.getElementById('review-back-btn').href =
    `/portal/${encodeURIComponent(clientSlug)}/project/${encodeURIComponent(projectSlug)}`;

  try {
    const [projectRes, clientRes] = await Promise.all([
      fetch(`/api/public/portal/${encodeURIComponent(clientSlug)}/projects/${encodeURIComponent(projectSlug)}`),
      fetch(`/api/public/portal/${encodeURIComponent(clientSlug)}`)
    ]);

    if (projectRes.status === 401) {
      window.location.href = `/portal/${encodeURIComponent(clientSlug)}`;
      return;
    }
    if (!projectRes.ok) {
      document.querySelector('.review-content').innerHTML =
        '<div class="empty-state" style="padding:120px 32px;text-align:center"><p>Project not found</p></div>';
      return;
    }

    const project = await projectRes.json();
    let clientName = clientSlug;
    if (clientRes.ok) {
      const cData = await clientRes.json();
      clientName = cData.name;
    }

    document.title = `Review: ${project.title} — ${clientName} — Webbed Films`;

    const formats = project.formats || [];
    const hasAnyVersions = formats.some(f => f.versions && f.versions.length > 0);

    if (!hasAnyVersions) {
      document.getElementById('player-wrap').style.display = 'none';
      document.getElementById('no-versions').style.display = '';
      document.getElementById('review-panel').style.display = 'none';
      return;
    }

    initFormatsAndPlayer(formats, clientSlug, projectSlug);
    setupFilterButtons();

  } catch (e) {
    document.querySelector('.review-content').innerHTML =
      '<div class="empty-state" style="padding:120px 32px;text-align:center"><p>Unable to load project</p></div>';
  }
});

// ---- Filter buttons ----
function setupFilterButtons() {
  const filtersEl = document.getElementById('review-filters');
  if (!filtersEl) return;
  filtersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.review-filter-btn');
    if (!btn) return;
    filtersEl.querySelectorAll('.review-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _commentFilter = btn.dataset.filter;
    applyCommentFilter();
  });
}

function applyCommentFilter() {
  const items = document.querySelectorAll('.comment-item');
  items.forEach(el => {
    const isResolved = el.classList.contains('resolved');
    if (_commentFilter === 'all') {
      el.style.display = '';
    } else if (_commentFilter === 'unresolved') {
      el.style.display = isResolved ? 'none' : '';
    } else if (_commentFilter === 'resolved') {
      el.style.display = isResolved ? '' : 'none';
    }
  });
}

// ---- Commenter identity ----
let commenterName = sessionStorage.getItem('commenter_name') || '';

function ensureCommenterName() {
  return new Promise((resolve) => {
    if (commenterName) return resolve(commenterName);
    const bar = document.getElementById('commenter-name-bar');
    bar.style.display = '';
    const input = document.getElementById('commenter-name-input');
    input.focus();
    const saveHandler = () => {
      const name = input.value.trim();
      if (!name) return;
      commenterName = name;
      sessionStorage.setItem('commenter_name', name);
      bar.style.display = 'none';
      resolve(name);
    };
    document.getElementById('commenter-name-save').onclick = saveHandler;
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); saveHandler(); } };
  });
}

// ---- Play Tracking ----
let _trackingCleanup = null;

function setupPlayTracking(clientSlug, projectSlug, versionId, video) {
  if (_trackingCleanup) { _trackingCleanup(); _trackingCleanup = null; }

  let reportedMax = 0;
  const milestones = [25, 50, 75, 100];
  let nextMilestone = 0;

  function onTimeUpdate() {
    if (!video.duration) return;
    const pct = Math.floor((video.currentTime / video.duration) * 100);
    if (pct > reportedMax) {
      reportedMax = pct;
      if (nextMilestone < milestones.length && pct >= milestones[nextMilestone]) {
        const milestone = milestones[nextMilestone];
        nextMilestone++;
        fetch(`/api/public/portal/${clientSlug}/projects/${projectSlug}/versions/${versionId}/view`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ viewer_name: commenterName || '', max_percent: milestone })
        }).catch(() => {});
      }
    }
  }

  video.addEventListener('timeupdate', onTimeUpdate);
  _trackingCleanup = () => video.removeEventListener('timeupdate', onTimeUpdate);
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function delivTypeIcon(type) {
  const icons = {
    video: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>',
    document: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>',
    design: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0112 22z"/></svg>',
    audio: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
  };
  return icons[type] || icons.document;
}

function initFormatsAndPlayer(formats, clientSlug, projectSlug) {
  const formatSelectorEl = document.getElementById('format-selector');
  const playerWrap = document.getElementById('player-wrap');
  const contentArea = document.getElementById('deliverable-content');
  const reviewPanel = document.getElementById('review-panel');
  const topBarName = document.getElementById('review-deliverable-name');
  const versionDropdown = document.getElementById('review-version-dropdown');

  // Check for ?review=ID query param to select a specific deliverable
  const reviewParam = new URLSearchParams(window.location.search).get('review');
  let activeFormat = null;
  if (reviewParam && reviewParam !== 'hero') {
    activeFormat = formats.find(f => String(f.id) === reviewParam && f.versions.length > 0);
  }
  if (!activeFormat) {
    activeFormat = formats.find(f => f.is_hero && f.versions.length > 0) || formats.find(f => f.versions.length > 0);
  }
  if (!activeFormat) return;

  let currentVersion = activeFormat.versions[0];

  // Update top bar
  function updateTopBar() {
    topBarName.textContent = activeFormat.label || 'Video';
  }

  // Version dropdown in top bar
  function populateVersionDropdown() {
    versionDropdown.innerHTML = activeFormat.versions.map(v => {
      const label = `V${v.version_number}${v.note ? ' — ' + v.note : ''}`;
      return `<option value="${v.id}" ${v.id === currentVersion.id ? 'selected' : ''}>${label}</option>`;
    }).join('');
  }

  versionDropdown.addEventListener('change', () => {
    const vId = parseInt(versionDropdown.value);
    const version = activeFormat.versions.find(v => v.id === vId);
    if (!version || version.id === currentVersion.id) return;
    const video = document.getElementById('video');
    const preservedTime = video ? video.currentTime : 0;
    currentVersion = version;
    loadDeliverable(activeFormat, version, preservedTime);
  });

  // Show format selector if 2+ formats with content
  const visibleFormats = formats.filter(f => f.versions.length > 0);
  if (visibleFormats.length > 1) {
    document.getElementById('format-section').style.display = '';
    formatSelectorEl.innerHTML = visibleFormats.map(f => {
      const icon = f.type === 'video' ? getAspectIcon(f.aspect_ratio) : delivTypeIcon(f.type);
      return `
        <button class="portal-format-pill${f.slug === activeFormat.slug ? ' active' : ''}"
                data-slug="${f.slug}">
          ${icon}
          <span class="portal-format-pill-label">${f.label}</span>
        </button>
      `;
    }).join('');

    formatSelectorEl.addEventListener('click', (e) => {
      const pill = e.target.closest('.portal-format-pill');
      if (!pill || pill.disabled) return;
      const fSlug = pill.dataset.slug;
      const format = formats.find(f => f.slug === fSlug);
      if (!format || format.slug === activeFormat.slug) return;

      activeFormat = format;
      currentVersion = format.versions[0];
      formatSelectorEl.querySelectorAll('.portal-format-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');

      updateTopBar();
      populateVersionDropdown();
      loadDeliverable(format, currentVersion);
    });
  }

  updateTopBar();
  populateVersionDropdown();
  loadDeliverable(activeFormat, currentVersion);

  function loadDeliverable(format, version, seekTo) {
    const type = format.type || 'video';

    // Update download button
    const dlBtn = document.getElementById('review-download-btn');
    const dlText = document.getElementById('review-download-text');
    if (dlBtn && version.id) {
      dlBtn.href = `/api/download/version/${version.id}`;
      dlBtn.style.display = '';
      const sizeStr = version.file_size ? ` (${formatFileSize(version.file_size)})` : '';
      dlText.textContent = `Download${sizeStr}`;
    }

    if (type === 'video') {
      loadVideoVersion(format, version, seekTo);
      if (reviewPanel) reviewPanel.style.display = '';
    } else {
      playerWrap.style.display = 'none';
      const inputWrap = document.getElementById('comment-input-wrap');
      if (inputWrap) inputWrap.style.display = 'none';

      if (!contentArea) return;
      contentArea.style.display = '';
      // Non-video rendering (same as portal-project.js)
      renderNonVideoContent(format, version, contentArea);

      if (reviewPanel) {
        reviewPanel.style.display = '';
        const commentsList = document.getElementById('comments-list');
        if (commentsList) commentsList.innerHTML = '';
        const panelHeader = reviewPanel.querySelector('.review-panel-header');
        if (panelHeader) panelHeader.style.display = 'none';
        const emptyMsg = document.getElementById('comments-empty');
        if (emptyMsg) emptyMsg.style.display = 'none';
      }

      loadApproval(clientSlug, projectSlug, version.id);
      setupApprovalButtons(clientSlug, projectSlug, version.id);
    }
  }

  function renderNonVideoContent(format, version, contentArea) {
    const type = format.type || 'video';
    if (type === 'image') {
      const thumbSrc = version.thumbnail || version.file_path;
      contentArea.innerHTML = `
        <div class="deliverable-preview-card">
          <img src="${thumbSrc}" alt="${format.label}" class="deliverable-preview-img" onclick="this.classList.toggle('expanded')">
        </div>
      `;
    } else if (type === 'document') {
      contentArea.innerHTML = `
        <div class="deliverable-preview-card">
          <div class="deliverable-doc-icon">${delivTypeIcon(type)}</div>
          <div class="deliverable-preview-info">
            <span style="color:var(--text-muted)">Document</span>
            ${version.file_size ? `<span style="color:var(--text-muted);font-size:12px">${formatFileSize(version.file_size)}</span>` : ''}
          </div>
        </div>
      `;
    } else {
      contentArea.innerHTML = `
        <div class="deliverable-preview-card">
          <div class="deliverable-doc-icon">${delivTypeIcon(type)}</div>
        </div>
      `;
    }
  }

  function loadVideoVersion(format, version, seekTo) {
    playerWrap.style.display = '';
    if (contentArea) contentArea.style.display = 'none';

    if (reviewPanel) {
      const panelHeader = reviewPanel.querySelector('.review-panel-header');
      if (panelHeader) panelHeader.style.display = '';
    }

    setPlayerAspect(playerWrap, format.aspect_ratio);

    // Check transcode status
    if (version.transcode_status && version.transcode_status !== 'complete') {
      const video = document.getElementById('video');
      if (video) video.style.display = 'none';
      const controls = playerWrap.querySelector('.player-controls');
      if (controls) controls.style.display = 'none';
      const bigPlay = document.getElementById('big-play');
      if (bigPlay) bigPlay.style.display = 'none';
      const loadingEl = document.getElementById('player-loading');
      if (loadingEl) loadingEl.style.display = 'none';

      let processingEl = document.getElementById('processing-message');
      if (!processingEl) {
        processingEl = document.createElement('div');
        processingEl.id = 'processing-message';
        processingEl.className = 'processing-message';
        playerWrap.appendChild(processingEl);
      }
      processingEl.style.display = '';
      processingEl.innerHTML = '<p>This video is being processed.<br>Please check back shortly.</p>';
      return;
    }

    const processingEl = document.getElementById('processing-message');
    if (processingEl) processingEl.style.display = 'none';

    const video = document.getElementById('video');
    if (video) video.style.display = '';
    const controls = playerWrap.querySelector('.player-controls');
    if (controls) controls.style.display = '';
    const bigPlay = document.getElementById('big-play');
    if (bigPlay) bigPlay.style.display = '';

    const loadingEl = document.getElementById('player-loading');
    if (loadingEl) loadingEl.style.display = '';

    video.src = version.file_path;
    video.playbackRate = 1;
    video.load();

    video.addEventListener('canplay', function onReady() {
      video.removeEventListener('canplay', onReady);
      if (loadingEl) loadingEl.style.display = 'none';
      if (seekTo !== undefined && seekTo > 0 && seekTo < video.duration) {
        video.currentTime = seekTo;
      }
    }, { once: true });

    if (typeof initPlayer === 'function') {
      initPlayer(playerWrap);
    }

    _currentVersionId = version.id;
    setupPlayTracking(clientSlug, projectSlug, version.id, video);
    loadComments(clientSlug, projectSlug, version.id);
    loadApproval(clientSlug, projectSlug, version.id);
    setupCommentInput(clientSlug, projectSlug, version.id);
    setupAddNoteButton();
    setupApprovalButtons(clientSlug, projectSlug, version.id);
    setupActiveCommentTracking();
    setupKeyboardShortcuts(clientSlug, projectSlug, version.id);
  }
}

function setPlayerAspect(playerWrap, aspectRatio) {
  playerWrap.classList.remove('player-aspect-16-9', 'player-aspect-1-1', 'player-aspect-9-16', 'player-aspect-4-5');
  switch (aspectRatio) {
    case '1:1': playerWrap.classList.add('player-aspect-1-1'); break;
    case '9:16': playerWrap.classList.add('player-aspect-9-16'); break;
    case '4:5': playerWrap.classList.add('player-aspect-4-5'); break;
    default: playerWrap.classList.add('player-aspect-16-9'); break;
  }
}

function getAspectIcon(ratio) {
  const icons = {
    '16:9': '<svg class="portal-format-icon" viewBox="0 0 24 16"><rect x="1" y="1" width="22" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    '1:1': '<svg class="portal-format-icon" viewBox="0 0 18 18"><rect x="1" y="1" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    '9:16': '<svg class="portal-format-icon" viewBox="0 0 14 22"><rect x="1" y="1" width="12" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    '4:5': '<svg class="portal-format-icon" viewBox="0 0 16 20"><rect x="1" y="1" width="14" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  };
  return icons[ratio] || icons['16:9'];
}

// ---- Comments ----

function formatTimecode(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + tenths;
}

function formatTimecodeShort(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

async function loadComments(clientSlug, projectSlug, versionId) {
  try {
    const res = await fetch(`/api/public/portal/${clientSlug}/projects/${projectSlug}/versions/${versionId}/comments`);
    if (!res.ok) return;
    const comments = await res.json();
    comments.sort((a, b) => (a.timecode_seconds || 0) - (b.timecode_seconds || 0));
    _currentComments = comments;
    renderComments(comments);
    updateStatusBadgeFromComments(comments);
    const video = document.getElementById('video');
    const render = () => renderCommentMarkers(comments, video.duration);
    if (video.duration) render();
    else video.addEventListener('loadedmetadata', render, { once: true });
  } catch {}
}

function renderComments(comments) {
  const listEl = document.getElementById('comments-list');
  const countEl = document.getElementById('comments-count');
  const emptyEl = document.getElementById('comments-empty');

  if (!listEl) return;

  const unresolvedCount = comments.filter(c => !c.resolved).length;

  if (comments.length === 0) {
    listEl.innerHTML = '';
    if (countEl) countEl.textContent = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (countEl) {
    countEl.textContent = `${comments.length} note${comments.length !== 1 ? 's' : ''}${unresolvedCount < comments.length ? ` · ${unresolvedCount} unresolved` : ''}`;
  }

  // Group comments: top-level + replies
  const topLevel = comments.filter(c => !c.parent_id);
  const repliesByParent = {};
  comments.filter(c => c.parent_id).forEach(c => {
    if (!repliesByParent[c.parent_id]) repliesByParent[c.parent_id] = [];
    repliesByParent[c.parent_id].push(c);
  });

  function renderOneComment(c, isReply) {
    const dateStr = c.created_at ? new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    return `
    <div class="comment-item${c.resolved ? ' resolved' : ''}${isReply ? ' comment-reply' : ''}" data-id="${c.id}" data-seconds="${c.timecode_seconds}">
      ${isReply ? '<span class="comment-reply-indent"></span>' : `<span class="comment-timecode" data-seconds="${c.timecode_seconds}">${formatTimecodeShort(c.timecode_seconds)}</span>`}
      <div class="comment-body">
        <div class="comment-meta">
          <span class="comment-author">${escHtml(c.author_name)}</span>
          <span class="comment-date">${dateStr}</span>
        </div>
        <p class="comment-text">${c.text}</p>
        <div class="comment-actions">
          <label class="comment-resolve-toggle" title="${c.resolved ? 'Mark unresolved' : 'Mark resolved'}">
            <input type="checkbox" class="comment-resolve-cb" data-id="${c.id}" ${c.resolved ? 'checked' : ''}>
            <span class="comment-resolve-check"></span>
            <span>${c.resolved ? 'Resolved' : 'Resolve'}</span>
          </label>
          ${!isReply ? `<button class="comment-reply-btn" data-id="${c.id}" data-seconds="${c.timecode_seconds}" data-author="${escHtml(c.author_name)}">Reply</button>` : ''}
        </div>
      </div>
    </div>`;
  }

  listEl.innerHTML = topLevel.map(c => {
    const replies = repliesByParent[c.id] || [];
    return renderOneComment(c, false) + replies.map(r => renderOneComment(r, true)).join('');
  }).join('');

  // Click comment item to seek + highlight
  listEl.querySelectorAll('.comment-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.comment-actions')) return;
      const seconds = parseFloat(el.dataset.seconds);
      const video = document.getElementById('video');
      if (video) video.currentTime = seconds;
      highlightComment(el);
    });
  });

  // Resolve checkboxes
  listEl.querySelectorAll('.comment-resolve-cb').forEach(cb => {
    cb.addEventListener('change', async () => {
      const commentId = cb.dataset.id;
      const resolved = cb.checked;
      const pathParts = window.location.pathname.split('/').filter(Boolean);
      const [clientSlug, , projectSlug] = [pathParts[1], pathParts[2], pathParts[3]];
      const versionId = _currentVersionId;
      try {
        await fetch(`/api/public/portal/${clientSlug}/projects/${projectSlug}/versions/${versionId}/comments/${commentId}/resolve`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolved })
        });
        loadComments(clientSlug, projectSlug, versionId);
      } catch {}
    });
  });

  // Reply buttons
  listEl.querySelectorAll('.comment-reply-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const seconds = parseFloat(btn.dataset.seconds);
      const parentId = btn.dataset.id;
      const video = document.getElementById('video');
      if (video) video.currentTime = seconds;
      video.pause();
      await ensureCommenterName();
      const inputWrap = document.getElementById('comment-input-wrap');
      const badgeEl = document.getElementById('comment-timecode-badge');
      const authorEl = document.getElementById('comment-author-label');
      const textInput = document.getElementById('comment-text-input');
      badgeEl.textContent = '↩ Reply at ' + formatTimecodeShort(seconds);
      authorEl.textContent = 'as ' + commenterName;
      textInput.value = '';
      inputWrap.style.display = '';
      textInput.focus();
      window._replyTimecode = seconds;
      window._replyParentId = parentId;
    });
  });

  applyCommentFilter();
}

function updateStatusBadgeFromComments(comments) {
  // Status badge is updated from approval data, not comments
  // This is a placeholder — actual status comes from loadApproval
}

function highlightComment(el) {
  document.querySelectorAll('.comment-item.active, .comment-item.highlight').forEach(c => {
    c.classList.remove('active', 'highlight');
  });
  el.classList.add('active');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => el.classList.remove('highlight'), 3000);
}

function renderCommentMarkers(comments, duration) {
  const markersContainer = document.getElementById('comment-markers');
  if (!markersContainer || !duration) return;

  markersContainer.querySelectorAll('.comment-marker').forEach(m => m.remove());

  for (const c of comments) {
    const pct = (c.timecode_seconds / duration) * 100;
    const marker = document.createElement('div');
    marker.className = 'comment-marker' + (c.resolved ? ' resolved' : '');
    marker.style.left = pct + '%';
    marker.dataset.id = c.id;
    marker.dataset.seconds = c.timecode_seconds;

    marker.addEventListener('mouseenter', () => showMarkerTooltip(marker, c));
    marker.addEventListener('mouseleave', () => hideMarkerTooltip());

    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      const video = document.getElementById('video');
      if (video) video.currentTime = c.timecode_seconds;
      const item = document.querySelector(`.comment-item[data-id="${c.id}"]`);
      if (item) highlightComment(item);
    });

    markersContainer.appendChild(marker);
  }
}

function showMarkerTooltip(marker, comment) {
  hideMarkerTooltip();
  const tooltip = document.createElement('div');
  tooltip.className = 'marker-tooltip';
  tooltip.innerHTML = `
    <div class="marker-tooltip-author">${escHtml(comment.author_name)}</div>
    <div class="marker-tooltip-text">${escHtml(comment.text).substring(0, 80)}${comment.text.length > 80 ? '...' : ''}</div>
  `;
  marker.appendChild(tooltip);
}

function hideMarkerTooltip() {
  document.querySelectorAll('.marker-tooltip').forEach(t => t.remove());
}

// ---- Comment Input ----

function setupCommentInput(clientSlug, projectSlug, versionId) {
  const progress = document.getElementById('progress');
  const inputWrap = document.getElementById('comment-input-wrap');
  const badgeEl = document.getElementById('comment-timecode-badge');
  const authorEl = document.getElementById('comment-author-label');
  const textInput = document.getElementById('comment-text-input');
  let pendingTimecode = 0;

  if (!progress || !inputWrap) return;

  const markersEl = document.getElementById('comment-markers');
  if (markersEl) {
    const newMarkers = markersEl.cloneNode(true);
    markersEl.parentNode.replaceChild(newMarkers, markersEl);

    newMarkers.addEventListener('click', async (e) => {
      if (e.target.classList.contains('comment-marker')) return;
      openCommentInput(e);
    });
  }

  async function openCommentInput(e) {
    const rect = (document.getElementById('comment-markers') || progress).getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const video = document.getElementById('video');
    pendingTimecode = pct * (video.duration || 0);
    window._replyTimecode = undefined;
    window._replyParentId = undefined;
    video.pause();

    await ensureCommenterName();
    badgeEl.textContent = formatTimecodeShort(pendingTimecode);
    authorEl.textContent = 'as ' + commenterName;
    textInput.value = '';
    inputWrap.style.display = '';
    textInput.focus();
  }

  // Open comment at current time (for keyboard shortcut C)
  window._openCommentAtCurrentTime = async () => {
    const video = document.getElementById('video');
    if (!video) return;
    pendingTimecode = video.currentTime;
    video.pause();

    await ensureCommenterName();
    badgeEl.textContent = formatTimecodeShort(pendingTimecode);
    authorEl.textContent = 'as ' + commenterName;
    textInput.value = '';
    inputWrap.style.display = '';
    textInput.focus();
  };

  // Cancel
  document.getElementById('comment-cancel-btn').onclick = () => {
    inputWrap.style.display = 'none';
  };

  // Submit
  const submitComment = async () => {
    const text = textInput.value.trim();
    if (!text) return;
    const tc = window._replyTimecode !== undefined ? window._replyTimecode : pendingTimecode;
    const body = { timecode_seconds: tc, author_name: commenterName, text };
    if (window._replyParentId) body.parent_id = window._replyParentId;
    try {
      await fetch(`/api/public/portal/${clientSlug}/projects/${projectSlug}/versions/${versionId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      inputWrap.style.display = 'none';
      window._replyTimecode = undefined;
      window._replyParentId = undefined;
      loadComments(clientSlug, projectSlug, versionId);
    } catch {}
  };

  document.getElementById('comment-submit-btn').onclick = submitComment;

  textInput.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitComment();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      inputWrap.style.display = 'none';
    }
  };

  // Auto-pause when comment input is focused
  textInput.addEventListener('focus', () => {
    const video = document.getElementById('video');
    if (video && !video.paused) video.pause();
  });
}

function setupAddNoteButton() {
  const btn = document.getElementById('review-add-note-btn');
  if (!btn) return;
  btn.onclick = () => {
    if (typeof window._openCommentAtCurrentTime === 'function') {
      window._openCommentAtCurrentTime();
    }
  };
}

// ---- Active Comment Tracking ----

function setupActiveCommentTracking() {
  if (_activeCommentCleanup) { _activeCommentCleanup(); _activeCommentCleanup = null; }

  const video = document.getElementById('video');
  if (!video) return;

  let lastActiveId = null;

  function onTimeUpdate() {
    if (!_currentComments.length) return;
    const currentTime = video.currentTime;

    let activeComment = null;
    for (const c of _currentComments) {
      if (c.timecode_seconds <= currentTime && currentTime - c.timecode_seconds < 3) {
        activeComment = c;
      }
    }

    const newId = activeComment ? activeComment.id : null;
    if (newId === lastActiveId) return;
    lastActiveId = newId;

    document.querySelectorAll('.comment-item.active').forEach(el => el.classList.remove('active'));

    if (activeComment) {
      const item = document.querySelector(`.comment-item[data-id="${activeComment.id}"]`);
      if (item) {
        item.classList.add('active');
        const list = document.getElementById('comments-list');
        if (list) {
          const listRect = list.getBoundingClientRect();
          const itemRect = item.getBoundingClientRect();
          if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      }
    }
  }

  video.addEventListener('timeupdate', onTimeUpdate);
  _activeCommentCleanup = () => {
    video.removeEventListener('timeupdate', onTimeUpdate);
    lastActiveId = null;
  };
}

// ---- Keyboard Shortcuts ----

let _keyboardCleanup = null;

function setupKeyboardShortcuts(clientSlug, projectSlug, versionId) {
  if (_keyboardCleanup) { _keyboardCleanup(); _keyboardCleanup = null; }

  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
      if (e.key === 'Escape') {
        const inputWrap = document.getElementById('comment-input-wrap');
        if (inputWrap && inputWrap.style.display !== 'none') {
          inputWrap.style.display = 'none';
          e.preventDefault();
        }
        const approvalWrap = document.getElementById('approval-comment-wrap');
        if (approvalWrap && approvalWrap.style.display !== 'none') {
          approvalWrap.style.display = 'none';
          e.preventDefault();
        }
      }
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'c':
        e.preventDefault();
        if (typeof window._openCommentAtCurrentTime === 'function') {
          window._openCommentAtCurrentTime();
        }
        break;
    }
  }

  document.addEventListener('keydown', onKeyDown);
  _keyboardCleanup = () => document.removeEventListener('keydown', onKeyDown);
}

// ---- Approvals ----

async function loadApproval(clientSlug, projectSlug, versionId) {
  try {
    const res = await fetch(`/api/public/portal/${clientSlug}/projects/${projectSlug}/versions/${versionId}/approval`);
    if (!res.ok) return;
    const approval = await res.json();
    renderApprovalBar(approval);
    renderStatusBadge(approval);
  } catch {}
}

function renderApprovalBar(approval) {
  const bar = document.getElementById('approval-bar');
  const statusEl = document.getElementById('approval-status-display');
  const approveBtn = document.getElementById('btn-approve');
  const changesBtn = document.getElementById('btn-request-changes');

  if (!bar) return;
  bar.style.display = '';

  if (approval && approval.status) {
    if (approval.status === 'approved') {
      statusEl.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="#4CAF50"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Approved by ${escHtml(approval.author_name)}`;
      statusEl.className = 'approval-status approved';
    } else {
      statusEl.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="var(--accent)"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/></svg> Changes requested by ${escHtml(approval.author_name)}`;
      statusEl.className = 'approval-status changes-requested';
    }
    statusEl.style.display = '';
    approveBtn.style.opacity = approval.status === 'approved' ? '0.4' : '';
    changesBtn.style.opacity = approval.status === 'changes_requested' ? '0.4' : '';
  } else {
    statusEl.style.display = 'none';
    approveBtn.style.opacity = '';
    changesBtn.style.opacity = '';
  }
}

function renderStatusBadge(approval) {
  const badge = document.getElementById('review-status-badge');
  if (!badge) return;

  badge.style.display = '';
  if (approval && approval.status === 'approved') {
    badge.textContent = 'Approved';
    badge.className = 'review-status-badge approved';
  } else if (approval && approval.status === 'changes_requested') {
    badge.textContent = 'Changes Requested';
    badge.className = 'review-status-badge changes-requested';
  } else {
    badge.textContent = 'Awaiting Review';
    badge.className = 'review-status-badge pending';
  }
}

function setupApprovalButtons(clientSlug, projectSlug, versionId) {
  const commentWrap = document.getElementById('approval-comment-wrap');
  const commentInput = document.getElementById('approval-comment-input');

  document.getElementById('btn-approve').onclick = async () => {
    await ensureCommenterName();
    try {
      await fetch(`/api/public/portal/${clientSlug}/projects/${projectSlug}/versions/${versionId}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved', author_name: commenterName })
      });
      loadApproval(clientSlug, projectSlug, versionId);
    } catch {}
  };

  document.getElementById('btn-request-changes').onclick = async () => {
    await ensureCommenterName();
    commentWrap.style.display = '';
    commentInput.value = '';
    commentInput.focus();
  };

  document.getElementById('approval-cancel-btn').onclick = () => {
    commentWrap.style.display = 'none';
  };

  document.getElementById('approval-submit-btn').onclick = async () => {
    const comment = commentInput.value.trim();
    if (!comment) return;
    try {
      await fetch(`/api/public/portal/${clientSlug}/projects/${projectSlug}/versions/${versionId}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'changes_requested', author_name: commenterName, comment })
      });
      commentWrap.style.display = 'none';
      loadApproval(clientSlug, projectSlug, versionId);
    } catch {}
  };

  if (commentInput) {
    commentInput.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('approval-submit-btn').click();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        commentWrap.style.display = 'none';
      }
    };
  }
}
