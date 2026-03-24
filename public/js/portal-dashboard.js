document.addEventListener('DOMContentLoaded', async () => {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  // /portal/:slug or /portal/:slug/resources
  const clientSlug = pathParts[1];
  if (!clientSlug) {
    window.location.href = '/portal';
    return;
  }

  const showResources = pathParts[2] === 'resources';

  try {
    const res = await fetch(`/api/public/portal/${encodeURIComponent(clientSlug)}`);
    if (!res.ok) {
      if (res.status === 429) {
        document.getElementById('portal-body').innerHTML =
          '<div class="empty-state" style="padding-top:200px"><p>Please wait a moment and try again</p></div>';
      } else {
        document.getElementById('portal-body').innerHTML =
          '<div class="empty-state" style="padding-top:200px"><p>Portal not found</p></div>';
      }
      return;
    }
    const data = await res.json();

    document.title = `${data.name} — Client Portal — Webbed Films`;

    if (data.password_protected && !data.projects) {
      // No valid portal session cookie — show password gate
      showPasswordGate(data.name, data.logo, clientSlug, showResources);
    } else {
      renderDashboard(data.name, data.logo, data.projects || [], data.resource_counts || {}, clientSlug, showResources);
    }
  } catch (e) {
    document.getElementById('portal-body').innerHTML =
      '<div class="empty-state" style="padding-top:200px"><p>Unable to load portal</p></div>';
  }
});

