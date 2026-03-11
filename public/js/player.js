/**
 * Custom video player — gold-accented, keyboard-driven.
 * Call initPlayer(containerEl) after the DOM is ready.
 */

function initPlayer(wrap) {
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
  }

  function updateVolume() {
    volumeFilled.style.width = (video.muted ? 0 : video.volume * 100) + '%';
  }

  function togglePlay() {
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }

  // Big play button
  if (bigPlay) {
    bigPlay.addEventListener('click', () => {
      video.play();
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

  document.addEventListener('mousemove', (e) => {
    if (scrubbing) scrub(e);
  });

  document.addEventListener('mouseup', () => {
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

  // Keyboard controls
  document.addEventListener('keydown', (e) => {
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

  // Show controls on activity
  let hideTimeout;
  function showControls() {
    controls.classList.add('visible');
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      if (!video.paused) controls.classList.remove('visible');
    }, 2500);
  }

  wrap.addEventListener('mousemove', showControls);
  wrap.addEventListener('click', (e) => {
    if (e.target === video) togglePlay();
  });

  updateVolume();
}
