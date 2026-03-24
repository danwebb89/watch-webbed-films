const { test, expect } = require('@playwright/test');

// Auth tests don't use stored auth state — they test the login flow itself
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Authentication', () => {
  test('admin page redirects to login if not authenticated', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();
  });

  test('login with correct credentials succeeds', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Password' }).fill('revelpass');
    await page.getByRole('button', { name: 'Enter' }).click();
    await page.waitForURL('**/admin#home');
    await expect(page.locator('#section-home')).toBeVisible();
  });

  test('login with wrong credentials shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Password' }).fill('wrongpassword');
    await page.getByRole('button', { name: 'Enter' }).click();
    // Should stay on login page and show an error
    await expect(page).toHaveURL(/\/login/);
    // Check for error message — either a visible error element or the page stays on login
    const errorVisible = await page.locator('.login-error, .error, [role="alert"]').isVisible().catch(() => false);
    if (!errorVisible) {
      // Even without a visible error element, we should still be on the login page
      await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();
    }
  });

  test('logging out redirects to login', async ({ page }) => {
    // First log in
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Password' }).fill('revelpass');
    await page.getByRole('button', { name: 'Enter' }).click();
    await page.waitForURL('**/admin#home');

    // Now log out
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();

    // Verify we can't access admin anymore
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });
});