function showPasswordGate(name, logo, slug, showResources) {
  const gate = document.getElementById('portal-gate');
  const content = document.getElementById('portal-content');
  gate.style.display = 'flex';
  content.style.display = 'none';

  document.getElementById('portal-gate-title').textContent = name;

  document.getElementById('portal-pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('portal-pw-input').value;
    const errorEl = document.getElementById('portal-pw-error');

    try {
      const res = await fetch(`/api/public/portal/${encodeURIComponent(slug)}/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        const data = await res.json();
        // Password now stored as portal_session cookie by the server
        gate.style.display = 'none';
        renderDashboard(name, logo, data.projects || [], data.resource_counts || {}, slug, showResources);
      } else {
        errorEl.textContent = 'Wrong password';
      }
    } catch {
      errorEl.textContent = 'Error verifying password';
    }
  });
}

function renderDashboard(name, logo, projects, resourceCounts, clientSlug, showResources) {
  const content = document.getElementById('portal-content');
  content.style.display = '';

  document.getElementById('portal-client-name').textContent = name;

  if (logo) {
    const logoEl = document.getElementById('portal-logo');
    logoEl.src = logo;
    logoEl.style.display = '';
  }

  // Projects
  const totalProjects = projects.length;
  document.getElementById('project-count').textContent = totalProjects + ' project' + (totalProjects !== 1 ? 's' : '');

  const grid = document.getElementById('projects-grid');
  if (projects.length === 0) {
    document.getElementById('projects-empty').style.display = '';
  } else {
    grid.innerHTML = projects.map(p => {
      const metaParts = [
        `${p.version_count} version${p.version_count !== 1 ? 's' : ''}`,
        p.updated_at ? new Date(p.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
      ].filter(Boolean);
      const viewBadge = p.max_view_percent >= 75
        ? '<span class="portal-viewed-badge">Viewed</span>'
        : p.max_view_percent > 0 ? `<span class="portal-partial-badge">${p.max_view_percent}% watched</span>` : '';
      return `
      <a class="browse-card portal-project-card" href="/portal/${clientSlug}/project/${p.slug}" style="text-decoration:none;color:inherit;">
        <div class="browse-thumb">
          ${p.latest_thumbnail
            ? `<img src="${p.latest_thumbnail}" alt="${p.title}" loading="lazy">`
            : '<div class="portal-thumb-placeholder"><svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg></div>'}
        </div>
        <div class="browse-overlay portal-overlay">
          <div class="browse-overlay-meta">${metaParts.join(' · ')} ${viewBadge}</div>
          <div class="browse-overlay-title">${p.title}</div>
          <div class="portal-overlay-actions">
            <span class="portal-view-link">View project &rarr;</span>
          </div>
        </div>
      </a>`;
    }).join('');
  }

  // Resources
  const totalResources = Object.values(resourceCounts).reduce((a, b) => a + b, 0);
  document.getElementById('resource-count').textContent = totalResources + ' file' + (totalResources !== 1 ? 's' : '');

  if (totalResources === 0) {
    document.getElementById('resources-empty').style.display = '';
    document.getElementById('resource-filters').style.display = 'none';
  } else {
    renderResourceFilters(resourceCounts, clientSlug);
    loadResources(clientSlug, null);
  }

  // If URL is /portal/:slug/resources, scroll to resources
  if (showResources) {
    document.getElementById('resources-section').scrollIntoView({ behavior: 'smooth' });
  }
}

function renderResourceFilters(counts, clientSlug) {
  const filtersEl = document.getElementById('resource-filters');
  const categories = Object.keys(counts);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const categoryLabels = {
    'scripts': 'Scripts',
    'brand-guidelines': 'Brand Guidelines',
    'logos': 'Logos',
    'graphics': 'Graphics',
    'other': 'Other'
  };

  let html = `<button class="browse-filter active" data-cat="all">All (${total})</button>`;
  for (const cat of categories) {
    html += `<button class="browse-filter" data-cat="${cat}">${categoryLabels[cat] || cat} (${counts[cat]})</button>`;
  }
  filtersEl.innerHTML = html;

  filtersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.browse-filter');
    if (!btn) return;
    filtersEl.querySelectorAll('.browse-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const cat = btn.dataset.cat === 'all' ? null : btn.dataset.cat;
    loadResources(clientSlug, cat);
  });
}

async function loadResources(clientSlug, category) {
  const listEl = document.getElementById('resources-list');
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  const qs = params.toString();
  const url = `/api/public/portal/${encodeURIComponent(clientSlug)}/resources` + (qs ? `?${qs}` : '');

  try {
    const res = await fetch(url);
    const data = await res.json();
    // API returns { files: [...], links: [...] }
    const resources = Array.isArray(data) ? data : (data.files || []);
    const links = Array.isArray(data) ? [] : (data.links || []);

    if (resources.length === 0 && links.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><p>No files in this category</p></div>';
      return;
    }

    const fileHtml = resources.map(r => {
      const icon = getFileIcon(r.mime_type, r.original_name);
      const size = formatFileSize(r.file_size);
      const date = new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const isImage = r.mime_type && r.mime_type.startsWith('image/');

      return `
        <a href="/api/download/resource/${r.id}" class="portal-resource-item" download="${r.original_name}">
          <div class="portal-resource-icon">${icon}</div>
          ${isImage ? `<img src="${r.file_path}" class="portal-resource-preview" alt="${r.original_name}" loading="lazy">` : ''}
          <div class="portal-resource-info">
            <span class="portal-resource-name">${r.original_name}</span>
            <span class="portal-resource-meta">${size} · ${date}</span>
          </div>
          <span class="portal-resource-category">${r.category}</span>
          <svg class="portal-resource-download" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
        </a>
      `;
    }).join('');

    const linkHtml = links.map(l => portalLinkCard(l)).join('');
    listEl.innerHTML = fileHtml + linkHtml;
  } catch {
    listEl.innerHTML = '<div class="empty-state"><p>Unable to load resources</p></div>';
  }
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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

function getFileIcon(mimeType, filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  // Video
  if (['mp4','mov','avi','mkv','webm'].includes(ext) || (mimeType && mimeType.startsWith('video/'))) {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>';
  }
  // Image
  if (['png','jpg','jpeg','gif','webp','tiff','bmp'].includes(ext) || (mimeType && mimeType.startsWith('image/'))) {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';
  }
  // PDF
  if (ext === 'pdf' || (mimeType && mimeType.includes('pdf'))) {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z"/></svg>';
  }
  // Document
  if (['doc', 'docx'].includes(ext)) {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';
  }
  // Design
  if (['svg', 'ai', 'eps', 'psd', 'sketch', 'fig', 'xd'].includes(ext)) {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0112 22z"/></svg>';
  }
  // Audio
  if (['mp3','wav','aac','flac','ogg','m4a'].includes(ext) || (mimeType && mimeType.startsWith('audio/'))) {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
  }
  // Generic document
  return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>';
}

function formatFileSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}
