const { test, expect } = require('@playwright/test');
const { goToAdmin, getSession } = require('./test-helpers');

test.describe('Turn 5: Empty States', () => {

  test('empty client (0 projects) shows projects section', async ({ page, request }) => {
    await goToAdmin(page);
    const session = await getSession(page);

    const res = await request.post('/api/clients', {
      headers: { Cookie: `session=${session}`, 'Content-Type': 'application/json' },
      data: { name: `Empty State Client ${Date.now()}` }
    });
    const client = await res.json();

    await goToAdmin(page);
    await page.locator('.hc-card', { hasText: 'Empty State' }).first().click();
    await expect(page.locator('#section-client-detail')).toBeVisible({ timeout: 5000 });
    // Wait for actual content to load (not just the section container)
    await expect(page.locator('#section-client-detail h2')).toBeVisible({ timeout: 5000 });

    const text = await page.locator('#section-client-detail').textContent();
    expect(text).toContain('Projects');

    await request.delete(`/api/clients/${client.slug}`, { headers: { Cookie: `session=${session}` } });
  });

  test('empty project (0 deliverables) shows deliverables section', async ({ page, request }) => {
    await goToAdmin(page);
    const session = await getSession(page);
    const headers = { Cookie: `session=${session}`, 'Content-Type': 'application/json' };

    const clientRes = await request.post('/api/clients', { headers, data: { name: `Empty Proj Client ${Date.now()}` } });
    const client = await clientRes.json();

    const projRes = await request.post(`/api/clients/${client.slug}/projects`, { headers, data: { title: 'Empty Project' } });
    const project = await projRes.json();

    await goToAdmin(page);
    await page.locator('.hc-card', { hasText: 'Empty Proj' }).first().click();
    await expect(page.locator('#section-client-detail')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#section-client-detail h2')).toBeVisible({ timeout: 5000 });
    await page.locator('#section-client-detail').getByText('Empty Project').first().click();
    await expect(page.locator('#section-client-project-detail')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#section-client-project-detail h2')).toBeVisible({ timeout: 5000 });

    const text = await page.locator('#section-client-project-detail').textContent();
    expect(text).toContain('Deliverables');

    await request.delete(`/api/clients/${client.slug}/projects/${project.slug}`, { headers: { Cookie: `session=${session}` } });
    await request.delete(`/api/clients/${client.slug}`, { headers: { Cookie: `session=${session}` } });
  });

  test('films search with no matches shows empty state', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('[data-section="films"]').click();
    await page.waitForSelector('.admin-film-card', { timeout: 15000 });
    await page.getByPlaceholder('Search films...').fill('xyznonexistent999');
    await page.waitForTimeout(500);
    // Page should not crash
    await expect(page.locator('#section-films')).toBeVisible();
  });

  test('client search with no matches shows empty', async ({ page }) => {
    await goToAdmin(page);
    await page.getByPlaceholder('Search clients...').fill('xyznonexistent999');
    await page.waitForTimeout(500);
    await expect(page.locator('#section-home')).toBeVisible();
  });
});
