// Portal VIEW Page — Clean cinematic viewing experience
// No comments, no approval, no markers — just the video

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', async () => {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const clientSlug = pathParts[1];
  const projectSlug = pathParts[3];

  if (!clientSlug || !projectSlug) {
    window.location.href = '/portal';
    return;
  }

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
      document.querySelector('.watch-container').innerHTML =
        '<div class="empty-state" style="padding-top:120px"><p>Project not found</p></div>';
      return;
    }

    const project = await projectRes.json();
    let clientName = clientSlug;
    if (clientRes.ok) {
      const cData = await clientRes.json();
      clientName = cData.name;
    }

    document.title = `${project.title} — ${clientName} — Webbed Films`;

    // Breadcrumb — link to project landing page
    const landingUrl = `/portal/${encodeURIComponent(clientSlug)}/project/${encodeURIComponent(projectSlug)}`;
    document.getElementById('breadcrumb').innerHTML = `
      <a href="/portal/${encodeURIComponent(clientSlug)}">${clientName}</a>
      <span class="portal-breadcrumb-sep">/</span>
      <a href="${landingUrl}">${project.title}</a>
      <span class="portal-breadcrumb-sep">/</span>
      <span>Watch</span>
    `;

    document.getElementById('project-title').textContent = project.title;
    if (project.description) {
      document.getElementById('project-description').textContent = project.description;
    }

    // Set Review button URL (use query param format if viewing specific deliverable)
    const reviewBtn = document.getElementById('review-btn');
    if (reviewBtn) {
      const viewId = new URLSearchParams(window.location.search).get('view');
      reviewBtn.href = viewId
        ? `/portal/${encodeURIComponent(clientSlug)}/project/${encodeURIComponent(projectSlug)}?review=${viewId}`
        : `/portal/${encodeURIComponent(clientSlug)}/project/${encodeURIComponent(projectSlug)}?review=hero`;
    }

    const formats = project.formats || [];
    const hasAnyVersions = formats.some(f => f.versions && f.versions.length > 0);

    if (!hasAnyVersions) {
      document.getElementById('player-wrap').style.display = 'none';
      document.getElementById('no-versions').style.display = '';
    } else {
      initFormatsAndPlayer(formats, clientSlug, projectSlug);
    }

  } catch (e) {
    document.querySelector('.watch-container').innerHTML =
      '<div class="empty-state" style="padding-top:120px"><p>Unable to load project</p></div>';
  }
});

