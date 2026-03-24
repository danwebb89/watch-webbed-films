document.addEventListener('DOMContentLoaded', async () => {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  // /portal/:slug/project/:projectSlug
  const clientSlug = pathParts[1];
  const projectSlug = pathParts[3];

  if (!clientSlug || !projectSlug) {
    window.location.href = '/portal';
    return;
  }

  const baseUrl = `/portal/${clientSlug}/project/${projectSlug}`;
  document.getElementById('back-to-dashboard').href = `/portal/${clientSlug}`;

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  function formatDuration(seconds) {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function getFileIcon(filename, mimeType) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    const mime = mimeType || '';
    if (['mp4','mov','avi','mkv','webm'].includes(ext) || mime.startsWith('video/'))
      return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>';
    if (['png','jpg','jpeg','gif','webp','tiff','bmp'].includes(ext) || mime.startsWith('image/'))
      return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';
    if (ext === 'pdf' || mime.includes('pdf'))
      return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z"/></svg>';
    if (['doc','docx'].includes(ext))
      return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';
    if (['mp3','wav','aac','flac','ogg'].includes(ext) || mime.startsWith('audio/'))
      return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>';
  }

  function docTypeIcon(type) {
    const icons = {
      document: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="4" y="2" width="16" height="20" rx="2" fill="#4285F4" opacity="0.15" stroke="#4285F4" stroke-width="1.5"/><line x1="8" y1="8" x2="16" y2="8" stroke="#4285F4" stroke-width="1.5"/><line x1="8" y1="12" x2="16" y2="12" stroke="#4285F4" stroke-width="1.5"/><line x1="8" y1="16" x2="13" y2="16" stroke="#4285F4" stroke-width="1.5"/></svg>',
      spreadsheet: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="4" y="2" width="16" height="20" rx="2" fill="#34A853" opacity="0.15" stroke="#34A853" stroke-width="1.5"/><line x1="4" y1="9" x2="20" y2="9" stroke="#34A853" stroke-width="1"/><line x1="4" y1="15" x2="20" y2="15" stroke="#34A853" stroke-width="1"/><line x1="12" y1="2" x2="12" y2="22" stroke="#34A853" stroke-width="1"/></svg>',
      presentation: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="4" y="2" width="16" height="20" rx="2" fill="#FBBC04" opacity="0.15" stroke="#FBBC04" stroke-width="1.5"/><circle cx="12" cy="12" r="4" fill="none" stroke="#FBBC04" stroke-width="1.5"/></svg>',
      folder: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" fill="#4285F4" opacity="0.2" stroke="#4285F4" stroke-width="1.2"/></svg>',
      external: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15,3 21,3 21,9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
    };
    return icons[type] || icons.external;
  }

  // Fetch data
  try {
    const res = await fetch(`/api/public/portal/${clientSlug}/projects/${projectSlug}/overview`);
    if (res.status === 401) {
      window.location.href = `/portal/${clientSlug}`;
      return;
    }
    if (!res.ok) {
      window.location.href = `/portal/${clientSlug}`;
      return;
    }
    const data = await res.json();

    document.title = `${data.project.title} — Webbed Films`;
    document.getElementById('project-title').textContent = data.project.title;
    const rfEl = document.getElementById('project-rf');
    if (data.project.rf_number) {
      rfEl.textContent = data.project.rf_number;
    } else {
      rfEl.style.display = 'none';
    }
    const descEl = document.getElementById('project-description');
    if (data.project.description) {
      descEl.textContent = data.project.description;
    } else {
      descEl.style.display = 'none';
    }

    // Progress summary
    const withContent = data.deliverables.filter(d => d.versions.length > 0);
    const approvedCount = withContent.filter(d => d.approval_status === 'approved').length;
    const totalFiles = data.project_files.length + data.project_links.length;
    const totalResources = data.client_resources.length + data.client_resource_links.length;
    const progressParts = [];
    if (withContent.length > 0) progressParts.push(`${approvedCount} of ${withContent.length} approved`);
    progressParts.push(`${data.deliverables.length} deliverable${data.deliverables.length !== 1 ? 's' : ''}`);
    if (totalFiles > 0) progressParts.push(`${totalFiles} file${totalFiles !== 1 ? 's' : ''}`);
    document.getElementById('project-progress').textContent = progressParts.join(' · ');

    // Render deliverables
    const hero = data.deliverables.find(d => d.is_hero && d.versions.length > 0);
    const others = data.deliverables.filter(d => d !== hero);

    if (hero) {
      document.getElementById('hero-deliverable').innerHTML = renderDeliverableCard(hero, true);
    }

    const gridEl = document.getElementById('deliverable-grid');
    if (others.length > 0) {
      gridEl.innerHTML = others.map(d => renderDeliverableCard(d, false)).join('');
    } else if (!hero) {
      gridEl.innerHTML = '<div class="empty-state"><p>No deliverables yet</p></div>';
    }

    // Render resources
    const allResources = [...data.client_resources, ...data.client_resource_links.map(l => ({ ...l, _isLink: true }))];
    if (allResources.length > 0) {
      document.getElementById('resources-section').style.display = '';
      document.getElementById('resource-list').innerHTML = allResources.map(r => r._isLink ? renderLinkRow(r) : renderFileRow(r)).join('');
    }

    // Render project files
    const allFiles = [...data.project_files, ...data.project_links.map(l => ({ ...l, _isLink: true }))];
    if (allFiles.length > 0) {
      document.getElementById('files-section').style.display = '';
      document.getElementById('files-list').innerHTML = allFiles.map(f => f._isLink ? renderLinkRow(f) : renderFileRow(f)).join('');
    }

    // Show content, hide loader
    document.getElementById('landing-loading').style.display = 'none';
    document.getElementById('landing-content').style.display = '';

    // Dismiss site loader
    const loader = document.getElementById('site-loader');
    if (loader) loader.classList.add('loaded');

  } catch (e) {
    console.error('[landing] Error loading project:', e);
    document.getElementById('landing-loading').innerHTML = '<div class="empty-state"><p>Unable to load project</p></div>';
  }

  function renderDeliverableCard(d, isHero) {
    const hasContent = d.versions.length > 0;
    const latest = d.latest_version;
    const type = d.type || 'video';

    if (!hasContent) {
      return `
        <div class="deliverable-card deliverable-empty">
          <div class="deliverable-thumb deliverable-placeholder">
            <span class="deliverable-placeholder-text">No content</span>
          </div>
          <div class="deliverable-info">
            <h3 class="deliverable-name">${esc(d.label)}</h3>
            <div class="deliverable-meta">
              ${d.aspect_ratio ? `<span class="deliverable-aspect-label">${esc(d.aspect_ratio)}</span>` : ''}
              <span class="deliverable-version-text muted">No content yet</span>
            </div>
          </div>
        </div>`;
    }

    // Thumbnail
    let thumbHtml = '';
    if (type === 'video' && latest.thumbnail) {
      const duration = latest.duration ? `<span class="deliverable-duration">${formatDuration(latest.duration)}</span>` : '';
      const aspect = d.aspect_ratio ? `<span class="deliverable-aspect-badge">${esc(d.aspect_ratio)}</span>` : '';
      thumbHtml = `
        <div class="deliverable-thumb">
          <img src="${esc(latest.thumbnail)}" alt="${esc(d.label)}" loading="lazy">
          ${duration}
          ${aspect}
        </div>`;
    } else if (type === 'image' && latest.file_path) {
      thumbHtml = `
        <div class="deliverable-thumb">
          <img src="${esc(latest.thumbnail || latest.file_path)}" alt="${esc(d.label)}" loading="lazy">
        </div>`;
    } else {
      thumbHtml = `
        <div class="deliverable-thumb deliverable-icon-thumb">
          <span class="deliverable-type-icon">${getFileIcon(latest.file_path || d.label, latest.mime_type)}</span>
        </div>`;
    }

    // Version text
    const vCount = d.versions.length;
    const vText = vCount === 1 ? 'V' + latest.version_number : 'V' + latest.version_number + ' Latest';

    // Approval badge
    let approvalHtml = '';
    if (d.approval_status === 'approved') {
      approvalHtml = '<span class="approval-badge approved">Approved</span>';
    } else if (d.approval_status === 'changes_requested') {
      approvalHtml = '<span class="approval-badge changes-requested">Changes</span>';
    }

    // Notes count
    const notesHtml = d.comment_count > 0
      ? `<span class="deliverable-notes">${d.comment_count} note${d.comment_count !== 1 ? 's' : ''}${d.unresolved_count > 0 ? ' · ' + d.unresolved_count + ' open' : ''}</span>`
      : '';

    // Actions
    let actionsHtml = '';
    if (type === 'video') {
      actionsHtml = `
        <div class="deliverable-actions">
          <a href="${baseUrl}?view=${d.id}" class="btn-watch">Watch</a>
          <a href="${baseUrl}?review=${d.id}" class="btn-review">Review</a>
        </div>`;
    } else if (type === 'image') {
      actionsHtml = `
        <div class="deliverable-actions">
          <a href="${esc(latest.file_path)}" target="_blank" class="btn-view">View</a>
          <a href="/api/download/version/${latest.id}" class="btn-download">Download</a>
        </div>`;
    } else {
      actionsHtml = `
        <div class="deliverable-actions">
          <a href="/api/download/version/${latest.id}" class="btn-download">Download</a>
        </div>`;
    }

    const heroClass = isHero ? ' deliverable-hero' : '';
    return `
      <div class="deliverable-card${heroClass}">
        ${thumbHtml}
        <div class="deliverable-info">
          <h3 class="deliverable-name">${esc(d.label)}</h3>
          <div class="deliverable-meta">
            <span class="deliverable-version-text">${vText}</span>
            ${approvalHtml}
            ${notesHtml}
          </div>
          ${actionsHtml}
        </div>
      </div>`;
  }

  function renderFileRow(f) {
    const icon = getFileIcon(f.original_name, f.mime_type);
    const size = formatSize(f.file_size);
    return `
      <div class="resource-row">
        <span class="resource-icon">${icon}</span>
        <span class="resource-name">${esc(f.original_name)}</span>
        <span class="resource-meta">${size}</span>
        <a class="resource-action" href="${esc(f.file_path)}" download="${esc(f.original_name)}">Download</a>
      </div>`;
  }

  function renderLinkRow(l) {
    const icon = docTypeIcon(l.doc_type || 'external');
    const label = l.doc_type === 'spreadsheet' ? 'Google Sheet'
      : l.doc_type === 'document' ? 'Google Doc'
      : l.doc_type === 'presentation' ? 'Google Slides'
      : l.doc_type === 'folder' ? 'Google Drive'
      : 'Link';
    return `
      <div class="resource-row">
        <span class="resource-icon">${icon}</span>
        <span class="resource-name">${esc(l.title)}</span>
        <span class="resource-meta">${label}</span>
        <a class="resource-action" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">Open &rarr;</a>
      </div>`;
  }
});
