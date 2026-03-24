// Visual dynamics — scroll reveals, card interactions, ambient effects, particles
(function() {
  'use strict';
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) return;
  const isTouchDevice = window.matchMedia('(hover: none)').matches;

  // ═══════════════════════════════════════════
  // 1. Scroll-triggered reveal animations
  // ═══════════════════════════════════════════
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  function observeReveals() {
    document.querySelectorAll('.browse-grid .browse-card, .browse-grid a.portfolio-card').forEach((card, i) => {
      if (card.classList.contains('revealed')) return;
      card.classList.add('reveal-card');
      card.style.setProperty('--reveal-i', i % 12);
      revealObserver.observe(card);
    });
    document.querySelectorAll('.portal-project-card').forEach((card, i) => {
      if (card.classList.contains('revealed')) return;
      card.classList.add('reveal-card');
      card.style.setProperty('--reveal-i', i);
      revealObserver.observe(card);
    });
    document.querySelectorAll('.deliverable-card').forEach((card, i) => {
      if (card.classList.contains('revealed')) return;
      card.classList.add('reveal-card');
      card.style.setProperty('--reveal-i', i);
      revealObserver.observe(card);
    });
    document.querySelectorAll('.browse-controls, .category-row-header, .related-header, .portal-header, .project-landing-header, .project-landing-section-title').forEach(el => {
      if (el.classList.contains('revealed')) return;
      el.classList.add('reveal-fade');
      revealObserver.observe(el);
    });
    document.querySelectorAll('.site-footer').forEach(el => {
      if (el.classList.contains('revealed')) return;
      el.classList.add('reveal-fade');
      revealObserver.observe(el);
    });
  }

  const gridEl = document.getElementById('film-grid');
  if (gridEl) {
    new MutationObserver(() => requestAnimationFrame(observeReveals)).observe(gridEl, { childList: true });
  }
  document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(observeReveals));

  // ═══════════════════════════════════════════
  // 2. Card tilt on hover (subtle 3D)
  // ═══════════════════════════════════════════
  function initCardTilt() {
    if (isTouchDevice) return;
    document.addEventListener('mousemove', (e) => {
      const card = e.target.closest('.browse-card, .portal-project-card, .deliverable-card');
      if (!card || card._tiltActive) return;
      card._tiltActive = true;
      const onMove = (ev) => {
        const rect = card.getBoundingClientRect();
        const x = (ev.clientX - rect.left) / rect.width;
        const y = (ev.clientY - rect.top) / rect.height;
        const tiltX = (y - 0.5) * -8;
        const tiltY = (x - 0.5) * 8;
        card.style.transform = `perspective(600px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) translateY(-4px) scale(1.02)`;
      };
      const onLeave = () => {
        card.style.transform = '';
        card._tiltActive = false;
        card.removeEventListener('mousemove', onMove);
        card.removeEventListener('mouseleave', onLeave);
      };
      card.addEventListener('mousemove', onMove);
      card.addEventListener('mouseleave', onLeave);
      onMove(e);
    });
  }

  // ═══════════════════════════════════════════
  // 3. Magnetic cursor glow on cards
  // ═══════════════════════════════════════════
  function initCardGlow() {
    if (isTouchDevice) return;
    document.addEventListener('mousemove', (e) => {
      const card = e.target.closest('.browse-card, .portal-project-card');
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--glow-x', (e.clientX - rect.left) + 'px');
      card.style.setProperty('--glow-y', (e.clientY - rect.top) + 'px');
    });
  }

  // ═══════════════════════════════════════════
  // 4. Search bar focus animation
  // ═══════════════════════════════════════════
  function initSearchDynamics() {
    const search = document.getElementById('film-search');
    if (!search) return;
    search.addEventListener('focus', () => search.parentElement.classList.add('search-focused'));
    search.addEventListener('blur', () => search.parentElement.classList.remove('search-focused'));
  }

  // ═══════════════════════════════════════════
  // 5. Filter button press feedback
  // ═══════════════════════════════════════════
  function initFilterDynamics() {
    document.querySelectorAll('.browse-filter').forEach(btn => {
      btn.addEventListener('click', function() {
        this.classList.add('filter-pressed');
        setTimeout(() => this.classList.remove('filter-pressed'), 300);
      });
    });
  }

  // ═══════════════════════════════════════════
  // 6. Parallax on monitor (subtle)
  // ═══════════════════════════════════════════
  function initMonitorParallax() {
    const monitor = document.getElementById('monitor');
    if (!monitor || isTouchDevice) return;
    monitor.addEventListener('mousemove', (e) => {
      const rect = monitor.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      monitor.querySelectorAll('.monitor-thumb').forEach(t => {
        t.style.transform = `translate(${x * -12}px, ${y * -12}px)`;
      });
      // Scanlines shift slightly
      const scanlines = document.getElementById('monitor-scanlines');
      if (scanlines) scanlines.style.transform = `translateY(${y * 3}px)`;
    });
    monitor.addEventListener('mouseleave', () => {
      monitor.querySelectorAll('.monitor-thumb').forEach(t => { t.style.transform = ''; });
      const scanlines = document.getElementById('monitor-scanlines');
      if (scanlines) scanlines.style.transform = '';
    });
  }

  // ═══════════════════════════════════════════
  // 7. Animated header on scroll
  // ═══════════════════════════════════════════
  function initHeaderScroll() {
    const header = document.querySelector('.site-header');
    if (!header) return;
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        header.classList.toggle('header-scrolled', window.scrollY > 80);
        ticking = false;
      });
    });
  }

  // ═══════════════════════════════════════════
  // 8. Portal entry cinematic reveal
  // ═══════════════════════════════════════════
  function initPortalEntry() {
    const entry = document.querySelector('.portal-entry');
    if (!entry) return;
    entry.classList.add('portal-entry-animate');
  }

  // ═══════════════════════════════════════════
  // 9. Footer social icons spring hover
  // ═══════════════════════════════════════════
  function initFooterDynamics() {
    document.querySelectorAll('.footer-social a').forEach(a => {
      a.addEventListener('mouseenter', function() {
        this.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s';
      });
      a.addEventListener('mouseleave', function() {
        this.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s';
      });
    });
  }

  // ═══════════════════════════════════════════
  // 10. Status bar ambient animation
  // ═══════════════════════════════════════════
  function initStatusBarDynamics() {
    const sb = document.getElementById('status-bar');
    if (!sb) return;
    sb.classList.add('sb-animate');
  }

  // ═══════════════════════════════════════════
  // 11. Floating particles — dust motes / bokeh
  // ═══════════════════════════════════════════
  function initParticles() {
    // Don't run on review page (fullscreen layout)
    if (document.body.classList.contains('review-page')) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'particle-canvas';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;opacity:1;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const particles = [];
    const COUNT = 70;
    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        size: Math.random() * 2.5 + 0.5,
        speedX: (Math.random() - 0.5) * 0.3,
        speedY: -Math.random() * 0.25 - 0.05,
        opacity: Math.random() * 0.6 + 0.15,
        phase: Math.random() * Math.PI * 2,
        // Some particles are warm (orange), some are cool (cream)
        warm: Math.random() > 0.5
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const t = Date.now() * 0.001;
      for (const p of particles) {
        p.x += p.speedX + Math.sin(t + p.phase) * 0.15;
        p.y += p.speedY;
        const flicker = 0.5 + 0.5 * Math.sin(t * 0.8 + p.phase);
        const alpha = p.opacity * flicker;

        // Wrap around
        if (p.y < -10) { p.y = canvas.height + 10; p.x = Math.random() * canvas.width; }
        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;

        if (p.warm) {
          ctx.fillStyle = `rgba(222, 118, 43, ${alpha})`;
        } else {
          ctx.fillStyle = `rgba(233, 224, 215, ${alpha * 0.6})`;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        // Glow for larger warm particles
        if (p.warm && p.size > 1.2) {
          ctx.fillStyle = `rgba(222, 118, 43, ${alpha * 0.15})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      requestAnimationFrame(draw);
    }
    draw();
  }

  // 12. Scroll progress bar — REMOVED (unnecessary visual noise)

  // ═══════════════════════════════════════════
  // 13. Cursor spotlight — subtle glow follows mouse
  // ═══════════════════════════════════════════
  function initCursorSpotlight() {
    if (isTouchDevice) return;

    const spot = document.createElement('div');
    spot.id = 'cursor-spotlight';
    spot.style.cssText = 'position:fixed;width:400px;height:400px;border-radius:50%;pointer-events:none;z-index:0;background:radial-gradient(circle,rgba(222,118,43,0.03) 0%,rgba(222,118,43,0.01) 40%,transparent 70%);transform:translate(-50%,-50%);transition:opacity 0.3s;opacity:0;';
    document.body.appendChild(spot);

    let visible = false;
    document.addEventListener('mousemove', (e) => {
      spot.style.left = e.clientX + 'px';
      spot.style.top = e.clientY + 'px';
      if (!visible) { spot.style.opacity = '1'; visible = true; }
    });
    document.addEventListener('mouseleave', () => {
      spot.style.opacity = '0';
      visible = false;
    });
  }

  // ═══════════════════════════════════════════
  // 14. Magnetic buttons — pull toward cursor
  // ═══════════════════════════════════════════
  function initMagneticButtons() {
    if (isTouchDevice) return;

    document.querySelectorAll('.btn, .browse-filter, .player-big-play-btn, .portal-entry-form .btn').forEach(btn => {
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        btn.style.transform = `translate(${x * 0.15}px, ${y * 0.15}px)`;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = '';
        btn.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        setTimeout(() => { btn.style.transition = ''; }, 400);
      });
    });
  }

  // ═══════════════════════════════════════════
  // 15. Text scramble on monitor labels
  // ═══════════════════════════════════════════
  function initTextScramble() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·:';
    function scrambleText(el) {
      const original = el.textContent;
      const len = original.length;
      let iteration = 0;
      const interval = setInterval(() => {
        el.textContent = original.split('').map((char, i) => {
          if (char === ' ') return ' ';
          if (i < iteration) return original[i];
          return chars[Math.floor(Math.random() * chars.length)];
        }).join('');
        iteration += 1 / 2;
        if (iteration >= len) {
          el.textContent = original;
          clearInterval(interval);
        }
      }, 30);
    }

    // Scramble monitor labels on load
    setTimeout(() => {
      document.querySelectorAll('.mon-label-tl, .mon-label-bl').forEach(el => {
        scrambleText(el);
      });
    }, 800);

    // Scramble status bar text on load
    setTimeout(() => {
      document.querySelectorAll('.sb-text:not(.sb-counts)').forEach(el => {
        scrambleText(el);
      });
    }, 1200);
  }

  // ═══════════════════════════════════════════
  // 16. Status bar counter count-up
  // ═══════════════════════════════════════════
  function initCountUp() {
    const counts = document.getElementById('sb-counts');
    if (!counts) return;

    const observer = new MutationObserver(() => {
      const ems = counts.querySelectorAll('em');
      ems.forEach(em => {
        if (em._counted) return;
        em._counted = true;
        const target = parseInt(em.textContent);
        if (isNaN(target)) return;
        let current = 0;
        const step = Math.max(1, Math.floor(target / 20));
        const interval = setInterval(() => {
          current += step;
          if (current >= target) {
            current = target;
            clearInterval(interval);
          }
          em.textContent = current;
        }, 40);
      });
    });
    observer.observe(counts, { childList: true, subtree: true });
  }

  // ═══════════════════════════════════════════
  // 17. CRT flicker on monitor (very subtle)
  // ═══════════════════════════════════════════
  function initCRTFlicker() {
    const monitor = document.getElementById('monitor');
    if (!monitor) return;

    function flicker() {
      const delay = 3000 + Math.random() * 8000;
      setTimeout(() => {
        monitor.style.opacity = '0.97';
        setTimeout(() => {
          monitor.style.opacity = '1';
          setTimeout(() => {
            monitor.style.opacity = '0.98';
            setTimeout(() => {
              monitor.style.opacity = '1';
              flicker();
            }, 50);
          }, 30);
        }, 60);
      }, delay);
    }
    flicker();
  }

  // ═══════════════════════════════════════════
  // 18. Card image parallax within thumbnail
  // ═══════════════════════════════════════════
  function initThumbParallax() {
    if (isTouchDevice) return;

    document.addEventListener('mousemove', (e) => {
      const card = e.target.closest('.browse-card');
      if (!card) return;
      const img = card.querySelector('.browse-thumb img');
      if (!img) return;
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      img.style.transform = `scale(1.08) translate(${x * -6}px, ${y * -6}px)`;
    });

    document.addEventListener('mouseout', (e) => {
      const card = e.target.closest('.browse-card');
      if (!card) return;
      const img = card.querySelector('.browse-thumb img');
      if (img) img.style.transform = '';
    });
  }

  // ═══════════════════════════════════════════
  // 19. Portal page — floating ring particles
  // ═══════════════════════════════════════════
  function initPortalRings() {
    const entry = document.querySelector('.portal-entry');
    if (!entry) return;

    // Add 3 decorative orbiting rings
    for (let i = 0; i < 3; i++) {
      const ring = document.createElement('div');
      ring.className = 'portal-orbit-ring';
      ring.style.setProperty('--ring-i', i);
      entry.parentElement.appendChild(ring);
    }
  }

  // ═══════════════════════════════════════════
  // 20. Animated noise grain (canvas-based, performant)
  // ═══════════════════════════════════════════
  function initAnimatedGrain() {
    // Don't run on watch page (has its own) or review page
    if (document.body.classList.contains('watch-page') || document.body.classList.contains('review-page')) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'grain-canvas';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;opacity:0.025;mix-blend-mode:overlay;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    // Small canvas, scaled up for performance
    const w = 128, h = 128;
    canvas.width = w;
    canvas.height = h;

    let frame = 0;
    function draw() {
      frame++;
      // Only update every 3 frames for performance
      if (frame % 3 !== 0) { requestAnimationFrame(draw); return; }
      const img = ctx.createImageData(w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = d[i+1] = d[i+2] = v;
        d[i+3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      requestAnimationFrame(draw);
    }
    draw();
  }

  // ═══════════════════════════════════════════
  // 21. Scroll-driven monitor compression
  // ═══════════════════════════════════════════
  function initMonitorScroll() {
    const monitor = document.getElementById('monitor');
    if (!monitor) return;

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const scrollY = window.scrollY;
        const maxScroll = 300;
        const progress = Math.min(scrollY / maxScroll, 1);
        // Slight scale down and increased scanline opacity as you scroll past
        const scale = 1 - progress * 0.03;
        const blur = progress * 1;
        monitor.style.transform = `scale(${scale})`;
        monitor.style.filter = `blur(${blur}px)`;
        // Fade corners
        const corners = monitor.querySelectorAll('.corner');
        corners.forEach(c => {
          c.style.opacity = Math.max(0, 1 - progress * 2);
        });
        ticking = false;
      });
    });
  }

  // ═══════════════════════════════════════════
  // 22. Cinema dust particles (watch page)
  // ═══════════════════════════════════════════
  function initCinemaDust() {
    const canvas = document.getElementById('cinema-dust');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() {
      canvas.width = canvas.offsetWidth || window.innerWidth;
      canvas.height = canvas.offsetHeight || window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const particles = [];
    const COUNT = 60;
    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: Math.random() * (canvas.width || 1920),
        y: Math.random() * (canvas.height || 1080),
        size: Math.random() * 1.8 + 0.3,
        speedX: (Math.random() - 0.5) * 0.4,
        speedY: -Math.random() * 0.15 - 0.02,
        opacity: Math.random() * 0.5 + 0.15,
        phase: Math.random() * Math.PI * 2,
        drift: Math.random() * 0.4 + 0.1,
        warm: Math.random() > 0.4,
        // Some particles are bright "caught in the projector beam"
        bright: Math.random() > 0.85
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const t = Date.now() * 0.001;
      const centerX = canvas.width / 2;

      for (const p of particles) {
        p.x += p.speedX + Math.sin(t * 0.5 + p.phase) * p.drift;
        p.y += p.speedY + Math.cos(t * 0.3 + p.phase) * 0.08;

        // Wrap
        if (p.y < -10) { p.y = canvas.height + 10; p.x = Math.random() * canvas.width; }
        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;

        const flicker = 0.4 + 0.6 * Math.sin(t * 1.2 + p.phase);
        let alpha = p.opacity * flicker;

        // Particles near center (projector beam) are brighter
        const distFromCenter = Math.abs(p.x - centerX) / (canvas.width * 0.3);
        const beamBoost = Math.max(0, 1 - distFromCenter);
        alpha *= (1 + beamBoost * 0.8);

        if (p.bright) {
          // Bright particles — caught in the light
          ctx.fillStyle = `rgba(255, 240, 220, ${alpha * 0.8})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 1.5, 0, Math.PI * 2);
          ctx.fill();
          // Bloom
          ctx.fillStyle = `rgba(222, 118, 43, ${alpha * 0.15})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 6, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.warm) {
          ctx.fillStyle = `rgba(222, 118, 43, ${alpha * 0.5})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = `rgba(233, 224, 215, ${alpha * 0.35})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      requestAnimationFrame(draw);
    }
    draw();
  }

  // ═══════════════════════════════════════════
  // 23. Watch page animated grain
  // ═══════════════════════════════════════════
  function initWatchGrain() {
    if (!document.body.classList.contains('watch-page')) return;

    // Replace the static SVG grain with animated canvas grain
    const existingGrain = document.querySelector('.watch-page::after');
    const canvas = document.createElement('canvas');
    canvas.className = 'watch-grain-canvas';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    const w = 192, h = 192;
    canvas.width = w;
    canvas.height = h;

    let frame = 0;
    function draw() {
      frame++;
      if (frame % 2 !== 0) { requestAnimationFrame(draw); return; }
      const img = ctx.createImageData(w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = d[i+1] = d[i+2] = v;
        d[i+3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      requestAnimationFrame(draw);
    }
    draw();
  }

  // ═══════════════════════════════════════════
  // 24. Synopsis/credits scroll reveal
  // ═══════════════════════════════════════════
  function initWatchSectionReveals() {
    const sections = document.querySelectorAll('.watch-synopsis, .watch-credits');
    if (!sections.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    // Observe after a delay since content is dynamically loaded
    setTimeout(() => {
      document.querySelectorAll('.watch-synopsis, .watch-credits').forEach(el => {
        observer.observe(el);
      });
    }, 500);

    // Also observe after mutations
    const details = document.getElementById('watch-details');
    if (details) {
      new MutationObserver(() => {
        document.querySelectorAll('.watch-synopsis, .watch-credits').forEach(el => {
          if (!el.classList.contains('revealed')) observer.observe(el);
        });
      }).observe(details, { childList: true, subtree: true });
    }
  }

  // ═══════════════════════════════════════════
  // 25. Watch page cinema parallax on scroll
  // ═══════════════════════════════════════════
  function initCinemaParallax() {
    if (!document.body.classList.contains('watch-page')) return;
    if (isTouchDevice) return;

    const cinemaZone = document.querySelector('.watch-cinema-zone');
    const backdrop = document.getElementById('player-backdrop');
    const flare = document.querySelector('.anamorphic-flare');
    if (!cinemaZone) return;

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const scrollY = window.scrollY;
        const maxScroll = 600;
        const progress = Math.min(scrollY / maxScroll, 1);

        // Backdrop moves slower (parallax depth)
        if (backdrop) {
          backdrop.style.transform = `translateY(${scrollY * 0.15}px)`;
        }

        // Flare fades and shifts
        if (flare) {
          flare.style.transform = `translateY(${scrollY * 0.08}px)`;
          flare.style.opacity = Math.max(0, 0.5 - progress * 0.8);
        }

        ticking = false;
      });
    });
  }

  // ═══════════════════════════════════════════
  // 26. Watch page — cursor controls flare position
  // ═══════════════════════════════════════════
  function initFlareTracking() {
    if (isTouchDevice) return;
    const flare = document.querySelector('.anamorphic-flare');
    if (!flare) return;

    document.addEventListener('mousemove', (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 20;
      flare.style.transform = `translateX(${x}px)`;
    });
  }

  // ═══════════════════════════════════════════
  // 27. Watch page — ambient backdrop responds to scroll
  // ═══════════════════════════════════════════
  function initBackdropScroll() {
    if (!document.body.classList.contains('watch-page')) return;
    const backdrop = document.getElementById('player-backdrop');
    if (!backdrop) return;

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const scrollY = window.scrollY;
        const img = backdrop.querySelector('img');
        if (img) {
          // Scale down backdrop as you scroll — cinema narrowing
          const scale = 2.2 - Math.min(scrollY / 1000, 0.3);
          const brightness = 0.7 - Math.min(scrollY / 2000, 0.3);
          img.style.transform = `translate(-50%, -50%) scale(${scale})`;
          img.style.filter = `blur(60px) saturate(2) brightness(${brightness})`;
        }
        ticking = false;
      });
    });
  }

  // ═══════════════════════════════════════════
  // 28. Split-letter title animation (watch page)
  // ═══════════════════════════════════════════
  function initSplitTitle() {
    const title = document.getElementById('watch-title');
    if (!title) return;

    // Wait for title content to be set by watch.js
    const check = setInterval(() => {
      if (!title.textContent.trim()) return;
      clearInterval(check);

      const text = title.textContent;
      title.innerHTML = '';
      title.style.animation = 'none';

      [...text].forEach((char, i) => {
        const span = document.createElement('span');
        span.textContent = char === ' ' ? '\u00A0' : char;
        span.className = 'split-char';
        span.style.setProperty('--char-i', i);
        title.appendChild(span);
      });

      // Trigger after a frame
      requestAnimationFrame(() => {
        title.classList.add('split-active');
      });
    }, 100);
  }

  // ═══════════════════════════════════════════
  // 29. VHS tracking glitch on monitor
  // ═══════════════════════════════════════════
  function initVHSGlitch() {
    const monitor = document.getElementById('monitor');
    if (!monitor) return;

    function glitch() {
      const delay = 15000 + Math.random() * 30000;
      setTimeout(() => {
        // Create glitch bar
        const bar = document.createElement('div');
        bar.className = 'vhs-glitch-bar';
        bar.style.top = (Math.random() * 80 + 10) + '%';
        monitor.appendChild(bar);

        // Chromatic shift on monitor
        monitor.style.filter = `hue-rotate(${(Math.random() - 0.5) * 10}deg)`;

        setTimeout(() => {
          monitor.style.filter = '';
          bar.remove();
          glitch();
        }, 100 + Math.random() * 150);
      }, delay);
    }
    glitch();
  }

  // ═══════════════════════════════════════════
  // 30. Custom cinema cursor
  // ═══════════════════════════════════════════
  function initCinemaCursor() {
    if (isTouchDevice) return;
    if (!document.body.classList.contains('watch-page')) return;

    const cursor = document.createElement('div');
    cursor.className = 'cinema-cursor';
    cursor.innerHTML = '<div class="cinema-cursor-ring"></div><div class="cinema-cursor-dot"></div>';
    document.body.appendChild(cursor);

    let mouseX = 0, mouseY = 0, curX = 0, curY = 0;

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });

    function animate() {
      // Smooth follow
      curX += (mouseX - curX) * 0.15;
      curY += (mouseY - curY) * 0.15;
      cursor.style.transform = `translate(${curX}px, ${curY}px)`;
      requestAnimationFrame(animate);
    }
    animate();

    // Scale up on interactive elements
    document.addEventListener('mouseover', (e) => {
      if (!e.target || !e.target.closest) return;
      const interactive = e.target.closest('a, button, .browse-card, .player-big-play, .player-btn, input');
      cursor.classList.toggle('cinema-cursor-hover', !!interactive);
    });

    // Hide on player controls area (native cursor needed for precision)
    const controls = document.querySelector('.player-controls');
    if (controls) {
      controls.addEventListener('mouseenter', () => cursor.style.opacity = '0');
      controls.addEventListener('mouseleave', () => cursor.style.opacity = '1');
    }
  }

  // ═══════════════════════════════════════════
  // 31. Chromatic aberration on player edges
  // ═══════════════════════════════════════════
  function initChromaticAberration() {
    if (!document.body.classList.contains('watch-page')) return;
    const playerWrap = document.querySelector('.watch-page .player-wrap');
    if (!playerWrap) return;

    const aberration = document.createElement('div');
    aberration.className = 'chromatic-aberration';
    playerWrap.appendChild(aberration);
  }

  // 32. Infinite scrolling marquee in footer — REMOVED (keep footer static)

  // ═══════════════════════════════════════════
  // 33. Mouse-reactive ambient glow (watch page)
  // ═══════════════════════════════════════════
  function initReactiveGlow() {
    if (!document.body.classList.contains('watch-page')) return;
    if (isTouchDevice) return;

    const cinemaZone = document.querySelector('.watch-cinema-zone');
    if (!cinemaZone) return;

    const glow = document.createElement('div');
    glow.className = 'reactive-glow';
    cinemaZone.appendChild(glow);

    cinemaZone.addEventListener('mousemove', (e) => {
      const rect = cinemaZone.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      glow.style.background = `radial-gradient(600px circle at ${x}% ${y}%, rgba(222,118,43,0.06), transparent 60%)`;
    });

    cinemaZone.addEventListener('mouseleave', () => {
      glow.style.background = 'none';
    });
  }

  // ═══════════════════════════════════════════
  // 34. Page transition glitch
  // ═══════════════════════════════════════════
  function initGlitchTransition() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:') ||
          link.target === '_blank' ||
          (href.startsWith('http') && !href.includes(location.host))) return;

      // Add glitch class before the transition.js fade handles it
      document.body.classList.add('glitch-exit');
    });
  }

  // ═══════════════════════════════════════════
  // 35. Film sprocket holes on cinema zone
  // ═══════════════════════════════════════════
  function initSprocketHoles() {
    if (!document.body.classList.contains('watch-page')) return;

    const cinemaZone = document.querySelector('.watch-cinema-zone');
    if (!cinemaZone) return;

    ['left', 'right'].forEach(side => {
      const strip = document.createElement('div');
      strip.className = `sprocket-strip sprocket-${side}`;
      for (let i = 0; i < 20; i++) {
        const hole = document.createElement('div');
        hole.className = 'sprocket-hole';
        strip.appendChild(hole);
      }
      cinemaZone.appendChild(strip);
    });
  }

  // ═══════════════════════════════════════════
  // 36. Card hover ripple effect
  // ═══════════════════════════════════════════
  function initCardRipple() {
    if (isTouchDevice) return;

    document.addEventListener('mouseenter', (e) => {
      const card = e.target.closest('.browse-card, .portal-project-card');
      if (!card) return;

      const ripple = document.createElement('div');
      ripple.className = 'card-ripple';
      const rect = card.getBoundingClientRect();
      ripple.style.left = (e.clientX - rect.left) + 'px';
      ripple.style.top = (e.clientY - rect.top) + 'px';
      card.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    }, true);
  }

  // ═══════════════════════════════════════════
  // 37. Scroll-driven color temperature shift
  // ═══════════════════════════════════════════
  function initColorTemperature() {
    if (!document.body.classList.contains('watch-page')) return;

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const scrollY = window.scrollY;
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const progress = maxScroll > 0 ? scrollY / maxScroll : 0;
        // Shift from cool (top) to warm (bottom)
        const hue = progress * 5; // subtle hue shift
        const sat = 1 + progress * 0.15;
        document.documentElement.style.filter = `hue-rotate(${hue}deg) saturate(${sat})`;
        ticking = false;
      });
    });
  }

  // ═══════════════════════════════════════════
  // 38. Monitor — random channel change flicker
  // ═══════════════════════════════════════════
  function initChannelFlicker() {
    const monitor = document.getElementById('monitor');
    if (!monitor || !monitor.classList.contains('has-featured')) return;

    function channelFlick() {
      const delay = 20000 + Math.random() * 40000;
      setTimeout(() => {
        if (!monitor.classList.contains('has-featured')) { channelFlick(); return; }
        // Quick white flash
        const flash = document.createElement('div');
        flash.className = 'channel-flash';
        monitor.appendChild(flash);

        setTimeout(() => {
          flash.remove();
          channelFlick();
        }, 80);
      }, delay);
    }
    // Start after initial load
    setTimeout(channelFlick, 5000);
  }

  // ═══════════════════════════════════════════
  // 39. Hover video preview on browse cards
  // ═══════════════════════════════════════════
  function initHoverPreview() {
    if (isTouchDevice) return;
    // On card hover, add a pulsing "play" indicator
    document.addEventListener('mouseenter', (e) => {
      if (!e.target || !e.target.closest) return;
      const card = e.target.closest('.browse-grid .browse-card:not(.browse-card-locked)');
      if (!card || card.querySelector('.hover-play-pulse')) return;

      const pulse = document.createElement('div');
      pulse.className = 'hover-play-pulse';
      pulse.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="8,5 19,12 8,19"/></svg>';
      card.querySelector('.browse-thumb').appendChild(pulse);
    }, true);

    document.addEventListener('mouseleave', (e) => {
      if (!e.target || !e.target.closest) return;
      const card = e.target.closest('.browse-grid .browse-card');
      if (!card) return;
      const pulse = card.querySelector('.hover-play-pulse');
      if (pulse) pulse.remove();
    }, true);
  }

  // ═══════════════════════════════════════════
  // 40. Ambient sound visualizer bars (decorative)
  // ═══════════════════════════════════════════
  function initVisualizerBars() {
    const statusBar = document.getElementById('status-bar');
    if (!statusBar) return;

    const viz = document.createElement('div');
    viz.className = 'visualizer-bars';
    for (let i = 0; i < 5; i++) {
      const bar = document.createElement('div');
      bar.className = 'viz-bar';
      bar.style.setProperty('--bar-i', i);
      viz.appendChild(bar);
    }
    statusBar.appendChild(viz);
  }

  // ═══════════════════════════════════════════
  // 41. Smooth number counter (scroll-triggered)
  // ═══════════════════════════════════════════
  function initSmoothCounter() {
    const sb = document.getElementById('status-bar');
    if (!sb) return;

    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        counterObserver.unobserve(entry.target);
        const ems = entry.target.querySelectorAll('em');
        ems.forEach(em => {
          if (em._smoothCounted) return;
          em._smoothCounted = true;
          const target = parseInt(em.textContent);
          if (isNaN(target) || target === 0) return;
          const duration = 1200;
          const startTime = performance.now();
          em.textContent = '0';
          function tick(now) {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            em.textContent = Math.round(eased * target);
            if (progress < 1) requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        });
      });
    }, { threshold: 0.5 });

    // Observe once counts are populated
    const waitForCounts = setInterval(() => {
      const counts = sb.querySelector('.sb-counts');
      if (counts && counts.querySelectorAll('em').length) {
        clearInterval(waitForCounts);
        counterObserver.observe(counts);
      }
    }, 300);
    // Stop waiting after 10s
    setTimeout(() => clearInterval(waitForCounts), 10000);
  }

  // ═══════════════════════════════════════════
  // 42. Scroll-triggered parallax on card thumbnails
  // ═══════════════════════════════════════════
  function initScrollCardParallax() {
    if (isTouchDevice) return;

    let ticking = false;
    function updateParallax() {
      const cards = document.querySelectorAll('.browse-grid .browse-card');
      const scrollY = window.scrollY;
      const viewH = window.innerHeight;

      cards.forEach(card => {
        const thumb = card.querySelector('.browse-thumb');
        const img = thumb ? thumb.querySelector('img') : null;
        if (!img) return;
        thumb.classList.add('scroll-parallax');

        const rect = card.getBoundingClientRect();
        // How far through the viewport is this card (0 = top, 1 = bottom)
        const progress = (rect.top + rect.height / 2) / viewH;
        // Map to a small vertical shift (-8px to +8px)
        const shift = (progress - 0.5) * 16;
        img.style.transform = `translateY(${shift}px) scale(1.05)`;
      });
    }

    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        updateParallax();
        ticking = false;
      });
    });
  }

  // ═══════════════════════════════════════════
  // 43. Auto-rotating featured films in monitor
  // ═══════════════════════════════════════════
  function initMonitorRotation() {
    const monitor = document.getElementById('monitor');
    if (!monitor || !monitor.classList.contains('has-featured')) return;

    // Collect featured film data from browse cards
    function getFeaturedSlugs() {
      const cards = document.querySelectorAll('.browse-card[data-featured="true"], .browse-card.featured');
      const slugs = [];
      cards.forEach(card => {
        const link = card.closest('a[href]');
        if (link) {
          const img = card.querySelector('.browse-thumb img');
          if (img && img.src) {
            slugs.push({ src: img.src, href: link.getAttribute('href') });
          }
        }
      });
      return slugs;
    }

    let rotationInterval = null;
    function startRotation() {
      const featured = getFeaturedSlugs();
      if (featured.length < 2) return;

      let currentIndex = 0;
      const thumbA = document.getElementById('monitor-thumb-a');
      const thumbB = document.getElementById('monitor-thumb-b');
      if (!thumbA || !thumbB) return;

      rotationInterval = setInterval(() => {
        currentIndex = (currentIndex + 1) % featured.length;
        const next = featured[currentIndex];

        // Determine which thumb is currently visible
        const activeThumb = thumbA.classList.contains('crossfade-out') ? thumbB : thumbA;
        const inactiveThumb = activeThumb === thumbA ? thumbB : thumbA;

        // Set new image on inactive thumb
        const existingImg = inactiveThumb.querySelector('img');
        if (existingImg) {
          existingImg.src = next.src;
        } else {
          const img = document.createElement('img');
          img.src = next.src;
          img.alt = '';
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
          inactiveThumb.appendChild(img);
        }

        // Crossfade
        activeThumb.classList.add('crossfade-out');
        activeThumb.classList.remove('crossfade-in');
        inactiveThumb.classList.add('crossfade-in');
        inactiveThumb.classList.remove('crossfade-out');
      }, 12000);
    }

    // Wait for grid to populate, then start
    setTimeout(startRotation, 3000);
  }

  // ═══════════════════════════════════════════
  // 44. Typing effect on portal entry subtitle
  // ═══════════════════════════════════════════
  function initPortalTyping() {
    const subtitle = document.querySelector('.portal-entry-subtitle');
    if (!subtitle) return;

    const fullText = subtitle.textContent;
    subtitle.textContent = '';

    // Add cursor element
    const cursor = document.createElement('span');
    cursor.className = 'portal-typing-cursor';
    subtitle.appendChild(cursor);

    let charIndex = 0;
    const speed = 30; // ms per character

    function typeChar() {
      if (charIndex < fullText.length) {
        // Insert text before cursor
        const textNode = document.createTextNode(fullText[charIndex]);
        subtitle.insertBefore(textNode, cursor);
        charIndex++;
        setTimeout(typeChar, speed);
      } else {
        // Remove cursor after a pause
        setTimeout(() => cursor.remove(), 2000);
      }
    }

    // Start after a brief delay for the page to settle
    setTimeout(typeChar, 600);
  }

  // ═══════════════════════════════════════════
  // 45. Mouse proximity card highlight
  // ═══════════════════════════════════════════
  function initProximityHighlight() {
    if (isTouchDevice) return;

    let ticking = false;
    let mouseX = 0, mouseY = 0;

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;

      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const cards = document.querySelectorAll('.browse-grid .browse-card');
        cards.forEach(card => {
          const rect = card.getBoundingClientRect();
          const cardCX = rect.left + rect.width / 2;
          const cardCY = rect.top + rect.height / 2;
          const dist = Math.hypot(mouseX - cardCX, mouseY - cardCY);

          if (dist < 200) {
            card.classList.add('proximity-bright');
            card.classList.remove('proximity-dim');
          } else if (dist < 600) {
            card.classList.remove('proximity-bright');
            card.classList.remove('proximity-dim');
          } else {
            card.classList.remove('proximity-bright');
            card.classList.add('proximity-dim');
          }
        });
        ticking = false;
      });
    });

    // Clear proximity classes on mouse leave
    document.addEventListener('mouseleave', () => {
      document.querySelectorAll('.browse-card.proximity-bright, .browse-card.proximity-dim').forEach(c => {
        c.classList.remove('proximity-bright', 'proximity-dim');
      });
    });
  }

  // ═══════════════════════════════════════════
  // 46. Footer social icons stagger entrance
  // ═══════════════════════════════════════════
  function initFooterSocialEntrance() {
    const socialWrap = document.querySelector('.footer-social');
    if (!socialWrap) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          socialWrap.classList.add('footer-social-entrance');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });

    observer.observe(socialWrap);
  }

  // ═══════════════════════════════════════════
  // 47. Related films header line drawing
  // ═══════════════════════════════════════════
  function initRelatedLineDraw() {
    const lines = document.querySelectorAll('.related-line');
    if (!lines.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('line-draw');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.2 });

    // Observe after a delay (related section is often dynamically loaded)
    setTimeout(() => {
      document.querySelectorAll('.related-line').forEach(line => {
        observer.observe(line);
      });
    }, 500);
  }

  // ═══════════════════════════════════════════
  // 48. Section divider flare star insertion
  // ═══════════════════════════════════════════
  function initDividerStar() {
    const controls = document.querySelector('.browse-controls');
    const grid = document.getElementById('film-grid');
    if (!controls || !grid) return;

    // Only insert if not already there
    if (controls.parentElement.querySelector('.browse-divider-star')) return;

    const star = document.createElement('div');
    star.className = 'browse-divider-star';
    star.setAttribute('aria-hidden', 'true');
    controls.parentElement.insertBefore(star, grid);
  }

  // ═══════════════════════════════════════════
  // 49. Thumbnail shimmer — mark loaded images
  // ═══════════════════════════════════════════
  function initThumbShimmerCleanup() {
    // When browse-thumb images finish loading, hide the shimmer
    const observer = new MutationObserver(() => {
      document.querySelectorAll('.browse-thumb img').forEach(img => {
        if (img._shimmerBound) return;
        img._shimmerBound = true;
        function markLoaded() {
          const thumb = img.closest('.browse-thumb');
          if (thumb) thumb.classList.add('img-loaded');
        }
        if (img.complete && img.naturalWidth) {
          markLoaded();
        } else {
          img.addEventListener('load', markLoaded, { once: true });
        }
      });
    });

    const grid = document.getElementById('film-grid');
    if (grid) {
      observer.observe(grid, { childList: true, subtree: true });
    }
    // Also run immediately for already-present images
    document.querySelectorAll('.browse-thumb img').forEach(img => {
      if (img.complete && img.naturalWidth) {
        const thumb = img.closest('.browse-thumb');
        if (thumb) thumb.classList.add('img-loaded');
      }
    });
  }

  // ═══════════════════════════════════════════
  // Initialize all
  // ═══════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', () => {
    // --- Core (clean, calm, cinematic) ---
    // initCardGlow(); — removed: mouse-follow glow on cards
    initSearchDynamics();
    initFilterDynamics();
    initHeaderScroll();
    initPortalEntry();
    initFooterDynamics();
    initStatusBarDynamics();
    initParticles();
    // initScrollProgress(); — removed
    // initCursorSpotlight(); — removed: mouse-follow spotlight
    // initTextScramble(); — removed: glitchy text effect
    initPortalRings();
    // initFooterMarquee(); — removed
    initVisualizerBars();
    initSmoothCounter();
    initFooterSocialEntrance();
    initDividerStar();
    initThumbShimmerCleanup();

    // --- Cards ---
    // initCardTilt(); — conflicts with CSS hover transforms
    // initThumbParallax(); — conflicts with CSS hover img scale
    // initScrollCardParallax(); — conflicts with reveal animations
    // initCardRipple(); — visual noise
    // initProximityHighlight(); — too subtle to notice
    // initMagneticButtons(); — conflicts with CSS button transitions

    // --- Monitor ---
    // initMonitorParallax(); — removed: mouse parallax
    // initMonitorScroll(); — conflicts with monitor CSS transitions
    initCRTFlicker();
    initChannelFlicker();
    // initMonitorRotation(); — conflicts with thumbnail crossfade

    // --- Watch page (stripped back — video is the star) ---
    // initCinemaDust(); — removed: competing with video
    initWatchSectionReveals();
    // initFlareTracking(); — removed: cursor-driven flare
    // initBackdropScroll(); — removed: reactive background
    // initSplitTitle(); — removed: glitchy split text
    // initVHSGlitch(); — removed: VHS glitch bars
    // initChromaticAberration(); — removed: chromatic distortion
    // initSprocketHoles(); — removed: film sprocket strips
    // initReactiveGlow(); — removed: mouse-reactive background
    initHoverPreview();
    initRelatedLineDraw();

    // --- Portal ---
    initPortalTyping();
  });
})();
