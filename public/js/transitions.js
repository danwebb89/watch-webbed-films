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

  // Dismiss loader when content is ready
  window.addEventListener('load', () => {
    setTimeout(() => {
      const loader = document.getElementById('site-loader');
      if (loader) loader.classList.add('loaded');
    }, 150);
  });
})();
