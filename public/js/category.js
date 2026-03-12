document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('film-grid');

  // Extract category from URL: /category/short-films → "short-films"
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const catSlug = pathParts[1] || '';

  if (!catSlug) {
    window.location.href = '/';
    return;
  }

  // Slug-to-name mapping
  const categories = {
    'originals': 'Originals',
    'documentary': 'Documentary',
    'short-films': 'Short Films',
    'feature-films': 'Feature Films',
    'corporate': 'Corporate'
  };

  const categoryName = categories[catSlug];
  if (!categoryName) {
    window.location.href = '/';
    return;
  }

  document.getElementById('category-title').textContent = categoryName;
  document.title = `${categoryName} — Webbed Films`;

  // Session unlock helpers
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

  function renderFilms(films) {
    document.getElementById('category-count').textContent = films.length;

    if (films.length === 0) {
      grid.innerHTML = '<div class="empty-state"><p>// No films in this category</p></div>';
      grid.className = '';
      return;
    }
    grid.className = 'film-grid';
    grid.innerHTML = films.map(film => {
      const locked = film.password_protected && !isUnlocked(film.slug);
      const lockIcon = locked ? `<div class="film-card-lock"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/></svg></div>` : '';
      return `
      <a href="${locked ? '#' : `/watch.html?film=${film.slug}`}" class="film-card${locked ? ' film-card-locked' : ''}" ${locked ? `data-slug="${film.slug}" data-title="${film.title}"` : ''}>
        <img src="${film.thumbnail}" alt="${film.title}" loading="lazy"
             onerror="this.style.display='none'">
        ${lockIcon}
        <div class="film-card-overlay">
          <div class="film-card-meta">${film.category} &mdash; ${film.year}</div>
          <div class="film-card-title">${film.title}</div>
        </div>
      </a>`;
    }).join('');

    // Attach click handlers for locked films
    grid.querySelectorAll('.film-card-locked').forEach(card => {
      card.addEventListener('click', (e) => {
        e.preventDefault();
        openPasswordModal(card.dataset.slug, card.dataset.title);
      });
    });
  }

  // Password modal
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

  // Fetch and render
  try {
    const res = await fetch('/api/public/films');
    const films = await res.json();
    const filtered = films.filter(f => f.category === categoryName);
    renderFilms(filtered);
  } catch (e) {
    grid.innerHTML = '<div class="empty-state"><p>// Unable to load films</p></div>';
    grid.className = '';
  }
});
