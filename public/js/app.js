document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('film-grid');
  let allFilms = [];

  // ---- Track colors by category ----
  const TRACK_COLORS = {
    'Documentary':    '#55efc4',
    'Corporate':      '#ffeaa7',
    'Feature Films':  '#a29bfe',
    'Short Films':    '#74b9ff',
    'Original':       '#fd79a8',
    'Showreels':      '#e17055',
    'Trailers and BTS': '#dfe6e9',
    'Media Zoo':      '#00cec9',
    'Ratcliffe Studios': '#fab1a0',
    'Revelstoke Films': '#81ecec',
    'Webbed Films':   '#ffeaa7'
  };

  // ---- Grade Monitor ----
  const monitor = document.getElementById('monitor');
  let thumbActive = 'a';
  let featuredFilm = null;
  let monitorPlaying = false; // true when hero video is playing inline

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
    if (monitorPlaying) return; // don't replace while video is playing

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
      cat.style.color = '#c8a96e';
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

    // Create video element inside monitor
    heroVideoEl = document.createElement('video');
    heroVideoEl.src = featuredFilm.video;
    heroVideoEl.autoplay = true;
    heroVideoEl.controls = false;
    heroVideoEl.playsInline = true;
    heroVideoEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:20;background:#000;cursor:pointer;';
    monitor.appendChild(heroVideoEl);

    // Hide all overlays
    document.getElementById('monitor-hover').style.opacity = '0';
    document.getElementById('monitor-idle').style.opacity = '0';
    document.getElementById('monitor-canvas').style.opacity = '0';
    const wash = document.getElementById('monitor-idle-wash');
    if (wash) wash.style.opacity = '0';
    ['monitor-thumb-a', 'monitor-thumb-b'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.opacity = '0';
    });

    // Request fullscreen
    const fsEl = monitor;
    if (fsEl.requestFullscreen) fsEl.requestFullscreen();
    else if (fsEl.webkitRequestFullscreen) fsEl.webkitRequestFullscreen();

    // Show native controls once playing
    heroVideoEl.addEventListener('playing', () => {
      heroVideoEl.controls = true;
    }, { once: true });

    // When video ends or fullscreen exits, clean up
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

    // Restore monitor state
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
      showInMonitor(featuredFilm);
      // Click hero → play inline fullscreen
      monitor.addEventListener('click', (e) => {
        if (monitorPlaying) return;
        e.preventDefault();
        playHeroInline();
      });
    }
  } catch (e) { /* hero is optional */ }

  // ---- Card hover (no monitor change — keep Film of the Day locked) ----

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

  // ---- Render film cards (browse-card style) ----
  function renderFilms(films) {
    if (films.length === 0) {
      grid.innerHTML = '<div class="empty-state"><p>// No films yet</p></div>';
      grid.className = 'browse-grid';
      return;
    }
    grid.className = 'browse-grid';
    grid.innerHTML = films.map(film => {
      const locked = film.password_protected && !isUnlocked(film.slug);
      const lockIcon = locked ? `<div class="card-lock"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/></svg></div>` : '';
      const cta = locked
        ? '<span class="browse-overlay-cta" style="color:var(--color-muted)">REQUEST ACCESS</span>'
        : '<span class="browse-overlay-cta">WATCH ▶</span>';
      return `
      <div class="browse-card${locked ? ' browse-card-locked' : ''}" data-slug="${film.slug}" data-title="${film.title}" data-locked="${locked}">
        ${lockIcon}
        <div class="browse-thumb">
          <img src="${film.thumbnail}" alt="${film.title}" loading="lazy">
        </div>
        <div class="browse-overlay">
          <span class="browse-overlay-cat">${film.category || ''} — ${film.year || ''}</span>
          <span class="browse-overlay-title">${film.title}</span>
          ${cta}
        </div>
      </div>`;
    }).join('');

    // Card interactions
    grid.querySelectorAll('.browse-card').forEach(card => {
      const slug = card.dataset.slug;
      const film = films.find(f => f.slug === slug);

      card.addEventListener('click', (e) => {
        e.preventDefault();
        if (card.dataset.locked === 'true') {
          openPasswordModal(slug, card.dataset.title);
        } else {
          window.location.href = `/watch.html?film=${slug}`;
        }
      });
    });
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
        modal.classList.add('hidden');
        window.location.href = `/watch.html?film=${slug}`;
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

  // ---- Load films ----
  try {
    const res = await fetch('/api/public/films');
    allFilms = await res.json();
    renderFilms(allFilms);
    buildTimeline(allFilms);
    updateStatusBar(allFilms);
  } catch (e) {
    grid.innerHTML = '<div class="empty-state"><p>// Unable to load films</p></div>';
    grid.className = 'browse-grid';
    return;
  }

  // ---- Category filter buttons ----
  document.querySelectorAll('.browse-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.browse-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const cat = btn.dataset.cat;
      if (cat === 'all') {
        renderFilms(allFilms);
      } else {
        renderFilms(allFilms.filter(f => f.category === cat));
      }
    });
  });

  // ════════════════════════════════════
  //  TIMELINE PANEL
  // ════════════════════════════════════

  function buildTimeline(films) {
    const sidebar = document.getElementById('track-sidebar');
    const lanes = document.getElementById('track-lanes');
    const ruler = document.getElementById('tc-ruler');
    if (!sidebar || !lanes || !ruler) return;

    // Group films by category
    const catMap = {};
    films.forEach(f => {
      const cat = f.category || 'Uncategorised';
      if (!catMap[cat]) catMap[cat] = [];
      catMap[cat].push(f);
    });

    const categories = Object.keys(catMap);
    if (categories.length === 0) return;

    // Calculate timeline width based on total films
    const totalClips = films.length;
    const timelineWidth = Math.max(1600, totalClips * 180);
    document.getElementById('timeline-inner').style.width = timelineWidth + 'px';

    // Build ruler ticks
    ruler.innerHTML = '';
    const tickInterval = 100;
    const majorInterval = 500;
    let tc = 0;
    for (let px = 0; px < timelineWidth; px += tickInterval) {
      const isMajor = px % majorInterval === 0;
      const tick = document.createElement('div');
      tick.className = 'tc-tick' + (isMajor ? ' tc-tick-major' : '');
      tick.style.left = px + 'px';
      ruler.appendChild(tick);

      if (isMajor) {
        const mark = document.createElement('div');
        mark.className = 'tc-mark';
        mark.style.left = px + 'px';
        const h = Math.floor(tc / 3600);
        const m = Math.floor((tc % 3600) / 60);
        const s = tc % 60;
        mark.textContent = String(h).padStart(2, '0') + ':' +
                           String(m).padStart(2, '0') + ':' +
                           String(s).padStart(2, '0') + ':00';
        ruler.appendChild(mark);
      }
      tc += 4;
    }

    // Build sidebar headers + track lanes
    sidebar.innerHTML = '';
    lanes.innerHTML = '';

    categories.forEach(cat => {
      const color = TRACK_COLORS[cat] || '#aaa';
      const count = catMap[cat].length;

      // Sidebar header
      const header = document.createElement('div');
      header.className = 'track-header';
      header.innerHTML = `
        <div class="track-swatch" style="background:${color}"></div>
        <span class="track-label">${cat}</span>
        <span class="track-count">${count}</span>
      `;
      sidebar.appendChild(header);

      // Track lane with clip blocks
      const lane = document.createElement('div');
      lane.className = 'track-lane';

      const catFilms = catMap[cat];
      catFilms.forEach((film, i) => {
        // Random gap before clip
        if (i > 0 && Math.random() > 0.4) {
          const gap = document.createElement('div');
          gap.className = 'clip-gap';
          gap.style.width = (8 + Math.random() * 30) + 'px';
          lane.appendChild(gap);
        }

        const clip = document.createElement('div');
        clip.className = 'clip-block';
        clip.style.flex = (0.6 + Math.random() * 1.4).toFixed(2);
        clip.style.borderLeftColor = color;
        if (film.thumbnail) {
          clip.style.backgroundImage = `url("${film.thumbnail}")`;
        } else {
          clip.style.background = `linear-gradient(135deg, ${color}22, ${color}08)`;
        }
        clip.title = film.title;
        clip.addEventListener('click', () => {
          window.location.href = `/watch.html?film=${film.slug}`;
        });
        lane.appendChild(clip);
      });

      lanes.appendChild(lane);
    });

    // Playhead animation
    const playhead = document.getElementById('playhead');
    if (playhead) {
      let pos = 60;
      function animatePlayhead() {
        pos += 0.3;
        if (pos > timelineWidth) pos = 60;
        playhead.style.left = pos + 'px';
        requestAnimationFrame(animatePlayhead);
      }
      animatePlayhead();
    }
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
      const color = TRACK_COLORS[cat] || '#aaa';
      return `<em style="color:${color}">${count}</em> ${cat}`;
    });

    el.innerHTML = parts.join(' &nbsp;·&nbsp; ');
  }
});
