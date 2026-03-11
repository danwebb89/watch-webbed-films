document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const uuid = params.get('id');

  if (!uuid) {
    document.querySelector('.screening-body').innerHTML =
      '<div class="empty-state"><p>// Invalid screening link</p></div>';
    return;
  }

  try {
    const res = await fetch('/data/projects.json');
    const projects = await res.json();
    const project = projects.find(p => p.uuid === uuid && p.active);

    if (!project) {
      document.querySelector('.screening-body').innerHTML =
        '<div class="empty-state"><p>// This screening link has expired</p></div>';
      return;
    }

    document.title = `${project.title} — Screening`;
    document.getElementById('screening-title').textContent = project.title;

    const video = document.getElementById('video');
    video.src = project.video;

    initPlayer(document.getElementById('player-wrap'));
  } catch (e) {
    document.querySelector('.screening-body').innerHTML =
      '<div class="empty-state"><p>// Unable to load screening</p></div>';
  }
});
