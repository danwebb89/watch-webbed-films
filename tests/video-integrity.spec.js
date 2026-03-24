const { test, expect } = require('@playwright/test');
const { goToAdmin, getSession } = require('./test-helpers');

test.describe('Turn 8: Video Integrity', () => {

  test('all film video URLs return 200', async ({ page, request }) => {
    await goToAdmin(page);
    const session = await getSession(page);

    const films = await (await request.get('/api/films', { headers: { Cookie: `session=${session}` } })).json();
    const errors = [];

    for (const f of films) {
      if (!f.video) { errors.push(`${f.title}: no video path`); continue; }
      const res = await request.head(`http://192.168.10.25:3501${f.video}`, {
        headers: { Cookie: `session=${session}` }
      });
      if (res.status() !== 200 && res.status() !== 206) {
        errors.push(`${f.title}: ${f.video} → ${res.status()}`);
      }
    }

    if (errors.length > 0) {
      console.log(`${errors.length} film videos broken:`);
      errors.forEach(e => console.log(`  ✗ ${e}`));
    }
    expect(errors).toHaveLength(0);
  });

  test('all deliverable version videos return 200', async ({ page, request }) => {
    await goToAdmin(page);
    const session = await getSession(page);
    const headers = { Cookie: `session=${session}` };

    const clients = await (await request.get('/api/clients', { headers })).json();
    const errors = [];
    let checked = 0;

    for (const c of clients) {
      const projects = await (await request.get(`/api/clients/${c.slug}/projects`, { headers })).json();
      if (!Array.isArray(projects)) continue;
      for (const p of projects) {
        const formats = await (await request.get(`/api/clients/${c.slug}/projects/${p.slug}/formats`, { headers })).json();
        for (const f of formats) {
          const versions = await (await request.get(`/api/clients/${c.slug}/projects/${p.slug}/formats/${f.id}/versions`, { headers })).json();
          for (const v of versions) {
            checked++;
            if (!v.file_path) { errors.push(`${c.name}>${p.title}>${f.label} v${v.version_number}: no path`); continue; }
            const res = await request.head(`http://192.168.10.25:3501${v.file_path}`, { headers });
            if (res.status() !== 200 && res.status() !== 206) {
              errors.push(`${c.name}>${p.title}>${f.label} v${v.version_number}: ${res.status()}`);
            }
          }
        }
      }
    }

    console.log(`Checked ${checked} version videos`);
    expect(errors).toHaveLength(0);
  });

  test('version download endpoints return valid responses', async ({ page, request }) => {
    await goToAdmin(page);
    const session = await getSession(page);
    const headers = { Cookie: `session=${session}` };

    const clients = await (await request.get('/api/clients', { headers })).json();
    let checked = 0;

    for (const c of clients) {
      const projects = await (await request.get(`/api/clients/${c.slug}/projects`, { headers })).json();
      if (!Array.isArray(projects)) continue;
      for (const p of projects) {
        const formats = await (await request.get(`/api/clients/${c.slug}/projects/${p.slug}/formats`, { headers })).json();
        for (const f of formats) {
          const versions = await (await request.get(`/api/clients/${c.slug}/projects/${p.slug}/formats/${f.id}/versions`, { headers })).json();
          for (const v of versions) {
            if (!v.file_path) continue;
            const res = await request.get(`http://192.168.10.25:3501/api/download/version/${v.id}`, { headers });
            // Download should return 200 (file streams) or at least not error
            expect(res.status(), `Version ${v.id} download failed`).toBeLessThan(500);
            checked++;
          }
        }
      }
    }
    console.log(`Checked ${checked} download endpoints`);
    expect(checked).toBeGreaterThan(0);
  });
});
