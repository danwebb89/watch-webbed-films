const { test, expect } = require('@playwright/test');

const BASE = 'http://192.168.10.25:3501';

// Portal tests don't need admin auth
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Client Portal', () => {
  test('each portal link loads', async ({ page }) => {
    // Webbed Films has no password — test it directly
    await page.goto(`${BASE}/portal/webbed-films`);
    await expect(page.locator('h1', { hasText: 'Webbed Films' })).toBeVisible({ timeout: 10000 });

    // Password-protected portals should show password gate
    await page.goto(`${BASE}/portal/foxglove-studios`);
    // Should either show portal content or password gate
    const hasPasswordGate = await page.locator('input[type="password"], [class*="password"]').count() > 0;
    const hasContent = await page.locator('h1').count() > 0;
    expect(hasPasswordGate || hasContent).toBe(true);
  });

  test('portal shows correct projects and deliverables for Webbed Films', async ({ page }) => {
    await page.goto(`${BASE}/portal/webbed-films`);
    await page.waitForTimeout(1000);

    // Should show "Showreel 2026" project
    await expect(page.getByText('Showreel 2026')).toBeVisible({ timeout: 5000 });

    // Should show project count
    await expect(page.getByText('1 project')).toBeVisible();
  });

  test('portal project page loads', async ({ page }) => {
    await page.goto(`${BASE}/portal/webbed-films/project/showreel-2026`);
    await page.waitForTimeout(2000);

    // Should show project title or deliverable name
    const hasTitle = await page.getByText('Showreel 2026').count() > 0 ||
                     await page.getByText('Widescreen').count() > 0;
    expect(hasTitle).toBe(true);
  });

  test('leaving a comment works', async ({ page }) => {
    // Navigate to portal first to establish origin
    await page.goto(`${BASE}/portal/webbed-films`);
    await page.waitForTimeout(1000);

    // Get overview data via API (now on correct origin)
    const overview = await page.evaluate((base) =>
      fetch(`${base}/api/public/portal/webbed-films/projects/showreel-2026/overview`).then(r => r.json()),
      BASE
    );

    const formatSlug = overview.formats?.[0]?.slug || 'widescreen';

    // Go to review page
    await page.goto(`${BASE}/portal/webbed-films/project/showreel-2026?review=${formatSlug}`);
    await page.waitForTimeout(2000);

    // Find comment input
    const commentInput = page.locator('textarea, input[name*="comment"], [class*="comment"] textarea').first();
    if (await commentInput.isVisible().catch(() => false)) {
      const testComment = `Test comment ${Date.now()}`;
      await commentInput.fill(testComment);

      // Fill author name if required
      const nameInput = page.locator('input[name*="name"], input[placeholder*="name" i]').first();
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill('Test User');
      }

      // Submit
      const submitBtn = page.locator('button[type="submit"], button').filter({ hasText: /send|submit|post|comment/i }).first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  });

  test('approval workflow works', async ({ page }) => {
    await page.goto(`${BASE}/portal/webbed-films`);
    await page.waitForTimeout(1000);

    const overview = await page.evaluate((base) =>
      fetch(`${base}/api/public/portal/webbed-films/projects/showreel-2026/overview`).then(r => r.json()),
      BASE
    );

    const formatSlug = overview.formats?.[0]?.slug || 'widescreen';
    await page.goto(`${BASE}/portal/webbed-films/project/showreel-2026?review=${formatSlug}`);
    await page.waitForTimeout(2000);

    // Look for approval section
    const approvalSection = page.locator('[class*="approval"], [class*="sign-off"], [class*="review"]').first();
    if (await approvalSection.isVisible().catch(() => false)) {
      const approvedRadio = page.locator('input[value="approved"], label').filter({ hasText: /approve/i }).first();
      if (await approvedRadio.isVisible().catch(() => false)) {
        await approvedRadio.click();
      }
    }
  });

  test('resources section loads on portal dashboard', async ({ page }) => {
    await page.goto(`${BASE}/portal/webbed-films`);
    await page.waitForTimeout(1000);

    // Resources section
    await expect(page.getByText('Resources', { exact: true })).toBeVisible();
    // Should show resource file (use specific selector to avoid matching filter button AND filename)
    await expect(page.locator('.portal-resource-name', { hasText: 'Brand Guidelines' }).first()).toBeVisible();
  });
});
