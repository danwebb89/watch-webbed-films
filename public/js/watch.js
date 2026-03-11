document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('film');

  if (!slug) {
    window.location.href = '/';
    return;
  }

  try {
    const res = await fetch('/data/films.json');
    const films = await res.json();
    const film = films.find(f => f.slug === slug && f.public);

    if (!film) {
      window.location.href = '/';
      return;
    }

    document.title = `${film.title} — Webbed Films`;
    document.getElementById('watch-title').textContent = film.title;
    document.getElementById('watch-meta').innerHTML = `
      <span>${film.category}</span>
      <span>${film.year}</span>
    `;
    document.getElementById('watch-description').textContent = film.description || '';

    const video = document.getElementById('video');
    video.src = film.video;

    initPlayer(document.getElementById('player-wrap'));
  } catch (e) {
    document.querySelector('.watch-container').innerHTML =
      '<div class="empty-state"><p>// Film not found</p></div>';
  }
});
