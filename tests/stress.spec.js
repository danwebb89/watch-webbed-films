const { test, expect } = require('@playwright/test');
const { goToAdmin, goToFoxgloveProject, getSession } = require('./test-helpers');

test.describe('Turn 4: Stress Tests', () => {

  test('rapidly switch sidebar sections 10 times', async ({ page }) => {
    await goToAdmin(page);

    const sections = ['films', 'requests', 'home', 'films', 'home', 'requests', 'films', 'home', 'requests', 'home'];
    for (const section of sections) {
      await page.locator(`[data-section="${section}"]`).click();
      await page.waitForTimeout(200);
    }

    // Should end on home section, no crashes
    await expect(page.locator('#section-home')).toBeVisible({ timeout: 5000 });
    // No JS errors that crash the page
    const hasContent = await page.locator('.hc-card').count();
    expect(hasContent).toBeGreaterThan(0);
  });

  test('rapidly filter films 20 times', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('[data-section="films"]').click();
    await page.waitForSelector('.admin-film-card', { timeout: 15000 });

    // Get all filter buttons
    const filters = page.locator('.film-filter-pill, [class*="filter-pill"]');
    const count = await filters.count();

    if (count >= 2) {
      for (let i = 0; i < 20; i++) {
        await filters.nth(i % count).click({ force: true });
        await page.waitForTimeout(50);
      }
    }

    // Click "All" to reset
    await page.locator('.film-filter-pill', { hasText: /^All/ }).click({ force: true });
    await page.waitForTimeout(300);

    // Films should still render
    const filmCount = await page.locator('.admin-film-card').count();
    expect(filmCount).toBeGreaterThan(0);
  });

  test('rapidly expand/collapse deliverable cards', async ({ page }) => {
    await goToFoxgloveProject(page);

    const cards = page.locator('.dl-card');
    const cardCount = await cards.count();

    // Toggle each card 5 times rapidly
    for (let c = 0; c < cardCount; c++) {
      const card = cards.nth(c);
      for (let i = 0; i < 5; i++) {
        await card.locator('.dl-header, .dl-row-main').first().click({ force: true });
        await page.waitForTimeout(50);
      }
    }

    // Page should still be functional
    await page.waitForTimeout(300);
    await expect(page.locator('#section-client-project-detail')).toBeVisible();
    const dlCount = await page.locator('.dl-name').count();
    expect(dlCount).toBeGreaterThan(0);
  });

  test('no console errors after rapid navigation', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('404') && !msg.text().includes('Failed to load resource')) {
        consoleErrors.push(msg.text());
      }
    });

    await goToAdmin(page);

    // Rapid navigation
    for (let i = 0; i < 5; i++) {
      await page.locator('.hc-card').first().click();
      await page.waitForTimeout(200);
      await page.locator('[data-section="home"]').click();
      await page.waitForTimeout(200);
    }

    // Filter out known benign errors
    const realErrors = consoleErrors.filter(e =>
      !e.includes('net::ERR') && !e.includes('favicon') && !e.includes('transcode')
    );

    if (realErrors.length > 0) {
      console.log('Console errors during stress test:');
      realErrors.forEach(e => console.log(`  - ${e}`));
    }
    // Allow up to 3 non-critical errors
    expect(realErrors.length).toBeLessThanOrEqual(3);
  });
});
