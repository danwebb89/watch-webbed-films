function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

document.addEventListener('DOMContentLoaded', async () => {
  // Support both /watch/:slug (path) and watch.html?film=slug (legacy query param)
  const pathMatch = window.location.pathname.match(/^\/watch\/([^/]+)/);
  const slug = pathMatch ? decodeURIComponent(pathMatch[1]) : new URLSearchParams(window.location.search).get('film');

  if (!slug) {
    window.location.href = '/';
    return;
  }

  try {
    const res = await fetch(`/api/public/films/${slug}`);
    if (!res.ok) { window.location.href = '/'; return; }
    const film = await res.json();

    document.title = `${film.title} — Webbed Films`;
    document.getElementById('watch-title').textContent = film.title;

    // Set poster thumbnail — use cover fit so it fills the frame, switch to contain on play
    if (film.thumbnail) {
      const videoEl = document.getElementById('video');
      videoEl.setAttribute('poster', film.thumbnail);
      videoEl.style.objectFit = 'cover';
      videoEl.addEventListener('playing', () => { videoEl.style.objectFit = ''; }, { once: true });

      // Ambient glow backdrop — blurred thumbnail behind player
      const backdrop = document.getElementById('player-backdrop');
      if (backdrop) {
        const glowImg = document.createElement('img');
        glowImg.src = film.thumbnail;
        glowImg.alt = '';
        glowImg.setAttribute('aria-hidden', 'true');
        glowImg.addEventListener('load', () => glowImg.classList.add('loaded'));
        backdrop.appendChild(glowImg);
      }
    }

    // Singularize category (e.g. "Short Films" → "Short Film")
    let category = film.category || '';
    if (category.endsWith(' Films')) category = category.replace(/ Films$/, ' Film');
    // Build meta line — duration added later from video metadata
    const metaEl = document.getElementById('watch-meta');
    const metaParts = [`<span>${esc(category)}</span>`, `<span>${esc(String(film.year || ''))}</span>`];
    if (film.role_description) metaParts.push(`<span>${esc(film.role_description)}</span>`);
    metaEl.innerHTML = metaParts.join('');

    // Insert duration from video once metadata loads
    function insertDuration(videoEl) {
      videoEl.addEventListener('loadedmetadata', () => {
        const totalSecs = Math.round(videoEl.duration);
        if (!totalSecs || totalSecs <= 0) return;
        const roundedMins = Math.round(totalSecs / 60);
        const durationText = roundedMins > 0 ? `${roundedMins} min` : '< 1 min';
        const durationSpan = document.createElement('span');
        durationSpan.textContent = durationText;
        // Insert after category
        const firstSpan = metaEl.querySelector('span');
        if (firstSpan && firstSpan.nextSibling) {
          metaEl.insertBefore(durationSpan, firstSpan.nextSibling);
        } else {
          metaEl.appendChild(durationSpan);
        }
      }, { once: true });
    }
    document.getElementById('watch-description').textContent = film.description || '';

    // Show extended details
    const detailsWrap = document.getElementById('watch-details');
    if (film.synopsis || film.credits) {
      detailsWrap.style.display = 'block';
      const synopsisEl = document.getElementById('watch-synopsis');
      const creditsEl = document.getElementById('watch-credits');
      if (film.synopsis) {
        synopsisEl.innerHTML = `<h3>Synopsis</h3><p>${esc(film.synopsis)}</p>`;
      }
      if (film.credits) {
        creditsEl.innerHTML = `<h3>Credits</h3><p>${esc(film.credits).replace(/\n/g, '<br>')}</p>`;
      }
    }

    // Load related films
    loadRelatedFilms(film);

    if (film.password_protected && !film.video) {
      // Check if already unlocked in this session (from homepage modal)
      const unlocked = JSON.parse(sessionStorage.getItem('unlocked_films') || '[]');
      const token = sessionStorage.getItem('pw_token_' + slug);
      if (unlocked.includes(slug) && token) {
        // Re-verify with stored password to get video path
        try {
          const vRes = await fetch(`/api/public/films/${slug}/verify-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: token })
          });
          if (vRes.ok) {
            const vData = await vRes.json();
            loadVideo(vData.video, insertDuration);
            return;
          }
        } catch {}
      }
      // Not unlocked or token expired — show password gate
      showPasswordGate(slug, film);
    } else {
      loadVideo(film.video, insertDuration);
    }
  } catch (e) {
    const errorTarget = document.querySelector('.watch-below-wrap') || document.querySelector('.watch-cinema-zone');
    if (errorTarget) errorTarget.innerHTML = '<div class="empty-state"><p>Film not found</p></div>';
  }
});

function showPasswordGate(slug) {
  const playerWrap = document.getElementById('player-wrap');
  playerWrap.innerHTML = `
    <div class="player-password-gate">
      <div class="pw-gate-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
          <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/>
        </svg>
      </div>
      <p class="pw-gate-label">This film is password protected</p>
      <form id="watch-pw-form" class="pw-gate-form">
        <input type="password" id="watch-pw-input" placeholder="Enter password" autocomplete="off">
        <button type="submit" class="btn">Unlock</button>
      </form>
      <p id="watch-pw-error" class="pw-modal-error"></p>
      <div class="pw-modal-divider"><span>or</span></div>
      <button class="pw-request-btn" id="watch-request-toggle">Request Access</button>
      <form id="watch-request-form" class="pw-request-form hidden">
        <input type="text" id="watch-request-name" placeholder="Your name" required>
        <input type="email" id="watch-request-email" placeholder="Your email" required>
        <textarea id="watch-request-reason" placeholder="Reason for access (optional)" rows="2"></textarea>
        <p id="watch-request-error" class="pw-modal-error"></p>
        <button type="submit" class="btn">Send Request</button>
      </form>
      <p id="watch-request-success" class="pw-request-success hidden">Request sent — you'll be contacted when approved.</p>
    </div>
  `;

  document.getElementById('watch-pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('watch-pw-input').value;
    const errorEl = document.getElementById('watch-pw-error');

    try {
      const res = await fetch(`/api/public/films/${slug}/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        const data = await res.json();
        // Save unlocked state + password token for session reuse
        try {
          const unlocked = JSON.parse(sessionStorage.getItem('unlocked_films') || '[]');
          if (!unlocked.includes(slug)) unlocked.push(slug);
          sessionStorage.setItem('unlocked_films', JSON.stringify(unlocked));
          sessionStorage.setItem('pw_token_' + slug, password);
        } catch {}
        // Replace gate with player — IDs must match what initPlayer() expects
        playerWrap.innerHTML = `
          <video id="video" preload="metadata"></video>
          <div id="big-play" class="player-big-play">
            <div class="player-big-play-btn">
              <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
            </div>
          </div>
          <div id="controls" class="player-controls">
            <div id="progress" class="player-progress"><div id="progress-filled" class="player-progress-filled"></div></div>
            <div class="player-buttons">
              <button id="btn-play" class="player-btn" title="Play/Pause">
                <svg id="icon-play" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
                <svg id="icon-pause" viewBox="0 0 24 24" style="display:none"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>
              </button>
              <div class="player-volume-wrap">
                <button id="btn-mute" class="player-btn" title="Mute">
                  <svg id="icon-vol" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
                  <svg id="icon-muted" viewBox="0 0 24 24" style="display:none"><path d="M3 9v6h4l5 5V4L7 9H3z"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2"/></svg>
                </button>
                <div id="volume-bar" class="player-volume"><div id="volume-filled" class="player-volume-filled"></div></div>
              </div>
              <div class="player-spacer"></div>
              <span id="time-display" class="player-time">00:00 / 00:00</span>
              <button id="btn-fs" class="player-btn" title="Fullscreen"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg></button>
            </div>
          </div>
        `;
        loadVideo(data.video, insertDuration);
      } else {
        errorEl.textContent = 'Wrong password';
      }
    } catch {
      errorEl.textContent = 'Error verifying password';
    }
  });

  // Request Access toggle
  document.getElementById('watch-request-toggle').addEventListener('click', () => {
    document.getElementById('watch-request-form').classList.toggle('hidden');
    document.getElementById('watch-request-toggle').style.display = 'none';
  });

  // Request Access form
  document.getElementById('watch-request-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('watch-request-error');
    try {
      const res = await fetch('/api/public/access-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          film_slug: slug,
          name: document.getElementById('watch-request-name').value,
          email: document.getElementById('watch-request-email').value,
          reason: document.getElementById('watch-request-reason').value
        })
      });
      if (res.ok) {
        document.getElementById('watch-request-form').classList.add('hidden');
        document.getElementById('watch-request-success').classList.remove('hidden');
      } else {
        const err = await res.json();
        errorEl.textContent = err.error || 'Failed to send request';
      }
    } catch {
      errorEl.textContent = 'Error sending request';
    }
  });
}

