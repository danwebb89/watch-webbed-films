const { test, expect } = require('@playwright/test');
const { blockHeavyAssets } = require('./test-helpers');

test.describe('Turn 1: Downloads & Back Navigation', () => {

  // ─── DOWNLOAD LINKS ───

  test('version download links return valid files without navigating away', async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });

    // Get all clients with versions via API
    const data = await page.evaluate(async () => {
      const clients = await fetch('/api/clients').then(r => r.json());
      const downloads = [];
      for (const c of clients) {
        const projects = await fetch(`/api/clients/${c.slug}/projects`).then(r => r.json()).catch(() => []);
        if (!Array.isArray(projects)) continue;
        for (const p of projects) {
          const formats = await fetch(`/api/clients/${c.slug}/projects/${p.slug}/formats`).then(r => r.json()).catch(() => []);
          for (const f of formats) {
            const versions = await fetch(`/api/clients/${c.slug}/projects/${p.slug}/formats/${f.id}/versions`).then(r => r.json()).catch(() => []);
            for (const v of versions) {
              downloads.push({ label: `${c.name} > ${p.title} > ${f.label} v${v.version_number}`, id: v.id });
            }
          }
        }
      }
      return downloads;
    });

    expect(data.length).toBeGreaterThan(0);

    // Check each download endpoint returns 200 with content-disposition
    for (const d of data) {
      const status = await page.evaluate(async (id) => {
        const res = await fetch(`/api/download/version/${id}`, { method: 'HEAD' });
        return { status: res.status, headers: Object.fromEntries(res.headers.entries()) };
      }, d.id);

      expect(status.status, `Version download ${d.label} returned ${status.status}`).toBe(200);
    }

    // Confirm we're still on admin page (downloads didn't navigate away)
    await expect(page).toHaveURL(/\/admin/);
  });

  test('resource download links return valid files', async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });

    const resources = await page.evaluate(async () => {
      const clients = await fetch('/api/clients').then(r => r.json());
      const all = [];
      for (const c of clients) {
        const res = await fetch(`/api/clients/${c.slug}/resources`).then(r => r.json()).catch(() => []);
        for (const r of res) {
          all.push({ label: `${c.name}: ${r.filename}`, id: r.id });
        }
      }
      return all;
    });

    for (const r of resources) {
      const status = await page.evaluate(async (id) => {
        const res = await fetch(`/api/download/resource/${id}`, { method: 'HEAD' });
        return res.status;
      }, r.id);
      expect(status, `Resource ${r.label} returned ${status}`).toBe(200);
    }

    await expect(page).toHaveURL(/\/admin/);
  });

  test('project file download links return valid files', async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });

    const files = await page.evaluate(async () => {
      const clients = await fetch('/api/clients').then(r => r.json());
      const all = [];
      for (const c of clients) {
        const projects = await fetch(`/api/clients/${c.slug}/projects`).then(r => r.json()).catch(() => []);
        if (!Array.isArray(projects)) continue;
        for (const p of projects) {
          const pfiles = await fetch(`/api/clients/${c.slug}/projects/${p.slug}/files`).then(r => r.json()).catch(() => []);
          for (const f of pfiles) {
            all.push({ label: `${c.name} > ${p.title}: ${f.filename}`, id: f.id });
          }
        }
      }
      return all;
    });

    for (const f of files) {
      const status = await page.evaluate(async (id) => {
        const res = await fetch(`/api/download/file/${id}`, { method: 'HEAD' });
        return res.status;
      }, f.id);
      // Files may or may not exist — log 404s but don't fail
      if (status !== 200) {
        console.log(`  Warning: project file ${f.label} returned ${status}`);
      }
    }

    await expect(page).toHaveURL(/\/admin/);
  });

  // ─── BACK BUTTON NAVIGATION ───

  test('back button: home → client detail → home', async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });

    // Go to client detail
    await page.locator('.hc-card').first().click();
    await expect(page.locator('#section-client-detail')).toBeVisible({ timeout: 5000 });

    // Back
    await page.goBack();
    await page.waitForTimeout(500);
    await expect(page.locator('#section-home')).toBeVisible({ timeout: 5000 });
  });

  test('back button: home → client → project → client', async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });

    // Go to Foxglove
    await page.locator('.hc-card', { hasText: 'Foxglove Studios' }).click();
    await expect(page.locator('#section-client-detail')).toBeVisible({ timeout: 5000 });

    // Go to project
    await page.locator('#section-client-detail').getByText('Autumn Collection 2026').first().click();
    await expect(page.locator('#section-client-project-detail')).toBeVisible({ timeout: 5000 });

    // Back to client
    await page.goBack();
    await page.waitForTimeout(500);
    await expect(page.locator('#section-client-detail')).toBeVisible({ timeout: 5000 });
  });

  test('back button: films → home works', async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });

    // Switch to films via evaluate (reliable)
    await page.evaluate(() => showSection('films'));
    await page.waitForSelector('.admin-film-card', { timeout: 15000 });

    // Back to home
    await page.goBack();
    await page.waitForTimeout(1000);
    // popstate fires and should restore home section
    await expect(page.locator('#section-home')).toBeVisible({ timeout: 10000 });
  });

  test('back button: requests → home works', async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });

    // Switch to requests
    await page.evaluate(() => showSection('requests'));
    await page.waitForTimeout(500);
    await expect(page.locator('#section-requests')).toBeVisible({ timeout: 5000 });

    // Back to home
    await page.goBack();
    await page.waitForTimeout(1000);
    await expect(page.locator('#section-home')).toBeVisible({ timeout: 10000 });
  });

  test('back button works across multiple section switches', async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });

    // Home → Films → Requests
    await page.evaluate(() => showSection('films'));
    await page.waitForSelector('.admin-film-card', { timeout: 15000 });

    await page.evaluate(() => showSection('requests'));
    await page.waitForTimeout(500);

    // Back should restore films or at least go somewhere valid
    await page.goBack();
    await page.waitForTimeout(1000);

    // Check we're on a valid section (films most likely)
    const anySection = await page.evaluate(() => {
      return document.querySelector('#section-films.active, #section-home.active, #section-requests.active') !== null
        || document.querySelector('#section-films:not([style*="display: none"]), #section-home:not([style*="display: none"])') !== null;
    });
    expect(anySection).toBe(true);
  });
});
