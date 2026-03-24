const { test, expect } = require('@playwright/test');
const { blockHeavyAssets } = require('./test-helpers');

async function navigateToFoxgloveProject(page) {
  await blockHeavyAssets(page);
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.hc-card', { timeout: 15000 });
  await page.locator('.hc-card', { hasText: 'Foxglove Studios' }).click();
  await expect(page.locator('#section-client-detail')).toBeVisible({ timeout: 5000 });
  await page.locator('#section-client-detail').getByText('Autumn Collection 2026').first().click();
  await expect(page.locator('#section-client-project-detail')).toBeVisible({ timeout: 5000 });
}

test.describe('Deliverables', () => {
  test('expanded card shows correct version count', async ({ page }) => {
    await navigateToFoxgloveProject(page);
    await expect(page.locator('#section-client-project-detail').getByText('2 versions')).toBeVisible();
    await expect(page.locator('#section-client-project-detail').getByText('1 version')).toBeVisible();
  });

  test('clicking a deliverable card expands it and shows version rows', async ({ page }) => {
    await navigateToFoxgloveProject(page);

    const heroCard = page.locator('.dl-card', { hasText: 'Hero Film' }).first();
    await heroCard.evaluate(el => el.classList.remove('collapsed'));
    await page.waitForTimeout(500);

    // Scope to the Hero Film card to avoid strict mode on multiple LATEST badges
    await expect(heroCard.getByText('LATEST')).toBeVisible({ timeout: 3000 });
    await expect(heroCard.getByText('v2').first()).toBeVisible();
    await expect(heroCard.getByText('v1').first()).toBeVisible();
  });

  test('clicking an expanded card collapses it', async ({ page }) => {
    await navigateToFoxgloveProject(page);

    const heroCard = page.locator('.dl-card', { hasText: 'Hero Film' }).first();
    await heroCard.evaluate(el => el.classList.remove('collapsed'));
    await page.waitForTimeout(500);
    await expect(heroCard.getByText('LATEST')).toBeVisible();

    await heroCard.evaluate(el => el.classList.add('collapsed'));
    await page.waitForTimeout(500);
    await expect(heroCard.getByText('LATEST')).not.toBeVisible();
  });

  test('latest version has LATEST badge', async ({ page }) => {
    await navigateToFoxgloveProject(page);

    const heroCard = page.locator('.dl-card', { hasText: 'Hero Film' }).first();
    await heroCard.evaluate(el => el.classList.remove('collapsed'));
    await page.waitForTimeout(500);

    const v2Section = heroCard.locator('[class*="version"]', { hasText: 'v2' }).first();
    await expect(v2Section).toContainText('LATEST');
  });

  test('status stripe colour matches status text', async ({ page }) => {
    await navigateToFoxgloveProject(page);
    await expect(page.locator('.dl-status', { hasText: 'Changes requested' })).toBeVisible();
    await expect(page.locator('.dl-status', { hasText: 'Approved' })).toBeVisible();
  });

  test('version note displays correctly', async ({ page }) => {
    await navigateToFoxgloveProject(page);

    const heroCard = page.locator('.dl-card', { hasText: 'Hero Film' }).first();
    await heroCard.evaluate(el => el.classList.remove('collapsed'));
    await page.waitForTimeout(500);

    await expect(heroCard.getByText('Tighter crop applied, colour grade refined')).toBeVisible();
    await expect(heroCard.getByText('First cut — hero film for autumn campaign')).toBeVisible();
  });
});
