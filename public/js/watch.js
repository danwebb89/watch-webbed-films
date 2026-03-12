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
        const secs = Math.round(videoEl.duration);
        if (!secs || secs <= 0) return;
        const mins = Math.floor(secs / 60);
        const rem = secs % 60;
        const durationText = mins > 0 ? `${mins} min ${rem > 0 ? rem + ' sec' : ''}`.trim() : `${rem} sec`;
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
    document.querySelector('.watch-container').innerHTML =
      '<div class="empty-state"><p>// Film not found</p></div>';
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
        // Replace gate with player
        playerWrap.innerHTML = `
          <video id="video" preload="metadata"></video>
          <div class="player-big-play" id="big-play">
            <div class="player-big-play-btn">
              <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
            </div>
          </div>
          <div class="player-controls">
            <div class="player-progress" id="progress"><div class="player-progress-filled" id="progress-filled"></div></div>
            <div class="player-buttons">
              <button class="player-btn" id="play-btn"><svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></button>
              <div class="player-volume-wrap">
                <button class="player-btn" id="mute-btn"><svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.14v7.72A4.5 4.5 0 0016.5 12zM14 3.23v2.06a6.5 6.5 0 010 13.42v2.06A8.5 8.5 0 0014 3.23z"/></svg></button>
                <div class="player-volume" id="volume"><div class="player-volume-filled" id="volume-filled"></div></div>
              </div>
              <div class="player-spacer"></div>
              <span class="player-time" id="time">0:00 / 0:00</span>
              <button class="player-btn" id="fs-btn"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg></button>
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
