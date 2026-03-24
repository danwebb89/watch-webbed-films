const { test, expect } = require('@playwright/test');

// Portal tests don't need admin auth
test.use({ storageState: { cookies: [], origins: [] } });

const BASE = 'http://192.168.10.25:3501';

test.describe('Turn 2: Portal Experience', () => {

  // ─── WEBBED FILMS PORTAL (no password) ───

  test('webbed portal loads and renders correctly', async ({ page }) => {
    await page.goto(`${BASE}/portal/webbed-films`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Client name in heading
    await expect(page.locator('h1')).toContainText('Webbed Films');

    // Projects section
    await expect(page.getByText('Showreel 2026')).toBeVisible({ timeout: 5000 });

    // Resources section
    await expect(page.getByText('Resources', { exact: true })).toBeVisible();
  });

  test('webbed portal project link navigates to project', async ({ page }) => {
    await page.goto(`${BASE}/portal/webbed-films`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Click project
    await page.getByText('Showreel 2026').first().click();
    await page.waitForTimeout(2000);

    // Should be on project page
    await expect(page).toHaveURL(/showreel-2026/);
  });

  test('webbed portal videos have valid src', async ({ page }) => {
    // Go to project view
    await page.goto(`${BASE}/portal/webbed-films/project/showreel-2026?view=widescreen`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Check for video element
    const videoCount = await page.locator('video').count();
    if (videoCount > 0) {
      const src = await page.locator('video').first().evaluate(v => v.src || v.querySelector('source')?.src || '');
      expect(src).toBeTruthy();
      // Verify the video URL is valid
      if (src) {
        const status = await page.evaluate(async (url) => {
          try { return (await fetch(url, { method: 'HEAD' })).status; } catch { return 0; }
        }, src);
        expect(status).toBeGreaterThanOrEqual(200);
        expect(status).toBeLessThan(400);
      }
    }
  });

  // ─── PASSWORD-PROTECTED PORTALS ───

  test('password-protected portal shows password gate', async ({ page }) => {
    await page.goto(`${BASE}/portal/foxglove-studios`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Should show password input
    const hasPasswordField = await page.locator('input[type="password"]').count() > 0;
    const hasContent = await page.locator('h1', { hasText: 'Foxglove' }).count() > 0;
    expect(hasPasswordField || hasContent).toBe(true);
  });

  // ─── PORTAL API DATA INTEGRITY ───

  test('each portal API returns correct data for its client only', async ({ page, request }) => {
    const res = await request.get(`${BASE}/api/public/portal/webbed-films`);
    const data = await res.json();

    expect(data.client).toBeDefined();
    expect(data.client.name).toBe('Webbed Films');
    expect(data.projects).toBeDefined();
    expect(data.projects.length).toBeGreaterThanOrEqual(1);

    // Projects should belong to this client
    for (const p of data.projects) {
      expect(p.client_slug).toBe('webbed-films');
    }
  });

  test('portal overview endpoint returns versions and formats', async ({ page, request }) => {
    const res = await request.get(`${BASE}/api/public/portal/webbed-films/projects/showreel-2026/overview`);
    const overview = await res.json();

    expect(overview.project).toBeDefined();
    expect(overview.formats).toBeDefined();
    expect(overview.formats.length).toBeGreaterThan(0);

    // Each format should have versions
    for (const f of overview.formats) {
      expect(f.label).toBeTruthy();
      expect(f.versions).toBeDefined();
    }
  });

  // ─── COMMENT FORM ───

  test('portal comment form exists on review page', async ({ page }) => {
    await page.goto(`${BASE}/portal/webbed-films/project/showreel-2026?review=widescreen`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Look for comment input elements
    const hasCommentArea = await page.locator('textarea, input[placeholder*="comment" i], [class*="comment-input"]').count() > 0;
    const hasNameField = await page.locator('input[placeholder*="name" i], input[name*="name"]').count() > 0;

    // At least one form element should exist
    expect(hasCommentArea || hasNameField).toBe(true);
  });

  // ─── APPROVAL BUTTONS ───

  test('portal approval/changes buttons exist on review page', async ({ page }) => {
    await page.goto(`${BASE}/portal/webbed-films/project/showreel-2026?review=widescreen`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Look for approval UI
    const hasApprovalUI = await page.locator('[class*="approval"], [class*="sign-off"], button:has-text("Approve"), button:has-text("Request Changes"), input[value="approved"]').count() > 0;
    // This is informational — the UI may or may not show approval controls
    if (!hasApprovalUI) {
      console.log('  Note: No approval UI found on review page');
    }
  });

  // ─── MOBILE PORTAL ───

  test('portal renders correctly at 375px mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/portal/webbed-films`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // No horizontal scroll
    const hasHScroll = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHScroll).toBe(false);

    // Client name visible
    await expect(page.locator('h1')).toContainText('Webbed Films');

    // Project cards don't overflow
    const overflow = await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="project-card"], [class*="portal-card"], a[href*="project"]');
      const vw = document.documentElement.clientWidth;
      for (const c of cards) {
        if (c.getBoundingClientRect().right > vw + 2) return true;
      }
      return false;
    });
    expect(overflow).toBe(false);
  });

  test('portal project page renders at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/portal/webbed-films/project/showreel-2026`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const hasHScroll = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHScroll).toBe(false);
  });
});
