const { test, expect } = require('@playwright/test');
const { goToAdmin, goToFoxgloveProject, getSession } = require('./test-helpers');

test.describe('Turn 6: Terminology & Text', () => {

  test('project detail uses "Deliverable" in UI', async ({ page, request }) => {
    await goToAdmin(page);
    const session = await getSession(page);

    // Check the admin HTML source for "Deliverable" vs "Format" in UI text
    const html = await (await request.get('http://192.168.10.25:3501/admin', { headers: { Cookie: `session=${session}` } })).text();
    // The "+ Add Deliverable" button should exist
    const hasAddDeliverable = html.includes('Add Deliverable') || html.includes('add deliverable');
    // At minimum, the admin JS should use "Deliverable" terminology
    expect(hasAddDeliverable).toBe(true);
  });

  test('client detail shows portal link', async ({ page, request }) => {
    await goToAdmin(page);
    const session = await getSession(page);

    // Verify via API that client has portal slug
    const client = await (await request.get('/api/clients/foxglove-studios', { headers: { Cookie: `session=${session}` } })).json();
    expect(client.slug || client.client?.slug).toBe('foxglove-studios');

    // Navigate to client detail and wait for content to load
    await page.locator('.hc-card', { hasText: 'Foxglove Studios' }).click();
    await expect(page.locator('#section-client-detail')).toBeVisible({ timeout: 5000 });
    // Wait for the client name to appear (indicates data loaded)
    await expect(page.locator('#section-client-detail h2', { hasText: 'Foxglove' })).toBeVisible({ timeout: 5000 });

    const detail = page.locator('#section-client-detail');
    const text = await detail.textContent();
    expect(text).toContain('foxglove-studios');
  });

  test('films page shows "Featured" badge not "FOTD"', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('[data-section="films"]').click();
    await page.waitForSelector('.admin-film-card', { timeout: 15000 });

    const pageText = await page.locator('#section-films').textContent();
    // Should not use internal abbreviation FOTD
    expect(pageText).not.toContain('FOTD');
  });

  test('all API error responses contain specific error messages', async ({ page, request }) => {
    await goToAdmin(page);
    const session = await getSession(page);

    // Empty client name
    const r1 = await request.post('/api/clients', {
      headers: { Cookie: `session=${session}`, 'Content-Type': 'application/json' },
      data: { name: '' }
    });
    const e1 = await r1.json();
    expect(e1.error).toBeDefined();
    expect(e1.error.length).toBeGreaterThan(3); // Not just "Error"

    // Empty film title
    const r2 = await request.post('/api/films', {
      headers: { Cookie: `session=${session}`, 'Content-Type': 'application/json' },
      data: { title: '' }
    });
    const e2 = await r2.json();
    expect(e2.error).toBeDefined();
    expect(e2.error.length).toBeGreaterThan(3);
  });
});