function loadVideo(videoPath, onMetaCallback) {
  const video = document.getElementById('video');
  video.src = videoPath;
  if (onMetaCallback) onMetaCallback(video);
  initPlayer(document.getElementById('player-wrap'));

  // Film info overlay: hide on play, show on pause
  const filmInfo = document.querySelector('.watch-film-info');
  if (filmInfo) {
    video.addEventListener('playing', () => filmInfo.classList.add('playing'));
    video.addEventListener('pause', () => filmInfo.classList.remove('playing'));
    video.addEventListener('ended', () => filmInfo.classList.remove('playing'));
  }
}

// ---- Related Films (smart matching) ----
async function loadRelatedFilms(currentFilm) {
  try {
    const res = await fetch('/api/public/films');
    if (!res.ok) return;
    const allFilms = await res.json();

    // Extract meaningful words from a title (skip common words)
    const stopWords = new Set(['the','a','an','of','in','on','at','to','and','or','for','is','it','my','by']);
    function titleWords(title) {
      return (title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/)
        .filter(w => w.length > 1 && !stopWords.has(w));
    }

    const currentWords = titleWords(currentFilm.title);
    const currentYear = parseInt(currentFilm.year) || 0;

    // Score each film for relevance
    const scored = allFilms
      .filter(f => f.slug !== currentFilm.slug)
      .map(f => {
        let score = 0;

        // Same category: strong signal
        if (f.category && f.category === currentFilm.category) score += 10;

        // Title word overlap: detects series, sequels, related works
        const fWords = titleWords(f.title);
        let wordOverlap = 0;
        for (const w of fWords) {
          if (currentWords.includes(w)) wordOverlap++;
        }
        score += wordOverlap * 5;

        // Year proximity: prefer films from a similar era
        const fYear = parseInt(f.year) || 0;
        if (currentYear && fYear) {
          const yearDiff = Math.abs(currentYear - fYear);
          if (yearDiff <= 1) score += 4;
          else if (yearDiff <= 3) score += 2;
          else if (yearDiff <= 5) score += 1;
        }

        return { film: f, score };
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    if (scored.length === 0) return;

    // Determine section title based on what matched
    const topMatch = scored[0];
    let sectionTitle = 'More Films';
    if (scored.every(s => s.film.category === currentFilm.category)) {
      sectionTitle = `More ${currentFilm.category}`;
    } else if (topMatch.score >= 15) {
      sectionTitle = 'Related Films';
    } else {
      sectionTitle = 'You Might Also Like';
    }

    // Render
    const container = document.getElementById('related-films');
    if (!container) return;

    container.innerHTML = `
      <div class="related-header">
        <span class="related-title">${sectionTitle}</span>
        <span class="related-line"></span>
      </div>
      <div class="related-grid">
        ${scored.map(s => {
          const f = s.film;
          const locked = f.password_protected;
          const lockIcon = locked ? `<div class="card-lock"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/></svg></div>` : '';
          return `
          <div class="browse-card${locked ? ' browse-card-locked' : ''}" data-slug="${esc(f.slug)}" style="cursor:pointer">
            ${lockIcon}
            <div class="browse-thumb">
              <img src="${esc(f.thumbnail)}" alt="${esc(f.title)}" loading="lazy">
            </div>
            <div class="browse-overlay">
              <span class="browse-overlay-title">${esc(f.title)}</span>
              <span class="browse-overlay-cta">WATCH ▶</span>
            </div>
          </div>`;
        }).join('')}
      </div>
    `;

    container.querySelectorAll('.browse-card').forEach(card => {
      card.addEventListener('click', () => {
        window.location.href = `/watch/${card.dataset.slug}`;
      });
    });
  } catch (e) {
    // Related films are optional — fail silently
  }
}
