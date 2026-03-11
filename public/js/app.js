document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('film-grid');
  let allFilms = [];

  function renderFilms(films) {
    if (films.length === 0) {
      grid.innerHTML = '<div class="empty-state"><p>// No films yet</p></div>';
      grid.className = '';
      return;
    }
    grid.className = 'film-grid';
    grid.innerHTML = films.map(film => `
      <a href="/watch.html?film=${film.slug}" class="film-card">
        <img src="${film.thumbnail}" alt="${film.title}" loading="lazy"
             onerror="this.style.display='none'">
        <div class="film-card-overlay">
          <div class="film-card-meta">${film.category} &mdash; ${film.year}</div>
          <div class="film-card-title">${film.title}</div>
        </div>
      </a>
    `).join('');
  }

  try {
    const res = await fetch('/data/films.json');
    const films = await res.json();
    allFilms = films.filter(f => f.public);
    renderFilms(allFilms);
  } catch (e) {
    grid.innerHTML = '<div class="empty-state"><p>// Unable to load films</p></div>';
    grid.className = '';
    return;
  }

  // Category filtering
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const cat = btn.dataset.cat;
      if (cat === 'all') {
        renderFilms(allFilms);
      } else {
        renderFilms(allFilms.filter(f => f.category === cat));
      }
    });
  });
});
