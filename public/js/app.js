document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('film-grid');
  let allFilms = [];

  // ---- Grade Monitor ----
  const monitor = document.getElementById('monitor');
  let thumbActive = 'a';
  let featuredFilm = null;

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
    const dot = document.getElementById('rec-dot');
    if (dot) dot.classList.add('blinking');
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

    // Show hover info
    const cat = document.getElementById('hover-cat');
    const title = document.getElementById('hover-title');
    const sub = document.getElementById('hover-subtitle');
    if (cat) {
      // Singularize category for individual film display
      let catText = film.category || '';
      if (catText.endsWith(' Films')) catText = catText.replace(/ Films$/, ' Film');
      cat.textContent = catText; cat.style.color = '#c8a96e';
    }
    if (title) title.textContent = film.title;
    if (sub) sub.textContent = 'WATCH ▶';
    document.getElementById('monitor-hover').style.opacity = '1';
    document.getElementById('monitor-idle').style.opacity = '0';

    const wash = document.getElementById('monitor-idle-wash');
    if (wash) wash.style.opacity = '0';
  }

  function clearMonitor() {
    document.getElementById('monitor-hover').style.opacity = '0';
    document.getElementById('monitor-idle').style.opacity = '1';
    const wash = document.getElementById('monitor-idle-wash');
    if (wash) wash.style.opacity = '1';
    const canvas = document.getElementById('monitor-canvas');
    if (canvas) canvas.style.opacity = '0.055';
  }

  try {
    const heroRes = await fetch('/api/public/featured');
    featuredFilm = await heroRes.json();
    if (featuredFilm && featuredFilm.thumbnail) {
      showInMonitor(featuredFilm);
      // Click to watch
      monitor.addEventListener('click', () => {
        window.location.href = `/watch.html?film=${featuredFilm.slug}`;
      });
    }
  } catch (e) { /* hero is optional */ }

  // ---- Card hover → monitor preview ----
  let monitorTimeout = null;

  function hoverCard(film) {
    clearTimeout(monitorTimeout);
    showInMonitor(film);
    const canvas = document.getElementById('monitor-canvas');
    if (canvas) canvas.style.opacity = '0.02';
  }

  function leaveCard() {
    monitorTimeout = setTimeout(() => {
      if (featuredFilm && featuredFilm.thumbnail) {
        showInMonitor(featuredFilm);
      } else {
        clearMonitor();
      }
    }, 600);
  }

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

  // ---- Render masonry cards ----
  function renderFilms(films) {
    if (films.length === 0) {
      grid.innerHTML = '<div class="empty-state"><p>// No films yet</p></div>';
      grid.className = '';
      return;
    }
    grid.className = 'portfolio-grid';
    grid.innerHTML = films.map(film => {
      const locked = film.password_protected && !isUnlocked(film.slug);
      const lockIcon = locked ? `<div class="card-lock"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/></svg></div>` : '';
      const cta = locked ? '<span class="card-cta" style="color:var(--color-muted)">REQUEST ACCESS</span>' : '<span class="card-cta">WATCH ▶</span>';
      return `
      <div class="portfolio-card${locked ? ' portfolio-card-locked' : ''}" data-slug="${film.slug}" data-title="${film.title}" data-locked="${locked}">
        <div class="card-thumb">
          <img src="${film.thumbnail}" alt="${film.title}" loading="lazy" onerror="this.style.display='none'">
          ${lockIcon}
        </div>
        <div class="card-overlay">
          <div class="card-overlay-title">${film.title}</div>
          <div class="card-overlay-meta">${film.category} — ${film.year}</div>
          ${cta}
        </div>
      </div>`;
    }).join('');

    // Scroll-in animation
    observeCards();

    // Card interactions
    grid.querySelectorAll('.portfolio-card').forEach(card => {
      const slug = card.dataset.slug;
      const film = films.find(f => f.slug === slug);

      // Hover → update monitor
      card.addEventListener('mouseenter', () => { if (film) hoverCard(film); });
      card.addEventListener('mouseleave', leaveCard);

      // Click
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

  // ---- Scroll-in observer ----
  function observeCards() {
    const cards = grid.querySelectorAll('.portfolio-card');
    console.log('[WF] observeCards: found', cards.length, 'cards');

    // Force visible immediately — debug
    cards.forEach(c => {
      c.classList.add('is-visible');
      c.style.opacity = '1';
      c.style.transform = 'none';
      c.style.border = '3px solid red';
      c.style.minHeight = '200px';
      c.style.background = 'rgba(255,0,0,0.3)';
    });
    // Also debug the grid itself
    grid.style.border = '3px solid lime';
    grid.style.minHeight = '300px';
    console.log('[WF] Forced all cards visible, grid rect:', grid.getBoundingClientRect());
    cards.forEach((c, i) => console.log('[WF] Card', i, 'rect:', c.getBoundingClientRect()));
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
    console.log('[WF] Fetching films...');
    const res = await fetch('/api/public/films');
    allFilms = await res.json();
    console.log('[WF] Got', allFilms.length, 'films:', allFilms.map(f => f.title));
    renderFilms(allFilms);
    console.log('[WF] renderFilms done, grid children:', grid.children.length);
  } catch (e) {
    console.error('[WF] Film load error:', e);
    grid.innerHTML = '<div class="empty-state"><p>// Unable to load films</p></div>';
    grid.className = '';
    return;
  }

  // ---- Category filter pills ----
  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const cat = btn.dataset.cat;
      if (cat === 'all') {
        renderFilms(allFilms);
      } else {
        renderFilms(allFilms.filter(f => f.category === cat));
      }
    });
  });
});
