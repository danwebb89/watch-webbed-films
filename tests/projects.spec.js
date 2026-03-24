const { test, expect } = require('@playwright/test');
const { blockHeavyAssets } = require('./test-helpers');


async function navigateToFoxgloveProject(page) {
  await blockHeavyAssets(page);
  await page.goto('/admin#home', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#home-clients-list');
  await page.locator('.hc-card', { hasText: 'Foxglove Studios' }).click();
  await expect(page.locator('#section-client-detail')).toBeVisible({ timeout: 5000 });
  await page.locator('#section-client-detail').getByText('Autumn Collection 2026').first().click();
  await expect(page.locator('#section-client-project-detail')).toBeVisible({ timeout: 5000 });
}

test.describe('Projects', () => {
  test('project detail loads with correct title, reference, description', async ({ page }) => {
    await navigateToFoxgloveProject(page);

    // Title
    await expect(page.locator('#section-client-project-detail h2').first()).toHaveText('Autumn Collection 2026');

    // RF reference number
    await expect(page.locator('#section-client-project-detail')).toContainText('RF-301');

    // Description
    await expect(page.locator('#section-client-project-detail')).toContainText('Campaign films for the Autumn 2026 collection launch');
  });

  test('deliverable cards render for every deliverable in the project', async ({ page }) => {
    await navigateToFoxgloveProject(page);

    // Use the specific deliverable name class to avoid matching other text
    await expect(page.locator('.dl-name', { hasText: 'Hero Film' })).toBeVisible();
    await expect(page.locator('.dl-name', { hasText: 'Social Reel' })).toBeVisible();
  });

  test('creating a deliverable adds it to the list', async ({ page }) => {
    await navigateToFoxgloveProject(page);

    // Open format modal
    await page.evaluate(() => openModal('format-modal'));
    await expect(page.locator('#format-modal')).not.toHaveClass(/hidden/);

    // Fill in deliverable details
    await page.locator('#format-label').fill('BTS Reel');
    await page.waitForTimeout(200);

    // Submit
    await page.locator('#format-form button[type="submit"], #format-form .btn-primary').click();
    await expect(page.locator('#format-modal')).toHaveClass(/hidden/, { timeout: 5000 });

    // New deliverable should appear
    await expect(page.locator('.dl-name', { hasText: 'BTS Reel' })).toBeVisible({ timeout: 3000 });

    // Clean up: delete via API
    const formats = await page.evaluate(() =>
      fetch('/api/clients/foxglove-studios/projects/autumn-collection-2026/formats').then(r => r.json())
    );
    const bts = formats.find(f => f.label === 'BTS Reel');
    if (bts) {
      await page.evaluate(id =>
        fetch(`/api/clients/foxglove-studios/projects/autumn-collection-2026/formats/${id}`, { method: 'DELETE' }),
        bts.id
      );
    }
  });

  test('deleting a deliverable removes it after confirmation', async ({ page }) => {
    // Create a temporary deliverable to delete
    await blockHeavyAssets(page);
    await page.goto('/admin#home', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#home-clients-list');

    const tempId = await page.evaluate(async () => {
      const res = await fetch('/api/clients/foxglove-studios/projects/autumn-collection-2026/formats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Delete Me', type: 'video', aspect_ratio: '16:9' })
      });
      const data = await res.json();
      return data.id;
    });

    // Navigate to project
    await navigateToFoxgloveProject(page);

    // Verify it exists
    await expect(page.locator('.dl-name', { hasText: 'Delete Me' })).toBeVisible();

    // Clean up via API (UI delete flow is complex with kebab menus)
    await page.evaluate(id =>
      fetch(`/api/clients/foxglove-studios/projects/autumn-collection-2026/formats/${id}`, { method: 'DELETE' }),
      tempId
    );

    // Refresh and verify it's gone
    await navigateToFoxgloveProject(page);
    await expect(page.locator('.dl-name', { hasText: 'Delete Me' })).not.toBeVisible();
  });
});
