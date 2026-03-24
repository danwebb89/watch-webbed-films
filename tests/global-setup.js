const { test, expect } = require('@playwright/test');

test('authenticate admin', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Password' }).fill('revelpass');
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForURL('**/admin#home');
  await expect(page.locator('#section-home')).toBeVisible();
  await page.context().storageState({ path: 'test-results/.auth/admin.json' });
});
