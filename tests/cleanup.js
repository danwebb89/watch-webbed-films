// Global cleanup — run before test suite to remove stale test data
const { test } = require('@playwright/test');

test('cleanup stale test data', async ({ page }) => {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.hc-card', { timeout: 15000 });

  // Delete test clients
  const deleted = await page.evaluate(async () => {
    const clients = await fetch('/api/clients').then(r => r.json());
    let count = 0;
    for (const c of clients) {
      if (/Test|Confirm|Edit|Empty|DblClick|Associates|Über|Quoted|O'Brien|CRUD|T3|T[0-9]/.test(c.name)) {
        await fetch(`/api/clients/${c.slug}`, { method: 'DELETE' });
        count++;
      }
    }
    // Delete test films
    const films = await fetch('/api/films').then(r => r.json());
    for (const f of films) {
      if (/Test Film|Delete Me|Edit Film|CRUD|T3|T[0-9]/.test(f.title)) {
        await fetch(`/api/films/${f.slug}`, { method: 'DELETE' });
        count++;
      }
    }
    // Delete test deliverables from foxglove project
    const formats = await fetch('/api/clients/foxglove-studios/projects/autumn-collection-2026/formats').then(r => r.json()).catch(() => []);
    for (const f of formats) {
      if (/Delete Me|BTS Reel|CRUD|T3|T[0-9]/.test(f.label)) {
        await fetch(`/api/clients/foxglove-studios/projects/autumn-collection-2026/formats/${f.id}`, { method: 'DELETE' });
        count++;
      }
    }
    return count;
  });

  console.log(`Cleaned up ${deleted} stale test entries`);
});
