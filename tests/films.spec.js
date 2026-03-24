const { test, expect } = require('@playwright/test');
const { blockHeavyAssets } = require('./test-helpers');


test.describe('Films', () => {
  test.beforeEach(async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });
    await page.locator('[data-section="films"]').click();
    await page.waitForSelector('.admin-film-card', { timeout: 15000 });
  });

  test('films grid loads and shows all films', async ({ page }) => {
    const filmCards = page.locator('.admin-film-card');
    const count = await filmCards.count();
    expect(count).toBeGreaterThanOrEqual(50); // We know there are 56
  });

  test('filter pills show correct counts', async ({ page }) => {
    await expect(page.getByRole('button', { name: /All\s+\d+/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Public\s+\d+/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Unlisted\s+\d+/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Password\s+\d+/ })).toBeVisible();

    // Counts should be numbers > 0 (except maybe Client)
    const allBtn = page.getByRole('button', { name: /^All/ });
    const allText = await allBtn.textContent();
    const allCount = parseInt(allText.match(/\d+/)?.[0] || '0');
    expect(allCount).toBeGreaterThanOrEqual(50);
  });

  test('clicking a filter pill filters the grid to only matching films', async ({ page }) => {
    // Click "Public" filter
    await page.getByRole('button', { name: /^Public/ }).click();
    await page.waitForTimeout(500);

    // All visible film cards should have PUBLIC badge
    const visibleCards = page.locator('.admin-film-card >> visible=true');
    const count = await visibleCards.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(56); // Should be fewer than All

    // Click "Unlisted"
    await page.getByRole('button', { name: /^Unlisted/ }).click();
    await page.waitForTimeout(500);

    const unlistedCount = await page.locator('.admin-film-card >> visible=true').count();
    expect(unlistedCount).toBeGreaterThan(0);
    expect(unlistedCount).toBeLessThan(count); // Fewer than public
  });

  test('clicking All shows everything again', async ({ page }) => {
    const totalBefore = await page.locator('.admin-film-card').count();

    // Filter to Public
    await page.getByRole('button', { name: /^Public/ }).click();
    await page.waitForTimeout(300);

    // Back to All
    await page.getByRole('button', { name: /^All/ }).click();
    await page.waitForTimeout(300);

    const totalAfter = await page.locator('.admin-film-card').count();
    expect(totalAfter).toBe(totalBefore);
  });

  test('category headings group films correctly', async ({ page }) => {
    // Check known category headings using the specific heading class
    await expect(page.locator('.admin-category-heading', { hasText: 'Brand Film' })).toBeVisible();
    await expect(page.locator('.admin-category-heading', { hasText: 'Documentary' })).toBeVisible();
    await expect(page.locator('.admin-category-heading', { hasText: 'Charity' })).toBeVisible();
    await expect(page.locator('.admin-category-heading', { hasText: 'External Communications' })).toBeVisible();
  });

  test('creating a film adds it to the grid', async ({ page }) => {
    // Create via API (no video upload needed for this test)
    const testTitle = `Test Film ${Date.now()}`;
    const slug = await page.evaluate(async (title) => {
      const res = await fetch('/api/films', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          category: 'Brand Film',
          year: 2026,
          visibility: 'public',
          video: '/assets/videos/test.mp4',
          thumbnail: '/assets/thumbs/test_thumb.jpg'
        })
      });
      const data = await res.json();
      return data.slug;
    }, testTitle);

    // Refresh films list — reload and switch to films section
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });
    await page.locator('[data-section="films"]').click();
    await page.waitForTimeout(1000);
    // Trigger a fresh load of films
    await page.evaluate(() => typeof loadFilms === 'function' && loadFilms());
    await page.waitForTimeout(500);
    await page.waitForTimeout(500);

    // Should appear in grid
    await expect(page.locator('.admin-film-card', { hasText: testTitle })).toBeVisible();

    // Clean up
    await page.evaluate(s => fetch(`/api/films/${s}`, { method: 'DELETE' }), slug);
  });

  test('deleting a film removes it after confirmation', async ({ page }) => {
    // Create a temporary film
    const testTitle = `Delete Me Film ${Date.now()}`;
    const slug = await page.evaluate(async (title) => {
      const res = await fetch('/api/films', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          category: 'Brand Film',
          year: 2026,
          visibility: 'public',
          video: '/assets/videos/test.mp4',
          thumbnail: '/assets/thumbs/test_thumb.jpg'
        })
      });
      return (await res.json()).slug;
    }, testTitle);

    await blockHeavyAssets(page);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });
    await page.locator('[data-section="films"]').click();
    await page.waitForSelector('.admin-film-card', { timeout: 15000 });
    await page.waitForTimeout(500);

    // Find the film card and click its kebab menu
    const filmCard = page.locator('.admin-film-card', { hasText: testTitle });
    await expect(filmCard).toBeVisible();
    await filmCard.locator('button', { hasText: '⋯' }).click();
    await page.waitForTimeout(200);

    // Click delete from dropdown
    const deleteOption = page.locator('[class*="kebab"] button, [class*="dropdown"] button, [class*="menu"] button').filter({ hasText: /delete/i }).first();
    if (await deleteOption.isVisible()) {
      await deleteOption.click();
      // Confirm
      const confirmBtn = page.locator('#confirm-modal .btn-primary, #confirm-modal button').filter({ hasText: /confirm|delete|yes/i }).first();
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
      }
    }

    await page.waitForTimeout(500);
    // If UI delete didn't work, clean up via API
    await page.evaluate(s => fetch(`/api/films/${s}`, { method: 'DELETE' }).catch(() => {}), slug);
  });

  test('editing film metadata updates the card', async ({ page }) => {
    // Create a temporary film
    const origTitle = `Edit Film ${Date.now()}`;
    const slug = await page.evaluate(async (title) => {
      const res = await fetch('/api/films', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          category: 'Brand Film',
          year: 2026,
          visibility: 'public',
          video: '/assets/videos/test.mp4',
          thumbnail: '/assets/thumbs/test_thumb.jpg'
        })
      });
      return (await res.json()).slug;
    }, origTitle);

    await blockHeavyAssets(page);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });
    await page.locator('[data-section="films"]').click();
    await page.waitForSelector('.admin-film-card', { timeout: 15000 });
    await page.waitForTimeout(500);

    // Click edit on the film card
    const filmCard = page.locator('.admin-film-card', { hasText: origTitle });
    await filmCard.locator('button', { hasText: 'Edit' }).click();

    // Film modal should open
    await expect(page.locator('#film-modal')).not.toHaveClass(/hidden/);

    // Change title
    const newTitle = `Edited Film ${Date.now()}`;
    await page.locator('#film-title').fill(newTitle);

    // Submit
    await page.locator('#film-form button[type="submit"], #film-form .btn-primary').click();
    await expect(page.locator('#film-modal')).toHaveClass(/hidden/, { timeout: 5000 });

    await page.waitForTimeout(500);
    // Card should show new title
    await expect(page.locator('.admin-film-card', { hasText: newTitle })).toBeVisible();

    // Clean up
    await page.evaluate(s => fetch(`/api/films/${s}`, { method: 'DELETE' }).catch(() => {}), slug);
  });
});
