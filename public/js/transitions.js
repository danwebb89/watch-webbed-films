// Page transitions — smooth fade between pages
(function() {
  // Fade out on internal link clicks
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') ||
        link.target === '_blank' ||
        (href.startsWith('http') && !href.includes(location.host))) return;

    e.preventDefault();
    document.body.classList.add('page-exit');
    setTimeout(() => { window.location.href = href; }, 280);
  });

  // Loader flash prevention (#19) — only show loader if page takes >400ms
  const loader = document.getElementById('site-loader');
  let loaderTimeout;
  if (loader) {
    loaderTimeout = setTimeout(() => {
      loader.classList.add('show');
    }, 400);
  }

  // Dismiss loader when content is ready
  window.addEventListener('load', () => {
    if (loaderTimeout) clearTimeout(loaderTimeout);
    setTimeout(() => {
      if (loader) loader.classList.add('loaded');
    }, 150);
  });

  // Back/forward navigation — always ensure page is visible
  // Handles both bfcache (persisted) and fresh load after back navigation
  window.addEventListener('pageshow', (e) => {
    // Always remove page-exit and ensure visibility on any pageshow
    document.body.classList.remove('page-exit');
    document.body.style.opacity = '';
    if (loader) loader.classList.add('loaded');

    // Re-trigger fade-in animation on bfcache restore
    if (e.persisted) {
      document.body.style.animation = 'none';
      document.body.offsetHeight; // force reflow
      document.body.style.animation = '';
    }
  });

  // Hamburger menu toggle (#18)
  const hamburger = document.getElementById('hamburger');
  const nav = document.getElementById('site-nav');
  if (hamburger && nav) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      nav.classList.toggle('open');
    });
    // Close menu when a nav link is clicked
    nav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        nav.classList.remove('open');
      });
    });
  }

  // Escape key — close mobile nav and password modals
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    // Close mobile nav
    if (nav && nav.classList.contains('open')) {
      hamburger.classList.remove('active');
      nav.classList.remove('open');
      hamburger.focus();
      return;
    }
    // Close password modal
    const pwModal = document.getElementById('password-modal');
    if (pwModal && !pwModal.classList.contains('hidden')) {
      pwModal.classList.add('hidden');
      return;
    }
  });
})();
