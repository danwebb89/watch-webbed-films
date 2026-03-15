document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('film');

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
    // Singularize category (e.g. "Short Films" → "Short Film")
    let category = film.category || '';
    if (category.endsWith(' Films')) category = category.replace(/ Films$/, ' Film');
    // Build meta line — duration added later from video metadata
    const metaEl = document.getElementById('watch-meta');
    const metaParts = [`<span>${category}</span>`, `<span>${film.year}</span>`];
    if (film.role_description) metaParts.push(`<span>${film.role_description}</span>`);
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
        synopsisEl.innerHTML = `<h3>Synopsis</h3><p>${film.synopsis}</p>`;
      }
      if (film.credits) {
        creditsEl.innerHTML = `<h3>Credits</h3><p>${film.credits.replace(/\n/g, '<br>')}</p>`;
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
      showPasswordGate(slug, film, insertDuration);
    } else {
      loadVideo(film.video, insertDuration);
    }
  } catch (e) {
    document.querySelector('.watch-container').innerHTML =
      '<div class="empty-state"><p>// Film not found</p></div>';
  }
});

function showPasswordGate(slug, film, insertDuration) {
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
        // Replace gate with player
        playerWrap.innerHTML = `
          <div class="player-corner player-corner-tl"></div>
          <div class="player-corner player-corner-tr"></div>
          <div class="player-corner player-corner-bl"></div>
          <div class="player-corner player-corner-br"></div>
          <div class="player-scanlines"></div>
          <div class="player-vignette"></div>
          <video id="video" preload="metadata"></video>
          <div id="big-play" class="player-big-play">
            <div class="player-big-play-btn">
              <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
            </div>
          </div>
          <div id="controls" class="player-controls">
            <div id="progress" class="player-progress">
              <div id="progress-filled" class="player-progress-filled"></div>
            </div>
            <div class="player-buttons">
              <button id="btn-play" class="player-btn" title="Play/Pause">
                <svg id="icon-play" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
                <svg id="icon-pause" viewBox="0 0 24 24" style="display:none">
                  <rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/>
                </svg>
              </button>
              <div class="player-volume-wrap">
                <button id="btn-mute" class="player-btn" title="Mute">
                  <svg id="icon-vol" viewBox="0 0 24 24">
                    <path d="M3 9v6h4l5 5V4L7 9H3z"/>
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                  </svg>
                  <svg id="icon-muted" viewBox="0 0 24 24" style="display:none">
                    <path d="M3 9v6h4l5 5V4L7 9H3z"/>
                    <line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2"/>
                    <line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2"/>
                  </svg>
                </button>
                <div id="volume-bar" class="player-volume">
                  <div id="volume-filled" class="player-volume-filled"></div>
                </div>
              </div>
              <div class="player-spacer"></div>
              <span id="time-display" class="player-time">00:00 / 00:00</span>
              <button id="btn-fs" class="player-btn" title="Fullscreen">
                <svg viewBox="0 0 24 24">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                </svg>
              </button>
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
}

// ---- Related Films (smart series detection) ----

// Extract the "series name" from a title by stripping suffixes, separators, and noise
// e.g. "IN NAM 23: Lanzarote" → "in nam"
//      "GiveStar All Stars: Wild Waves" → "givestar all stars"
//      "The Professionals - Episode 3" → "the professionals"
//      "Hello Student: Promo Film" → "hello student"
//      "Shackleton Brand Film V4 (2160p)" → "shackleton"
function extractSeriesName(title) {
  let t = (title || '').trim();
  // Strip quality/version tags in parens/brackets
  t = t.replace(/\s*[\(\[](2160p|1080p|720p|4K|UHD|V\d+)[\)\]]\s*/gi, '').trim();
  // Split on ": " or " - " (series separator)
  const colonIdx = t.indexOf(': ');
  const dashIdx = t.indexOf(' - ');
  let splitIdx = -1;
  if (colonIdx >= 0 && dashIdx >= 0) splitIdx = Math.min(colonIdx, dashIdx);
  else if (colonIdx >= 0) splitIdx = colonIdx;
  else if (dashIdx >= 0) splitIdx = dashIdx;
  if (splitIdx > 0) t = t.substring(0, splitIdx).trim();
  // Strip trailing numbers (series/year identifiers like "IN NAM 23" → "IN NAM")
  t = t.replace(/\s+\d+$/, '').trim();
  // Strip generic film-type suffixes
  t = t.replace(/\s+(Brand Film|Promo Film|Company Film|Campaign Film|Identity Film|Pitch|Launch|Event Film)$/i, '').trim();
  return t.toLowerCase();
}

async function loadRelatedFilms(currentFilm) {
  try {
    const res = await fetch('/api/public/films');
    if (!res.ok) return;
    const allFilms = await res.json();

    const currentSeries = extractSeriesName(currentFilm.title);
    const currentYear = parseInt(currentFilm.year) || 0;

    const scored = allFilms
      .filter(f => f.slug !== currentFilm.slug)
      .map(f => {
        let score = 0;
        let isSeries = false;
        const fSeries = extractSeriesName(f.title);

        // Exact series match (strongest signal)
        // e.g. "in nam" === "in nam", "the professionals" === "the professionals"
        if (currentSeries.length >= 3 && fSeries === currentSeries) {
          score += 25;
          isSeries = true;
        }
        // One series name starts with the other (handles parent/child brands)
        // e.g. "givestar" matches "givestar all stars"
        else if (currentSeries.length >= 4 && fSeries.length >= 4) {
          if (fSeries.startsWith(currentSeries) || currentSeries.startsWith(fSeries)) {
            score += 18;
            isSeries = true;
          }
        }

        // Same category (secondary signal)
        if (f.category && f.category === currentFilm.category) {
          score += isSeries ? 3 : 8;
        }

        // Year proximity (weak tiebreaker)
        const fYear = parseInt(f.year) || 0;
        if (currentYear && fYear) {
          const yearDiff = Math.abs(currentYear - fYear);
          if (yearDiff <= 1) score += 2;
          else if (yearDiff <= 3) score += 1;
        }

        return { film: f, score, isSeries };
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    if (scored.length === 0) return;

    // Smart section title
    const hasSeries = scored.some(s => s.isSeries);
    let sectionTitle;
    if (hasSeries) {
      // Use the series name as the header
      const seriesDisplay = extractSeriesName(currentFilm.title);
      // Capitalise nicely
      const pretty = seriesDisplay.replace(/\b\w/g, c => c.toUpperCase());
      sectionTitle = `More from ${pretty}`;
    } else if (scored.every(s => s.film.category === currentFilm.category)) {
      sectionTitle = `More ${currentFilm.category}`;
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
          <div class="browse-card${locked ? ' browse-card-locked' : ''}" data-slug="${f.slug}" style="cursor:pointer">
            ${lockIcon}
            <div class="browse-thumb">
              <img src="${f.thumbnail}" alt="${f.title}" loading="lazy">
            </div>
            <div class="browse-overlay">
              <span class="browse-overlay-title">${f.title}</span>
              <span class="browse-overlay-cta">WATCH ▶</span>
            </div>
          </div>`;
        }).join('')}
      </div>
    `;

    container.querySelectorAll('.browse-card').forEach(card => {
      card.addEventListener('click', () => {
        window.location.href = `/watch.html?film=${card.dataset.slug}`;
      });
    });
  } catch (e) {
    // Related films are optional — fail silently
  }
}
