const { expect } = require('@playwright/test');

/**
 * Block thumbnail/video loads to prevent the admin page from hanging.
 * Must be called before page.goto().
 */
async function blockHeavyAssets(page) {
  // No-op: imagesEnabled=false in playwright.config.js handles this globally.
  // Route-based blocking causes page.evaluate() to hang because the admin JS
  // waits for thumbnail fetches that never complete.
}

/**
 * Open a modal by class manipulation.
 */
async function openModal(page, id) {
  await page.locator(`#${id}`).evaluate(el => el.classList.remove('hidden'));
  await page.waitForTimeout(100);
}

/**
 * Switch admin section.
 */
async function switchSection(page, name) {
  await page.evaluate(n => showSection(n), name);
  await page.waitForTimeout(300);
}

/**
 * Set a hidden input field value.
 */
async function setField(page, id, value) {
  await page.evaluate(([i, v]) => { document.getElementById(i).value = v; }, [id, value]);
}

/**
 * Reload the films list.
 */
async function callLoadFilms(page) {
  await page.evaluate(() => typeof loadFilms === 'function' && loadFilms());
  await page.waitForTimeout(500);
}

/**
 * Navigate to admin, blocking heavy assets first.
 */
async function goToAdmin(page) {
  await blockHeavyAssets(page);
  await page.goto('/admin', { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('.hc-card', { timeout: 15000 });
}

/**
 * Navigate to Foxglove > Autumn Collection project.
 */
async function goToFoxgloveProject(page) {
  await goToAdmin(page);
  await page.locator('.hc-card', { hasText: 'Foxglove Studios' }).click();
  await expect(page.locator('#section-client-detail')).toBeVisible({ timeout: 5000 });
  await page.locator('#section-client-detail').getByText('Autumn Collection 2026').first().click();
  await expect(page.locator('#section-client-project-detail')).toBeVisible({ timeout: 5000 });
}

/**
 * Get session cookie value.
 */
async function getSession(page) {
  const cookies = await page.context().cookies();
  return cookies.find(c => c.name === 'session')?.value || '';
}

module.exports = {
  blockHeavyAssets, openModal, switchSection, setField,
  callLoadFilms, goToAdmin, goToFoxgloveProject, getSession
};
