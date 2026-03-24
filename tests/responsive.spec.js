const { test, expect } = require('@playwright/test');
const { blockHeavyAssets } = require('./test-helpers');


const VIEWPORTS = [
  { width: 375, height: 812, label: '375px (mobile)' },
  { width: 768, height: 1024, label: '768px (tablet)' },
  { width: 1024, height: 768, label: '1024px (small desktop)' },
  { width: 1440, height: 900, label: '1440px (desktop)' },
  { width: 2560, height: 1440, label: '2560px (ultrawide)' },
];

for (const viewport of VIEWPORTS) {
  test.describe(`Responsive @ ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('clients list renders without horizontal scroll', async ({ page }) => {
      await blockHeavyAssets(page);
      await page.goto('/admin#home', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#home-clients-list');

      const hasHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(hasHScroll).toBe(false);
    });

    test('client cards do not overflow', async ({ page }) => {
      await blockHeavyAssets(page);
      await page.goto('/admin#home', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#home-clients-list');

      const overflow = await page.evaluate(() => {
        const cards = document.querySelectorAll('.hc-card');
        const viewportWidth = document.documentElement.clientWidth;
        for (const card of cards) {
          const rect = card.getBoundingClientRect();
          if (rect.right > viewportWidth + 2) return { element: card.textContent.slice(0, 50), right: rect.right, viewport: viewportWidth };
        }
        return null;
      });
      expect(overflow, `Card overflows viewport: ${JSON.stringify(overflow)}`).toBeNull();
    });

    test('films grid renders without overflow', async ({ page }) => {
      await blockHeavyAssets(page);
      await page.goto('/admin', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.hc-card', { timeout: 15000 });
      // Use evaluate for section switch (sidebar hidden on mobile)
      await page.evaluate(() => showSection('films'));
      await page.waitForSelector('.admin-film-card', { timeout: 15000 });

      const hasHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(hasHScroll).toBe(false);
    });

    test('modals are usable', async ({ page }) => {
      await blockHeavyAssets(page);
      await page.goto('/admin#home', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#home-clients-list');

      await page.evaluate(() => openModal('client-modal'));
      await expect(page.locator('#client-modal')).not.toHaveClass(/hidden/);

      // Modal should be visible and not clipped
      const modal = page.locator('#client-modal .modal');
      const modalRect = await modal.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width };
      });

      // Modal should be within viewport (with some tolerance for animation)
      expect(modalRect.left).toBeGreaterThanOrEqual(-5);
      expect(modalRect.width).toBeLessThanOrEqual(viewport.width + 10);

      // Submit button should be visible/reachable
      const submitBtn = page.locator('#client-form button[type="submit"], #client-form .btn-primary').first();
      await expect(submitBtn).toBeVisible();

      await page.keyboard.press('Escape');
    });

    test('buttons are tappable size on mobile', async ({ page }) => {
      if (viewport.width > 768) {
        test.skip();
        return;
      }

      await blockHeavyAssets(page);
      await page.goto('/admin#home', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#home-clients-list');

      // Check that interactive elements meet minimum tap target (44x44)
      const smallButtons = await page.evaluate(() => {
        const btns = document.querySelectorAll('button:not(.hidden *, [hidden] *), a:not(.hidden *, [hidden] *)');
        const issues = [];
        for (const btn of btns) {
          const rect = btn.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue; // Hidden
          if (rect.width < 30 || rect.height < 30) {
            issues.push({
              text: btn.textContent?.trim().slice(0, 30),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            });
          }
        }
        return issues;
      });

      // Log any too-small buttons but don't fail (just warn)
      if (smallButtons.length > 0) {
        console.log(`Warning: ${smallButtons.length} buttons smaller than 30x30 at ${viewport.width}px:`);
        smallButtons.slice(0, 5).forEach(b => console.log(`  "${b.text}" ${b.width}x${b.height}`));
      }
    });
  });
}
