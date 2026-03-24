/**
 * Custom video player — gold-accented, keyboard-driven.
 * Call initPlayer(containerEl) after the DOM is ready.
 */

// Track document-level listeners so we can remove them on reinit
let _playerDocListeners = [];
function _addDocListener(event, handler) {
  document.addEventListener(event, handler);
  _playerDocListeners.push({ event, handler });
}
function _cleanupDocListeners() {
  for (const { event, handler } of _playerDocListeners) {
    document.removeEventListener(event, handler);
  }
  _playerDocListeners = [];
}

function initPlayer(wrap) {
  _cleanupDocListeners();
  const video = wrap.querySelector('video');
  const bigPlay = wrap.querySelector('.player-big-play');
  const controls = wrap.querySelector('.player-controls');
  const progress = wrap.querySelector('.player-progress');
  const progressFilled = wrap.querySelector('.player-progress-filled');
  const btnPlay = wrap.querySelector('#btn-play, .player-btn[title="Play/Pause"]');
  const iconPlay = wrap.querySelector('#icon-play, .icon-play');
  const iconPause = wrap.querySelector('#icon-pause, .icon-pause');
  const btnMute = wrap.querySelector('#btn-mute, .player-btn[title="Mute"]');
  const iconVol = wrap.querySelector('#icon-vol, .icon-vol');
  const iconMuted = wrap.querySelector('#icon-muted, .icon-muted');
  const volumeBar = wrap.querySelector('.player-volume');
  const volumeFilled = wrap.querySelector('.player-volume-filled');
  const timeDisplay = wrap.querySelector('.player-time');
  const btnFs = wrap.querySelector('#btn-fs, .player-btn[title="Fullscreen"]');

  function fmt(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function updatePlayIcon() {
    if (!iconPlay || !iconPause) return;
    iconPlay.style.display = video.paused ? '' : 'none';
    iconPause.style.display = video.paused ? 'none' : '';
  }

  function updateMuteIcon() {
    if (!iconVol || !iconMuted) return;
    iconVol.style.display = video.muted ? 'none' : '';
    iconMuted.style.display = video.muted ? '' : 'none';
  }

  function updateProgress() {
    if (!video.duration) return;
    const pct = (video.currentTime / video.duration) * 100;
    progressFilled.style.width = pct + '%';
    timeDisplay.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
    if (progress) { progress.setAttribute('aria-valuenow', Math.round(pct)); progress.setAttribute('aria-valuetext', `${fmt(video.currentTime)} of ${fmt(video.duration)}`); }
  }

  function updateVolume() {
    const vol = video.muted ? 0 : Math.round(video.volume * 100);
    volumeFilled.style.width = vol + '%';
    if (volumeBar) { volumeBar.setAttribute('aria-valuenow', vol); volumeBar.setAttribute('aria-valuetext', `Volume ${vol}%`); }
  }

  function togglePlay() {
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }

  // ARIA attributes for player controls
  if (progress) {
    progress.setAttribute('role', 'slider');
    progress.setAttribute('aria-label', 'Video progress');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    progress.setAttribute('aria-valuenow', '0');
    progress.setAttribute('tabindex', '0');
    progress.addEventListener('keydown', (e) => {
      if (e.code === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); video.currentTime = Math.max(0, video.currentTime - 5); }
      if (e.code === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); }
    });
  }
  if (volumeBar) {
    volumeBar.setAttribute('role', 'slider');
    volumeBar.setAttribute('aria-label', 'Volume');
    volumeBar.setAttribute('aria-valuemin', '0');
    volumeBar.setAttribute('aria-valuemax', '100');
    volumeBar.setAttribute('aria-valuenow', '100');
    volumeBar.setAttribute('tabindex', '0');
    volumeBar.addEventListener('keydown', (e) => {
      if (e.code === 'ArrowUp' || e.code === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); video.volume = Math.min(1, video.volume + 0.1); video.muted = false; updateMuteIcon(); updateVolume(); }
      if (e.code === 'ArrowDown' || e.code === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); video.volume = Math.max(0, video.volume - 0.1); updateMuteIcon(); updateVolume(); }
    });
  }
  if (btnPlay) { btnPlay.setAttribute('aria-label', 'Play or pause video'); }
  if (btnMute) { btnMute.setAttribute('aria-label', 'Mute or unmute'); }
  if (btnFs) { btnFs.setAttribute('aria-label', 'Toggle fullscreen'); }

  // Big play button
  if (bigPlay) {
    bigPlay.setAttribute('role', 'button');
    bigPlay.setAttribute('tabindex', '0');
    bigPlay.setAttribute('aria-label', 'Play video');
    bigPlay.addEventListener('click', () => {
      video.play();
    });
    bigPlay.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); video.play(); }
    });

    video.addEventListener('play', () => {
      bigPlay.classList.add('hidden');
    });

    video.addEventListener('pause', () => {
      if (video.currentTime === 0) {
        bigPlay.classList.remove('hidden');
      }
    });
  }

  // Play/pause button
  if (btnPlay) {
    btnPlay.addEventListener('click', togglePlay);
  }

  video.addEventListener('play', updatePlayIcon);
  video.addEventListener('pause', updatePlayIcon);
  video.addEventListener('timeupdate', updateProgress);
  video.addEventListener('loadedmetadata', updateProgress);

  // Progress bar scrubbing
  let scrubbing = false;

  function scrub(e) {
    const rect = progress.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pct * video.duration;
  }

  progress.addEventListener('mousedown', (e) => {
    scrubbing = true;
    scrub(e);
  });

  _addDocListener('mousemove', (e) => {
    if (scrubbing) scrub(e);
  });

  _addDocListener('mouseup', () => {
    scrubbing = false;
  });

  // Mute
  if (btnMute) {
    btnMute.addEventListener('click', () => {
      video.muted = !video.muted;
      updateMuteIcon();
      updateVolume();
    });
  }

  // Volume bar
  if (volumeBar) {
    volumeBar.addEventListener('click', (e) => {
      const rect = volumeBar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      video.volume = pct;
      video.muted = false;
      updateMuteIcon();
      updateVolume();
    });
  }

  // Fullscreen
  if (btnFs) {
    btnFs.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        wrap.requestFullscreen();
      }
    });
  }

  // Playback speed control
  const btnSpeed = wrap.querySelector('#btn-speed, .player-speed-btn');
  if (btnSpeed) {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    let speedIndex = 2; // default 1x
    btnSpeed.addEventListener('click', () => {
      speedIndex = (speedIndex + 1) % speeds.length;
      video.playbackRate = speeds[speedIndex];
      btnSpeed.textContent = speeds[speedIndex] + 'x';
    });
  }

  // Keyboard controls
  _addDocListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - 10);
        break;
      case 'ArrowRight':
        e.preventDefault();
        video.currentTime = Math.min(video.duration, video.currentTime + 10);
        break;
      case 'KeyM':
        video.muted = !video.muted;
        updateMuteIcon();
        updateVolume();
        break;
      case 'KeyF':
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          wrap.requestFullscreen();
        }
        break;
    }
  });

  // Show controls on activity + auto-hide cursor
  let hideTimeout;
  function showControls() {
    controls.classList.add('visible');
    wrap.style.cursor = '';
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      if (!video.paused) {
        controls.classList.remove('visible');
        wrap.style.cursor = 'none';
      }
    }, 2500);
  }

  wrap.addEventListener('mousemove', showControls);
  wrap.addEventListener('mouseleave', () => { wrap.style.cursor = ''; });
  wrap.addEventListener('click', (e) => {
    if (e.target === video) togglePlay();
  });

  updateVolume();
}
