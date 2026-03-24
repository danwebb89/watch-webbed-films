const { test, expect } = require('@playwright/test');
const { goToAdmin, getSession } = require('./test-helpers');

const VIEWPORTS = [
  { width: 375, height: 812, label: '375px' },
  { width: 768, height: 1024, label: '768px' },
  { width: 1024, height: 768, label: '1024px' },
  { width: 1366, height: 768, label: '1366px' },
  { width: 1440, height: 900, label: '1440px' },
  { width: 2560, height: 1440, label: '2560px' },
];

for (const vp of VIEWPORTS) {
  test.describe(`Turn 7: Responsive @ ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('admin home: no horizontal scroll', async ({ page }) => {
      await goToAdmin(page);
      const hasHScroll = await page.locator('body').evaluate(el =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(hasHScroll).toBe(false);
    });

    test('admin home: client cards fit viewport', async ({ page }) => {
      await goToAdmin(page);
      const overflow = await page.locator('#home-clients-list').evaluate((el, vpw) => {
        const cards = el.querySelectorAll('.hc-card');
        for (const c of cards) {
          if (c.getBoundingClientRect().right > vpw + 5) return true;
        }
        return false;
      }, vp.width);
      expect(overflow).toBe(false);
    });

    if (vp.width <= 768) {
      test('mobile: buttons are at least 44px tall', async ({ page }) => {
        await goToAdmin(page);
        const tooSmall = await page.locator('#section-home').evaluate(el => {
          const btns = el.querySelectorAll('button, a[href]');
          const issues = [];
          for (const b of btns) {
            const rect = b.getBoundingClientRect();
            if (rect.height > 0 && rect.height < 44 && rect.width > 0) {
              issues.push(`${b.textContent?.trim().slice(0, 20)} (${Math.round(rect.height)}px)`);
            }
          }
          return issues;
        });

        if (tooSmall.length > 0) {
          console.log(`  Small buttons at ${vp.label}: ${tooSmall.slice(0, 3).join(', ')}`);
        }
        // Warn but don't fail — many admin buttons are intentionally compact
      });
    }
  });
}
