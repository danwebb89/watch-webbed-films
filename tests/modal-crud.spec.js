const { test, expect } = require('@playwright/test');
const { goToAdmin, goToFoxgloveProject, getSession } = require('./test-helpers');

test.describe('Turn 3: Modal Validation & CRUD', () => {

  // ─── CLIENT CRUD (via API + UI verification) ───

  test('client: create via API, appears in list, delete via API, disappears', async ({ page, request }) => {
    await goToAdmin(page);
    const session = await getSession(page);
    const name = `T3 Client ${Date.now()}`;

    // Create via API
    const createRes = await request.post('/api/clients', {
      headers: { Cookie: `session=${session}`, 'Content-Type': 'application/json' },
      data: { name }
    });
    expect(createRes.ok()).toBe(true);
    const client = await createRes.json();

    // Reload and verify
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });
    await expect(page.locator('.hc-card', { hasText: name })).toBeVisible({ timeout: 5000 });

    // Delete via API
    await request.delete(`/api/clients/${client.slug}`, { headers: { Cookie: `session=${session}` } });

    // Reload and verify gone
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });
    await expect(page.locator('.hc-card', { hasText: name })).not.toBeVisible({ timeout: 3000 });
  });

  // ─── PROJECT CRUD ───

  test('project: create via API, appears in client detail, delete', async ({ page, request }) => {
    await goToAdmin(page);
    const session = await getSession(page);
    const title = `T3 Project ${Date.now()}`;

    // Create via API
    const createRes = await request.post('/api/clients/foxglove-studios/projects', {
      headers: { Cookie: `session=${session}`, 'Content-Type': 'application/json' },
      data: { title }
    });
    expect(createRes.ok()).toBe(true);
    const project = await createRes.json();

    // Navigate to client detail
    await page.locator('.hc-card', { hasText: 'Foxglove Studios' }).click();
    await expect(page.locator('#section-client-detail')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#section-client-detail').getByText(title).first()).toBeVisible({ timeout: 5000 });

    // Delete
    await request.delete(`/api/clients/foxglove-studios/projects/${project.slug}`, { headers: { Cookie: `session=${session}` } });
  });

  // ─── DELIVERABLE CRUD ───

  test('deliverable: create via API, appears in project, delete', async ({ page, request }) => {
    await goToFoxgloveProject(page);
    const session = await getSession(page);
    const label = `T3 Deliv ${Date.now()}`;

    // Create via API
    const createRes = await request.post('/api/clients/foxglove-studios/projects/autumn-collection-2026/formats', {
      headers: { Cookie: `session=${session}`, 'Content-Type': 'application/json' },
      data: { label, type: 'video', aspect_ratio: '16:9' }
    });
    expect(createRes.ok()).toBe(true);
    const format = await createRes.json();

    // Navigate back to project to see new deliverable
    await goToFoxgloveProject(page);

    await expect(page.locator('.dl-name', { hasText: label })).toBeVisible({ timeout: 5000 });

    // Delete
    await request.delete(`/api/clients/foxglove-studios/projects/autumn-collection-2026/formats/${format.id}`, { headers: { Cookie: `session=${session}` } });
  });

  // ─── FILM CRUD ───

  test('film: create via API, verify via API, delete', async ({ page, request }) => {
    // Navigate to admin just to get session cookie
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    const session = await getSession(page);
    const title = `T3 Film ${Date.now()}`;

    // Create
    const createRes = await request.post('/api/films', {
      headers: { Cookie: `session=${session}`, 'Content-Type': 'application/json' },
      data: { title, slug: `t3-film-${Date.now()}`, category: 'Brand Film', year: 2026, visibility: 'public' }
    });
    expect(createRes.ok()).toBe(true);
    const film = await createRes.json();

    // Verify
    const getRes = await request.get('/api/films', { headers: { Cookie: `session=${session}` } });
    const films = await getRes.json();
    expect(films.find(f => f.title === title)).toBeDefined();

    // Delete and verify gone
    const delRes = await request.delete(`/api/films/${film.slug}`, { headers: { Cookie: `session=${session}` } });
    expect(delRes.ok()).toBe(true);

    const getRes2 = await request.get('/api/films', { headers: { Cookie: `session=${session}` } });
    const films2 = await getRes2.json();
    expect(films2.find(f => f.title === title)).toBeUndefined();
  });

  // ─── API VALIDATION ───

  test('API: creating client with empty name returns error', async ({ page, request }) => {
    await goToAdmin(page);
    const session = await getSession(page);

    const res = await request.post('/api/clients', {
      headers: { Cookie: `session=${session}`, 'Content-Type': 'application/json' },
      data: { name: '' }
    });
    expect(res.ok()).toBe(false);
  });

  test('API: creating film with empty title returns error', async ({ page, request }) => {
    await goToAdmin(page);
    const session = await getSession(page);

    const res = await request.post('/api/films', {
      headers: { Cookie: `session=${session}`, 'Content-Type': 'application/json' },
      data: { title: '' }
    });
    expect(res.ok()).toBe(false);
  });

  test('API: creating deliverable with empty label returns error', async ({ page, request }) => {
    await goToAdmin(page);
    const session = await getSession(page);

    const res = await request.post('/api/clients/foxglove-studios/projects/autumn-collection-2026/formats', {
      headers: { Cookie: `session=${session}`, 'Content-Type': 'application/json' },
      data: { label: '' }
    });
    expect(res.ok()).toBe(false);
  });
});
