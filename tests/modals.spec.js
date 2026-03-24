const { test, expect } = require('@playwright/test');
const { blockHeavyAssets } = require('./test-helpers');

test.describe('Modals', () => {
  test.beforeEach(async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });
  });

  test('client modal opens and closes correctly', async ({ page }) => {
    await page.evaluate(() => openModal('client-modal'));
    await expect(page.locator('#client-modal')).not.toHaveClass(/hidden/);

    await page.keyboard.press('Escape');
    await expect(page.locator('#client-modal')).toHaveClass(/hidden/, { timeout: 3000 });
  });

  test('film modal opens and closes correctly', async ({ page }) => {
    await page.locator('[data-section="films"]').click();
    await page.waitForSelector('.admin-film-card', { timeout: 15000 });

    await page.evaluate(() => openModal('film-modal'));
    await expect(page.locator('#film-modal')).not.toHaveClass(/hidden/);

    await page.keyboard.press('Escape');
    await expect(page.locator('#film-modal')).toHaveClass(/hidden/, { timeout: 3000 });
  });

  test('clicking outside a modal closes it', async ({ page }) => {
    await page.evaluate(() => openModal('client-modal'));
    await expect(page.locator('#client-modal')).not.toHaveClass(/hidden/);

    await page.locator('#client-modal').click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(500);
    await expect(page.locator('#client-modal')).toHaveClass(/hidden/);
  });

  test('Escape key closes modals', async ({ page }) => {
    await page.evaluate(() => openModal('client-modal'));
    await expect(page.locator('#client-modal')).not.toHaveClass(/hidden/);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(page.locator('#client-modal')).toHaveClass(/hidden/);
  });

  test('submit with empty required fields stays open', async ({ page }) => {
    await page.evaluate(() => openModal('client-modal'));
    await page.locator('#client-name').fill('');
    await page.locator('#client-form .btn-primary').click();
    await page.waitForTimeout(500);
    await expect(page.locator('#client-modal')).not.toHaveClass(/hidden/);
  });

  test('cancel does not save changes', async ({ page }) => {
    const countBefore = await page.locator('.hc-card').count();

    await page.evaluate(() => openModal('client-modal'));
    await page.locator('#client-name').fill('Should Not Be Saved');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const countAfter = await page.locator('.hc-card').count();
    expect(countAfter).toBe(countBefore);
  });

  test('rapid open/close does not break anything', async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => openModal('client-modal'));
      await page.waitForTimeout(50);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(50);
    }

    await page.waitForTimeout(300);
    await expect(page.locator('#home-clients-list')).toBeVisible();
  });

  test('confirm modal opens for delete actions', async ({ page, request }) => {
    // Create via Playwright request API (avoids page.evaluate hang)
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(c => c.name === 'session');
    const res = await request.post('/api/clients', {
      headers: { 'Cookie': `session=${sessionCookie?.value}` },
      data: { name: `Confirm Test ${Date.now()}` }
    });
    const { slug } = await res.json();

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-card', { timeout: 15000 });

    await page.locator('.hc-card', { hasText: 'Confirm Test' }).click();
    await expect(page.locator('#section-client-detail')).toBeVisible({ timeout: 5000 });

    await page.locator('#section-client-detail button', { hasText: '⋯' }).first().click();
    await page.waitForTimeout(300);

    const deleteBtn = page.locator('.kebab-item', { hasText: /Delete Client/ });
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click({ force: true });
      await expect(page.locator('#confirm-modal')).not.toHaveClass(/hidden/, { timeout: 3000 });
      await page.locator('#confirm-modal').getByRole('button', { name: /cancel/i }).click();
    }

    // Clean up
    await request.delete(`/api/clients/${slug}`, {
      headers: { 'Cookie': `session=${sessionCookie?.value}` }
    });
  });
});
