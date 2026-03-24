// Admin visual dynamics — scroll reveals, card interactions, ambient effects
(function() {
  'use strict';
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) return;
  const isTouchDevice = window.matchMedia('(hover: none)').matches;

  // ═══════════════════════════════════════════
  // 1. Scroll-triggered card reveals
  // ═══════════════════════════════════════════
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('adm-revealed');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });

  function observeReveals() {
    // Client cards, film cards, format cards, resource rows
    document.querySelectorAll('.home-client-card, .admin-film-card, .adm-client-card, .format-card, .resource-row, .project-file-row, .comment-item, .deliverable-card, .admin-request-card').forEach((el, i) => {
      if (el.classList.contains('adm-revealed') || el.classList.contains('adm-reveal')) return;
      el.classList.add('adm-reveal');
      el.style.setProperty('--adm-i', i % 20);
      revealObserver.observe(el);
    });
  }

  // Observe on load + on DOM mutations (sections are dynamically rendered)
  const content = document.getElementById('admin-content');
  if (content) {
    new MutationObserver(() => requestAnimationFrame(observeReveals))
      .observe(content, { childList: true, subtree: true });
  }
  document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(observeReveals));

  // ═══════════════════════════════════════════
  // 2. Card tilt on hover
  // ═══════════════════════════════════════════
  function initCardTilt() {
    if (isTouchDevice) return;
    document.addEventListener('mousemove', (e) => {
      const card = e.target.closest('.home-client-card, .admin-film-card, .adm-client-card');
      if (!card || card._tiltActive) return;
      card._tiltActive = true;
      const onMove = (ev) => {
        const rect = card.getBoundingClientRect();
        const x = (ev.clientX - rect.left) / rect.width;
        const y = (ev.clientY - rect.top) / rect.height;
        const tiltX = (y - 0.5) * -5;
        const tiltY = (x - 0.5) * 5;
        card.style.transform = `perspective(800px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) translateY(-3px)`;
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
  // 3. Card cursor glow
  // ═══════════════════════════════════════════
  function initCardGlow() {
    if (isTouchDevice) return;
    document.addEventListener('mousemove', (e) => {
      const card = e.target.closest('.home-client-card, .admin-film-card, .adm-client-card');
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--glow-x', (e.clientX - rect.left) + 'px');
      card.style.setProperty('--glow-y', (e.clientY - rect.top) + 'px');
    });
  }

  // ═══════════════════════════════════════════
  // 4. Animated header
  // ═══════════════════════════════════════════
  function initHeaderScroll() {
    const header = document.querySelector('.admin-header');
    if (!header) return;
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        header.classList.toggle('adm-header-scrolled', window.scrollY > 40);
        ticking = false;
      });
    });
  }

  // ═══════════════════════════════════════════
  // 5. Section transition animation
  // ═══════════════════════════════════════════
  function initSectionTransitions() {
    // Watch for section changes
    const sections = document.querySelectorAll('.admin-section');
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(m => {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          const section = m.target;
          if (section.classList.contains('active') && !section.classList.contains('adm-section-entered')) {
            section.classList.add('adm-section-entered');
            // Reset for next entry
            setTimeout(() => section.classList.remove('adm-section-entered'), 600);
          }
        }
      });
    });
    sections.forEach(s => observer.observe(s, { attributes: true }));
  }

  // ═══════════════════════════════════════════
  // 6. Modal entrance animation
  // ═══════════════════════════════════════════
  function initModalAnimations() {
    // Modal entrance animations removed — caused opacity:0 lock via fill-mode:both
  }

  // ═══════════════════════════════════════════
  // 7. Toast animation
  // ═══════════════════════════════════════════
  function initToastAnimation() {
    const toast = document.getElementById('toast');
    if (!toast) return;
    new MutationObserver(() => {
      if (toast.classList.contains('show')) {
        toast.classList.add('adm-toast-enter');
        setTimeout(() => toast.classList.remove('adm-toast-enter'), 400);
      }
    }).observe(toast, { attributes: true });
  }

  // ═══════════════════════════════════════════
  // 8. Floating particles (subtle, fewer than public site)
  // ═══════════════════════════════════════════
  function initParticles() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.4;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    resize();
    window.addEventListener('resize', resize);

    const particles = [];
    for (let i = 0; i < 20; i++) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        size: Math.random() * 1.5 + 0.3,
        speedX: (Math.random() - 0.5) * 0.2,
        speedY: -Math.random() * 0.15 - 0.03,
        opacity: Math.random() * 0.3 + 0.08,
        phase: Math.random() * Math.PI * 2,
        warm: Math.random() > 0.5
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const t = Date.now() * 0.001;
      for (const p of particles) {
        p.x += p.speedX + Math.sin(t + p.phase) * 0.1;
        p.y += p.speedY;
        if (p.y < -10) { p.y = canvas.height + 10; p.x = Math.random() * canvas.width; }
        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;
        const flicker = 0.5 + 0.5 * Math.sin(t * 0.8 + p.phase);
        const alpha = p.opacity * flicker;
        ctx.fillStyle = p.warm ? `rgba(222,118,43,${alpha})` : `rgba(233,224,215,${alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(draw);
    }
    draw();
  }

  // 9. Scroll progress bar — REMOVED

  // ═══════════════════════════════════════════
  // 10. Cursor spotlight
  // ═══════════════════════════════════════════
  function initCursorSpotlight() {
    if (isTouchDevice) return;
    const spot = document.createElement('div');
    spot.style.cssText = 'position:fixed;width:350px;height:350px;border-radius:50%;pointer-events:none;z-index:0;background:radial-gradient(circle,rgba(222,118,43,0.025) 0%,transparent 70%);transform:translate(-50%,-50%);transition:opacity 0.3s;opacity:0;';
    document.body.appendChild(spot);
    let visible = false;
    document.addEventListener('mousemove', (e) => {
      spot.style.left = e.clientX + 'px';
      spot.style.top = e.clientY + 'px';
      if (!visible) { spot.style.opacity = '1'; visible = true; }
    });
    document.addEventListener('mouseleave', () => { spot.style.opacity = '0'; visible = false; });
  }

  // ═══════════════════════════════════════════
  // 11. Magnetic buttons
  // ═══════════════════════════════════════════
  function initMagneticButtons() {
    if (isTouchDevice) return;
    document.querySelectorAll('.btn, .btn-add-pill, .btn-logout').forEach(btn => {
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        btn.style.transform = `translate(${x * 0.12}px, ${y * 0.12}px)`;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = '';
        btn.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        setTimeout(() => { btn.style.transition = ''; }, 400);
      });
    });
  }

  // ═══════════════════════════════════════════
  // 12. Upload progress glow
  // ═══════════════════════════════════════════
  function initProgressGlow() {
    // Observe progress bar changes and add glow
    const bars = document.querySelectorAll('.upload-progress-filled');
    bars.forEach(bar => {
      new MutationObserver(() => {
        const w = parseFloat(bar.style.width) || 0;
        if (w > 0 && w < 100) {
          bar.style.boxShadow = `0 0 12px rgba(222,118,43,0.4), 0 0 30px rgba(222,118,43,0.15)`;
        } else if (w >= 100) {
          bar.style.boxShadow = `0 0 12px rgba(198,222,144,0.4), 0 0 30px rgba(198,222,144,0.15)`;
        } else {
          bar.style.boxShadow = 'none';
        }
      }).observe(bar, { attributes: true, attributeFilter: ['style'] });
    });
  }

  // ═══════════════════════════════════════════
  // 13. Film thumbnail hover zoom enhancement
  // ═══════════════════════════════════════════
  function initThumbParallax() {
    if (isTouchDevice) return;
    document.addEventListener('mousemove', (e) => {
      const card = e.target.closest('.admin-film-card');
      if (!card) return;
      const img = card.querySelector('.admin-film-thumb img');
      if (!img) return;
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      img.style.transform = `scale(1.06) translate(${x * -5}px, ${y * -5}px)`;
    });
    document.addEventListener('mouseout', (e) => {
      const card = e.target.closest('.admin-film-card');
      if (!card) return;
      const img = card.querySelector('.admin-film-thumb img');
      if (img) img.style.transform = '';
    });
  }

  // ═══════════════════════════════════════════
  // 14. Animated grain
  // ═══════════════════════════════════════════
  function initAnimatedGrain() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.02;mix-blend-mode:overlay;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const w = 128, h = 128;
    canvas.width = w; canvas.height = h;
    let frame = 0;
    function draw() {
      frame++;
      if (frame % 3 !== 0) { requestAnimationFrame(draw); return; }
      const img = ctx.createImageData(w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      requestAnimationFrame(draw);
    }
    draw();
  }

  // ═══════════════════════════════════════════
  // 15. Background gradient shift
  // ═══════════════════════════════════════════
  function initBgShift() {
    document.body.style.animation = 'admBgShift 25s ease-in-out infinite';
  }

  // ═══════════════════════════════════════════
  // Initialize all
  // ═══════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', () => {
    // initCardTilt(); — removed: mouse effect
    // initCardGlow(); — removed: mouse-follow glow
    initHeaderScroll();
    initSectionTransitions();
    initModalAnimations();
    initToastAnimation();
    initParticles();
    // initScrollProgress(); — removed
    // initCursorSpotlight(); — removed: mouse-follow spotlight
    // initMagneticButtons(); — removed: mouse effect
    // initProgressGlow(); — removed: mouse effect
    // initThumbParallax(); — removed: mouse effect
    // initAnimatedGrain(); — removed (noise/banding)
    // initBgShift(); — removed (gradient cycling)
  });
})();