// ---- Play Tracking ----
let commenterName = sessionStorage.getItem('commenter_name') || '';
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
  const versionSelectorEl = document.getElementById('version-selector');
  const noteEl = document.getElementById('version-note');
  const playerWrap = document.getElementById('player-wrap');
  const contentArea = document.getElementById('deliverable-content');

  // Check for ?view=ID query param to select a specific deliverable
  const viewParam = new URLSearchParams(window.location.search).get('view');
  let activeFormat = null;
  if (viewParam) {
    activeFormat = formats.find(f => String(f.id) === viewParam && f.versions.length > 0);
  }
  if (!activeFormat) {
    activeFormat = formats.find(f => f.is_hero && f.versions.length > 0) || formats.find(f => f.versions.length > 0);
  }
  if (!activeFormat) return;

  let currentVersion = activeFormat.versions[0];

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

      renderVersions(format.versions, currentVersion);
      renderDeliverableLinks(format);
      loadDeliverable(format, currentVersion);
    });
  }

  renderVersions(activeFormat.versions, currentVersion);
  renderDeliverableLinks(activeFormat);
  loadDeliverable(activeFormat, currentVersion);

  function renderVersions(versions, selected) {
    const isLatestId = versions.length > 0 ? versions[0].id : null;
    versionSelectorEl.innerHTML = versions.map(v => {
      const isActive = v.id === selected.id;
      const isLatest = v.id === isLatestId && versions.length > 1;
      const dimClass = !isActive ? ' version-dimmed' : '';
      return `
        <button class="portal-version-pill${isActive ? ' active' : ''}${dimClass}" data-id="${v.id}">
          <span class="portal-version-pill-num">V${v.version_number}${isLatest ? ' <span class="version-latest-badge">Latest</span>' : ''}</span>
          <span class="portal-version-pill-date">${new Date(v.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
        </button>
      `;
    }).join('');

    versionSelectorEl.onclick = (e) => {
      const pill = e.target.closest('.portal-version-pill');
      if (!pill) return;
      const vId = parseInt(pill.dataset.id);
      const version = activeFormat.versions.find(v => v.id === vId);
      if (!version || version.id === currentVersion.id) return;
      const video = document.getElementById('video');
      const preservedTime = video ? video.currentTime : 0;
      currentVersion = version;
      renderVersions(activeFormat.versions, currentVersion);
      loadDeliverable(activeFormat, version, preservedTime);
    };
  }

  function loadDeliverable(format, version, seekTo) {
    const type = format.type || 'video';

    // Update download button
    const dlBtn = document.getElementById('download-btn');
    if (dlBtn && version.id) {
      dlBtn.href = `/api/download/version/${version.id}`;
      dlBtn.style.display = '';
      const sizeStr = version.file_size ? ` (${formatFileSize(version.file_size)})` : '';
      dlBtn.textContent = `Download${sizeStr}`;
      dlBtn.title = `Download${sizeStr}`;
    }

    noteEl.textContent = version.note || '';

    if (type === 'video') {
      loadVideoVersion(format, version, seekTo);
    } else {
      playerWrap.style.display = 'none';
      if (!contentArea) return;
      contentArea.style.display = '';

      if (type === 'image') {
        const thumbSrc = version.thumbnail || version.file_path;
        contentArea.innerHTML = `
          <div class="deliverable-preview-card">
            <img src="${thumbSrc}" alt="${format.label}" class="deliverable-preview-img" onclick="this.classList.toggle('expanded')">
            <div class="deliverable-preview-info">
              <span style="color:var(--text-muted)">${delivTypeIcon(type)} Image</span>
              ${version.width && version.height ? `<span style="color:var(--text-muted);font-size:12px">${version.width} × ${version.height}</span>` : ''}
            </div>
          </div>
        `;
      } else if (type === 'document') {
        const docIconLarge = '<div class="deliverable-doc-icon"><svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg></div>';
        const thumbHtml = version.thumbnail
          ? `<img src="${version.thumbnail}" alt="Preview" class="deliverable-doc-thumb" onerror="this.outerHTML='${docIconLarge.replace(/'/g, "\\'")}';">`
          : docIconLarge;
        contentArea.innerHTML = `
          <div class="deliverable-preview-card">
            ${thumbHtml}
            <div class="deliverable-preview-info">
              <span style="color:var(--text-muted)">${delivTypeIcon(type)} Document</span>
              ${version.file_size ? `<span style="color:var(--text-muted);font-size:12px">${formatFileSize(version.file_size)}</span>` : ''}
            </div>
          </div>
        `;
      } else if (type === 'audio') {
        const ext = version.file_path ? version.file_path.split('.').pop().toLowerCase() : '';
        const isPlayable = ext === 'mp3';
        contentArea.innerHTML = `
          <div class="deliverable-preview-card">
            <div class="deliverable-doc-icon">${delivTypeIcon(type)}</div>
            ${isPlayable ? `<audio controls preload="metadata" src="${version.file_path}" style="width:100%;margin-top:12px"></audio>` : ''}
            <div class="deliverable-preview-info">
              <span style="color:var(--text-muted)">${delivTypeIcon(type)} Audio · ${ext.toUpperCase()}</span>
              ${version.file_size ? `<span style="color:var(--text-muted);font-size:12px">${formatFileSize(version.file_size)}</span>` : ''}
            </div>
          </div>
        `;
      } else {
        contentArea.innerHTML = `
          <div class="deliverable-preview-card">
            <div class="deliverable-doc-icon" style="font-size:48px">${delivTypeIcon(type)}</div>
            <div class="deliverable-preview-info">
              <span style="color:var(--text-muted)">${delivTypeIcon(type)} Design File</span>
              ${version.file_size ? `<span style="color:var(--text-muted);font-size:12px">${formatFileSize(version.file_size)}</span>` : ''}
              <span style="color:var(--text-muted);font-size:12px">Download only — no preview available</span>
            </div>
          </div>
        `;
      }
    }
  }

  function loadVideoVersion(format, version, seekTo) {
    playerWrap.style.display = '';
    if (contentArea) contentArea.style.display = 'none';

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

    setupPlayTracking(clientSlug, projectSlug, version.id, video);
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

// ---- Deliverable Links ----

function renderDeliverableLinks(format) {
  const container = document.getElementById('deliverable-links');
  if (!container) return;
  const links = format.links || [];
  if (links.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  container.style.display = '';
  container.innerHTML = links.map(l => portalLinkCard(l)).join('');
}

function portalLinkCard(link) {
  const iconMap = {
    document: '📄',
    spreadsheet: '📊',
    presentation: '📽',
    folder: '📁',
    drive_file: '📎',
    external: '🔗'
  };
  const icon = iconMap[link.doc_type] || '🔗';
  const isGoogle = ['document','spreadsheet','presentation','folder','drive_file'].includes(link.doc_type);
  const buttonLabel = isGoogle ? 'Open in Google' : 'Open Link';
  return `<a href="${escHtml(link.url)}" target="_blank" rel="noopener" class="portal-link-card">
    <span class="portal-link-icon">${icon}</span>
    <span class="portal-link-title">${escHtml(link.title)}</span>
    <span class="portal-link-btn">${buttonLabel} →</span>
  </a>`;
}
