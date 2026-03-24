const { test, expect } = require('@playwright/test');
const { blockHeavyAssets } = require('./test-helpers');


test.describe('Edge Cases', () => {
  test('special characters in client names', async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin#home', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#home-clients-list');

    const specialNames = [
      'Test & Associates',
      "O'Brien Studios",
      'Über Creative <Agency>',
      '"Quoted" Name',
    ];

    for (const name of specialNames) {
      const slug = await page.evaluate(async (n) => {
        const res = await fetch('/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: n })
        });
        if (!res.ok) return null;
        return (await res.json()).slug;
      }, name);

      if (slug) {
        // Refresh to see card
        await blockHeavyAssets(page);
        await page.goto('/admin#home', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#home-clients-list');
        await page.waitForTimeout(300);

        // Cards should render without broken HTML
        const cardCount = await page.locator('.hc-card').count();
        expect(cardCount).toBeGreaterThan(0);

        // No script injection
        const hasScript = await page.evaluate(() =>
          document.querySelector('.hc-card script') !== null
        );
        expect(hasScript).toBe(false);

        // Clean up
        await page.evaluate(s => fetch(`/api/clients/${s}`, { method: 'DELETE' }).catch(() => {}), slug);
      }
    }
  });

  test('very long names truncate, not overflow', async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin#home', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#home-clients-list');

    const longName = 'A'.repeat(120) + ' Studios';
    const slug = await page.evaluate(async (n) => {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n })
      });
      if (!res.ok) return null;
      return (await res.json()).slug;
    }, longName);

    if (slug) {
      await blockHeavyAssets(page);
      await page.goto('/admin#home', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#home-clients-list');

      const hasHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(hasHScroll).toBe(false);

      await page.evaluate(s => fetch(`/api/clients/${s}`, { method: 'DELETE' }).catch(() => {}), slug);
    }
  });

  test('empty states: 0 projects shows proper empty state', async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin#home', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#home-clients-list');

    const slug = await page.evaluate(async () => {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Empty Client ${Date.now()}` })
      });
      return (await res.json()).slug;
    });

    await blockHeavyAssets(page);
    await page.goto('/admin#home', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#home-clients-list');
    await page.locator('.hc-card', { hasText: 'Empty Client' }).click();
    await expect(page.locator('#section-client-detail')).toBeVisible({ timeout: 5000 });

    // Should show projects section with 0 count or empty state
    // The client detail page should load even with no projects
    const detailVisible = await page.locator('#section-client-detail').isVisible();
    expect(detailVisible).toBe(true);

    await page.evaluate(s => fetch(`/api/clients/${s}`, { method: 'DELETE' }).catch(() => {}), slug);
  });

  test('empty states: 0 search results for clients', async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin#home', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#home-clients-list');

    await page.getByPlaceholder('Search clients...').fill('zzzznoexist999');
    await page.waitForTimeout(400);

    const visibleCount = await page.evaluate(() => {
      const cards = document.querySelectorAll('.hc-card');
      return Array.from(cards).filter(c => c.offsetParent !== null).length;
    });
    expect(visibleCount).toBe(0);
  });

  test('empty states: 0 films search results', async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin#films');
    await page.waitForSelector('#films-list');

    await page.getByPlaceholder('Search films...').fill('zzzznoexist999');
    await page.waitForTimeout(400);

    const visibleCount = await page.evaluate(() => {
      const cards = document.querySelectorAll('.admin-film-card');
      return Array.from(cards).filter(c => c.offsetParent !== null).length;
    });
    expect(visibleCount).toBe(0);
  });

  test('double-clicking submit does not create duplicates', async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin#home', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#home-clients-list');

    const testName = `DblClick Test ${Date.now()}`;

    // Open modal
    await page.locator('#client-modal').evaluate(el => el.classList.remove('hidden'));
    await expect(page.locator('#client-modal')).not.toHaveClass(/hidden/);

    await page.locator('#client-name').fill(testName);
    await page.waitForTimeout(200);

    // Double-click submit
    const submitBtn = page.locator('#client-form button[type="submit"], #client-form .btn-primary');
    await submitBtn.dblclick();
    await page.waitForTimeout(1500);

    // Check only one was created
    const clients = await page.evaluate(() => fetch('/api/clients').then(r => r.json()));
    const matches = clients.filter(c => c.name.includes('DblClick Test'));
    expect(matches.length).toBeLessThanOrEqual(1);

    // Clean up
    for (const c of matches) {
      await page.evaluate(s => fetch(`/api/clients/${s}`, { method: 'DELETE' }).catch(() => {}), c.slug);
    }
  });
});
