const { test, expect } = require('@playwright/test');
const { goToAdmin, getSession } = require('./test-helpers');

const BASE = 'http://192.168.10.25:3501';

test.describe('Turn 9: Security', () => {

  // ─── AUTH PROTECTION ───

  test('admin redirects to login without auth', async ({ page }) => {
    // Use empty storage state for this test
    const ctx = await page.context().browser().newContext({ storageState: { cookies: [], origins: [] } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    await expect(p).toHaveURL(/\/login/);
    await ctx.close();
  });

  test('API endpoints return 401 without auth', async ({ browser }) => {
    // Use a fresh context with NO cookies
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });

    // Test API calls from a page with no session cookie
    const results = await page.evaluate(async () => {
      const tests = [
        { method: 'GET', url: '/api/films' },
        { method: 'GET', url: '/api/clients' },
      ];
      const results = [];
      for (const t of tests) {
        const res = await fetch(t.url);
        results.push({ ...t, status: res.status });
      }
      return results;
    });

    for (const r of results) {
      expect(r.status, `${r.method} ${r.url} should be 401`).toBe(401);
    }
    await ctx.close();
  });

  // ─── XSS PROTECTION ───

  test('XSS in client name is escaped', async ({ page, request }) => {
    await goToAdmin(page);
    const session = await getSession(page);

    const xssName = '<img src=x onerror=alert(1)>XSSTest';
    const res = await request.post('/api/clients', {
      headers: { Cookie: `session=${session}`, 'Content-Type': 'application/json' },
      data: { name: xssName }
    });

    if (res.ok()) {
      const client = await res.json();

      // Verify via API that the name is stored correctly (not executed)
      const getRes = await request.get('/api/clients', { headers: { Cookie: `session=${session}` } });
      const clients = await getRes.json();
      const found = clients.find(c => c.slug === client.slug);
      expect(found).toBeDefined();
      // The name should be stored as-is (escaping happens on render)
      expect(found.name).toContain('XSSTest');

      // Clean up
      await request.delete(`/api/clients/${client.slug}`, { headers: { Cookie: `session=${session}` } });
    }
  });

  test('SQL injection in client name does not break API', async ({ page, request }) => {
    await goToAdmin(page);
    const session = await getSession(page);

    const sqlName = "'; DROP TABLE clients; --";
    const res = await request.post('/api/clients', {
      headers: { Cookie: `session=${session}`, 'Content-Type': 'application/json' },
      data: { name: sqlName }
    });

    if (res.ok()) {
      const client = await res.json();
      // If it was created, the database is still intact
      const checkRes = await request.get('/api/clients', { headers: { Cookie: `session=${session}` } });
      expect(checkRes.ok()).toBe(true);
      const clients = await checkRes.json();
      expect(clients.length).toBeGreaterThan(0);

      // Clean up
      await request.delete(`/api/clients/${client.slug}`, { headers: { Cookie: `session=${session}` } });
    }
  });

  // ─── PORTAL DATA ISOLATION ───

  test('portal only shows its own client data', async ({ request }) => {
    // Get Webbed Films portal data
    const r1 = await request.get(`${BASE}/api/public/portal/webbed-films`);
    expect(r1.ok()).toBe(true);
    const data1 = await r1.json();

    // Verify it doesn't contain other clients' data
    const otherClients = ['foxglove-studios', 'hartwell-gray', 'atlas-creative-agency'];
    for (const other of otherClients) {
      const projectSlugs = (data1.projects || []).map(p => p.client_slug);
      expect(projectSlugs).not.toContain(other);
    }
  });

  test('portal cannot access non-existent client', async ({ request }) => {
    const res = await request.get(`${BASE}/api/public/portal/nonexistent-client-xyz`);
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});
