document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('film-grid');
  let allFilms = [];

  // ---- Grade Monitor ----
  const monitor = document.getElementById('monitor');
  let thumbActive = 'a';
  let featuredFilm = null;
  let monitorPlaying = false;

  // Noise canvas
  (function initNoise() {
    const canvas = document.getElementById('monitor-canvas');
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    function resize() {
      canvas.width = canvas.offsetWidth || 800;
      canvas.height = canvas.offsetHeight || 400;
    }
    resize();
    window.addEventListener('resize', resize);
    function draw() {
      const w = canvas.width, h = canvas.height;
      if (!w || !h) { requestAnimationFrame(draw); return; }
      const img = ctx.createImageData(w, h), d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      requestAnimationFrame(draw);
    }
    draw();
  })();

  // Timecode
  (function initTimecode() {
    const el = document.getElementById('timecode');
    if (!el) return;
    const FPS = 25;
    let frame = 0;
    const pad = n => ('0' + n).slice(-2);
    function tick() {
      frame++;
      el.textContent = pad(Math.floor(frame / (FPS*3600)) % 24) + ':' +
                        pad(Math.floor(frame / (FPS*60)) % 60) + ':' +
                        pad(Math.floor(frame / FPS) % 60) + ':' +
                        pad(frame % FPS);
      requestAnimationFrame(tick);
    }
    tick();
  })();

  // Reveal monitor with corners
  setTimeout(() => {
    monitor.classList.add('is-visible');
    document.querySelectorAll('.corner').forEach((c, i) => {
      setTimeout(() => { c.style.opacity = '1'; c.style.transition = 'opacity 0.4s ease'; }, 300 + i * 100);
    });
  }, 200);

  // Load featured film into monitor
  function showInMonitor(film) {
    if (!film || !film.thumbnail) return;
    if (monitorPlaying) return;

    const nextKey = thumbActive === 'a' ? 'b' : 'a';
    const incoming = document.getElementById('monitor-thumb-' + nextKey);
    const outgoing = document.getElementById('monitor-thumb-' + thumbActive);

    if (incoming) {
      incoming.classList.remove('kb-active');
      void incoming.offsetWidth;
      incoming.style.backgroundImage = `url("${film.thumbnail}")`;
      incoming.style.opacity = '0.7';
      incoming.classList.add('kb-active');
    }
    if (outgoing) outgoing.style.opacity = '0';
    thumbActive = nextKey;

    const cat = document.getElementById('hover-cat');
    const title = document.getElementById('hover-title');
    const sub = document.getElementById('hover-subtitle');
    if (cat) {
      cat.textContent = 'Film of the Day';
      cat.style.color = '#DE762B';
    }
    if (title) title.textContent = film.title;
    if (sub) sub.textContent = 'WATCH ▶';
    document.getElementById('monitor-hover').style.opacity = '1';
    document.getElementById('monitor-idle').style.opacity = '0';

    const wash = document.getElementById('monitor-idle-wash');
    if (wash) wash.style.opacity = '0';
  }

  function clearMonitor() {
    if (monitorPlaying) return;
    document.getElementById('monitor-hover').style.opacity = '0';
    document.getElementById('monitor-idle').style.opacity = '1';
    const wash = document.getElementById('monitor-idle-wash');
    if (wash) wash.style.opacity = '1';
    const canvas = document.getElementById('monitor-canvas');
    if (canvas) canvas.style.opacity = '0.055';
  }

  // ---- Inline hero video playback ----
  let heroVideoEl = null;

  function playHeroInline() {
    if (!featuredFilm || !featuredFilm.video) return;
    monitorPlaying = true;

    heroVideoEl = document.createElement('video');
    heroVideoEl.src = featuredFilm.video;
    heroVideoEl.autoplay = true;
    heroVideoEl.controls = false;
    heroVideoEl.playsInline = true;
    heroVideoEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:20;background:#000;cursor:pointer;';
    monitor.appendChild(heroVideoEl);

    document.getElementById('monitor-hover').style.opacity = '0';
    document.getElementById('monitor-idle').style.opacity = '0';
    document.getElementById('monitor-canvas').style.opacity = '0';
    const wash = document.getElementById('monitor-idle-wash');
    if (wash) wash.style.opacity = '0';
    ['monitor-thumb-a', 'monitor-thumb-b'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.opacity = '0';
    });

    const fsEl = monitor;
    if (fsEl.requestFullscreen) fsEl.requestFullscreen();
    else if (fsEl.webkitRequestFullscreen) fsEl.webkitRequestFullscreen();

    heroVideoEl.addEventListener('playing', () => {
      heroVideoEl.controls = true;
    }, { once: true });

    heroVideoEl.addEventListener('ended', stopHeroInline);
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
  }

  function onFsChange() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      stopHeroInline();
    }
  }

  function stopHeroInline() {
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('webkitfullscreenchange', onFsChange);

    if (heroVideoEl) {
      heroVideoEl.pause();
      heroVideoEl.remove();
      heroVideoEl = null;
    }
    monitorPlaying = false;

    if (featuredFilm && featuredFilm.thumbnail) {
      showInMonitor(featuredFilm);
    } else {
      clearMonitor();
    }
    document.getElementById('monitor-canvas').style.opacity = '0.055';
  }

  // ---- Load featured film ----
  try {
    const heroRes = await fetch('/api/public/featured');
    featuredFilm = await heroRes.json();
    if (featuredFilm && featuredFilm.thumbnail) {
      monitor.classList.add('has-featured');
      showInMonitor(featuredFilm);
      monitor.addEventListener('click', (e) => {
        if (monitorPlaying) return;
        e.preventDefault();
        playHeroInline();
      });
    }
  } catch (e) { /* hero is optional */ }

  // ---- Session unlock helpers ----
  function isUnlocked(slug) {
    try {
      const unlocked = JSON.parse(sessionStorage.getItem('unlocked_films') || '[]');
      return unlocked.includes(slug);
    } catch { return false; }
  }

  function markUnlocked(slug) {
    try {
      const unlocked = JSON.parse(sessionStorage.getItem('unlocked_films') || '[]');
      if (!unlocked.includes(slug)) unlocked.push(slug);
      sessionStorage.setItem('unlocked_films', JSON.stringify(unlocked));
    } catch {}
  }

  // ---- Render helpers ----
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function fmtDuration(mins) {
    if (!mins) return '';
    return mins + ' MIN';
  }

  function cardHTML(film) {
    const locked = film.password_protected && !isUnlocked(film.slug);
    const lockIcon = locked ? `<div class="card-lock"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/></svg></div>` : '';
    const cta = locked
      ? '<span class="browse-overlay-cta" style="color:var(--color-muted)">REQUEST ACCESS</span>'
      : '<span class="browse-overlay-cta">WATCH ▶</span>';
    const metaParts = [film.category, film.year, fmtDuration(film.duration)].filter(Boolean).map(p => esc(String(p)));
    const metaLine = metaParts.length ? `<span class="browse-overlay-meta">${metaParts.join(' · ')}</span>` : '';
    const catLabel = film.category ? `<span class="card-info-cat">${esc(film.category)}</span>` : '';
    const yearLabel = film.year ? `<span class="card-info-year">${esc(String(film.year))}</span>` : '';
    return `
    <a class="browse-card${locked ? ' browse-card-locked' : ''}" data-slug="${esc(film.slug)}" data-title="${esc(film.title)}" data-locked="${locked}" href="/watch/${encodeURIComponent(film.slug)}">
      ${lockIcon}
      <div class="browse-thumb">
        <img src="${esc(film.thumbnail)}" alt="${esc(film.title)}" loading="lazy">
      </div>
      <div class="card-info">
        <span class="card-info-title">${esc(film.title)}</span>
        <div class="card-info-meta">${catLabel}${yearLabel}</div>
      </div>
      <div class="browse-overlay">
        ${metaLine}
        <span class="browse-overlay-title">${esc(film.title)}</span>
        ${cta}
      </div>
    </a>`;
  }

  function bindCardClicks(container) {
    container.querySelectorAll('.browse-card').forEach(card => {
      const slug = card.dataset.slug;
      card.addEventListener('click', (e) => {
        if (card.dataset.locked === 'true') {
          e.preventDefault();
          openPasswordModal(slug, card.dataset.title);
        }
        // For unlocked cards, let the <a> href navigate naturally
      });
    });
  }

  let activeCategory = 'all';
  const searchInput = document.getElementById('film-search');
  const filterSelect = document.getElementById('filter-select');

  // ---- Render film cards ----
  function renderFilms(films) {
    if (films.length === 0) {
      grid.innerHTML = '<div class="empty-state"><p>No films yet</p></div>';
      grid.className = 'browse-grid';
      return;
    }

    grid.className = 'browse-grid';
    grid.innerHTML = films.map(film => cardHTML(film)).join('');

    bindCardClicks(grid);
  }

  // ---- Password modal ----
  function openPasswordModal(slug, title) {
    const modal = document.getElementById('password-modal');
    document.getElementById('pw-modal-title').textContent = title;
    document.getElementById('pw-modal-input').value = '';
    document.getElementById('pw-modal-error').textContent = '';
    document.getElementById('pw-request-form').classList.add('hidden');
    document.getElementById('pw-request-success').classList.add('hidden');
    document.getElementById('pw-request-toggle').style.display = '';
    document.getElementById('pw-request-name').value = '';
    document.getElementById('pw-request-email').value = '';
    document.getElementById('pw-request-reason').value = '';
    document.getElementById('pw-request-error').textContent = '';
    modal.dataset.slug = slug;
    modal.classList.remove('hidden');
    document.getElementById('pw-modal-input').focus();
  }

  document.getElementById('pw-modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const modal = document.getElementById('password-modal');
    const slug = modal.dataset.slug;
    const password = document.getElementById('pw-modal-input').value;
    const errorEl = document.getElementById('pw-modal-error');

    try {
      const res = await fetch(`/api/public/films/${slug}/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        markUnlocked(slug);
        sessionStorage.setItem('pw_token_' + slug, password);
        modal.classList.add('hidden');
        window.location.href = `/watch/${slug}`;
      } else {
        errorEl.textContent = 'Wrong password';
      }
    } catch {
      errorEl.textContent = 'Error verifying password';
    }
  });

  document.getElementById('password-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });

  document.getElementById('pw-request-toggle').addEventListener('click', () => {
    document.getElementById('pw-request-form').classList.toggle('hidden');
    document.getElementById('pw-request-toggle').style.display = 'none';
  });

  document.getElementById('pw-request-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const modal = document.getElementById('password-modal');
    const slug = modal.dataset.slug;
    const errorEl = document.getElementById('pw-request-error');

    try {
      const res = await fetch('/api/public/access-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          film_slug: slug,
          name: document.getElementById('pw-request-name').value,
          email: document.getElementById('pw-request-email').value,
          reason: document.getElementById('pw-request-reason').value
        })
      });
      if (res.ok) {
        document.getElementById('pw-request-form').classList.add('hidden');
        document.getElementById('pw-request-success').classList.remove('hidden');
      } else {
        const err = await res.json();
        errorEl.textContent = err.error || 'Failed to send request';
      }
    } catch {
      errorEl.textContent = 'Error sending request';
    }
  });

  // ---- Daily shuffle (seeded by London date) ----
  function dailyShuffle(arr) {
    const shuffled = arr.slice();
    const londonDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    let seed = 0;
    for (let i = 0; i < londonDate.length; i++) seed = ((seed << 5) - seed + londonDate.charCodeAt(i)) | 0;
    function rand() { seed = (seed * 16807 + 0) % 2147483647; return (seed & 0x7fffffff) / 2147483647; }
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // ---- Load films ----
  try {
    const res = await fetch('/api/public/films');
    const rawFilms = await res.json();
    const catMap = {};
    rawFilms.forEach(f => {
      const cat = f.category || 'Other';
      if (!catMap[cat]) catMap[cat] = [];
      catMap[cat].push(f);
    });
    const catKeys = dailyShuffle(Object.keys(catMap));
    allFilms = [];
    catKeys.forEach(cat => {
      allFilms.push(...dailyShuffle(catMap[cat]));
    });
    renderFilms(allFilms);
    updateStatusBar(allFilms);
    const loader = document.getElementById('site-loader');
    if (loader) loader.classList.add('loaded');
  } catch (e) {
    console.error('[watch] Failed to load films:', e);
    grid.innerHTML = '<div class="empty-state"><p>Unable to load films</p></div>';
    grid.className = 'browse-grid';
    const loader = document.getElementById('site-loader');
    if (loader) loader.classList.add('loaded');
    return;
  }

  // ---- Filters ----
  function applyFilters() {
    let filtered = allFilms;
    if (activeCategory !== 'all') {
      filtered = filtered.filter(f => f.category === activeCategory);
    }
    const q = (searchInput ? searchInput.value.trim().toLowerCase() : '');
    if (q) {
      filtered = filtered.filter(f =>
        (f.title || '').toLowerCase().includes(q) ||
        (f.category || '').toLowerCase().includes(q) ||
        String(f.year).includes(q)
      );
    }
    renderFilms(filtered);
  }

  if (searchInput) {
    searchInput.addEventListener('input', applyFilters);
  }

  // Category filter buttons
  document.querySelectorAll('.browse-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.browse-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategory = btn.dataset.cat;
      if (filterSelect) filterSelect.value = activeCategory;
      applyFilters();
    });
  });

  // Mobile category select — sync with buttons
  if (filterSelect) {
    filterSelect.addEventListener('change', () => {
      activeCategory = filterSelect.value;
      document.querySelectorAll('.browse-filter').forEach(b => {
        b.classList.toggle('active', b.dataset.cat === activeCategory);
      });
      applyFilters();
    });
  }

  // ---- Screening code toggle (#10) ----
  const screeningToggle = document.getElementById('screening-toggle');
  const screeningInline = document.getElementById('screening-inline');
  const screeningGo = document.getElementById('screening-go');
  const screeningInput = document.getElementById('screening-code-input');

  if (screeningToggle && screeningInline) {
    screeningToggle.addEventListener('click', () => {
      screeningInline.classList.toggle('open');
      if (screeningInline.classList.contains('open') && screeningInput) {
        screeningInput.focus();
      }
    });
  }
  if (screeningGo && screeningInput) {
    screeningGo.addEventListener('click', () => {
      const code = screeningInput.value.trim();
      if (code) {
        const slug = code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        window.location.href = '/portal/' + encodeURIComponent(slug);
      }
    });
    screeningInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        screeningGo.click();
      }
    });
  }

  // ---- Status Bar ----
  function updateStatusBar(films) {
    const el = document.getElementById('sb-counts');
    if (!el) return;

    const catMap = {};
    films.forEach(f => {
      const cat = f.category || 'Other';
      catMap[cat] = (catMap[cat] || 0) + 1;
    });

    const parts = Object.entries(catMap).map(([cat, count]) => {
      return `<em>${count}</em> ${cat}`;
    });

    el.innerHTML = parts.join(' &nbsp;·&nbsp; ');
  }
});
