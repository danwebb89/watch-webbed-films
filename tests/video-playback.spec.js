const { test, expect } = require('@playwright/test');
const { blockHeavyAssets } = require('./test-helpers');


test.describe('Video Playback', () => {
  test.beforeEach(async ({ page }) => {
    await blockHeavyAssets(page);
    await page.goto('/admin#home', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#home-clients-list');
  });

  test('film videos — report all with status', async ({ page }) => {
    const films = await page.evaluate(() =>
      fetch('/api/films').then(r => r.json())
    );

    const results = { ok: [], missing: [], error: [] };
    for (const film of films) {
      if (!film.video) {
        results.missing.push(`${film.title}: no video path set`);
        continue;
      }

      const status = await page.evaluate(async (videoPath) => {
        try {
          const res = await fetch(videoPath, { method: 'HEAD' });
          return res.status;
        } catch (e) {
          return e.message;
        }
      }, film.video);

      if (status === 200 || status === 206) {
        results.ok.push(film.title);
      } else {
        results.error.push(`${film.title}: ${film.video} → ${status}`);
      }
    }

    console.log(`\nFilm video check: ${results.ok.length} OK, ${results.error.length} broken, ${results.missing.length} no path`);
    if (results.error.length > 0) {
      console.log('Broken film videos:');
      results.error.forEach(e => console.log(`  ✗ ${e}`));
    }

    // At least some films should have working videos
    expect(results.ok.length, 'No film videos loaded at all').toBeGreaterThan(0);
  });

  test('deliverable version videos — report all with status', async ({ page }) => {
    const clients = await page.evaluate(() =>
      fetch('/api/clients').then(r => r.json())
    );

    const results = { ok: [], missing: [], error: [] };

    for (const client of clients) {
      const projects = await page.evaluate(slug =>
        fetch(`/api/clients/${slug}/projects`).then(r => r.json()),
        client.slug
      );

      for (const project of projects) {
        const formats = await page.evaluate(([cs, ps]) =>
          fetch(`/api/clients/${cs}/projects/${ps}/formats`).then(r => r.json()),
          [client.slug, project.slug]
        );

        for (const format of formats) {
          const versions = await page.evaluate(([cs, ps, fid]) =>
            fetch(`/api/clients/${cs}/projects/${ps}/formats/${fid}/versions`).then(r => r.json()),
            [client.slug, project.slug, format.id]
          );

          for (const version of versions) {
            const label = `${client.name} > ${project.title} > ${format.label} v${version.version_number}`;

            if (!version.file_path) {
              results.missing.push(label);
              continue;
            }

            const status = await page.evaluate(async (path) => {
              try {
                const res = await fetch(path, { method: 'HEAD' });
                return res.status;
              } catch (e) {
                return e.message;
              }
            }, version.file_path);

            if (status === 200 || status === 206) {
              results.ok.push({ label, aspect: format.aspect_ratio });
            } else {
              results.error.push(`${label}: ${version.file_path} → ${status}`);
            }
          }
        }
      }
    }

    console.log(`\nDeliverable video check: ${results.ok.length} OK, ${results.error.length} broken, ${results.missing.length} no path`);

    const aspects = {};
    results.ok.forEach(r => { aspects[r.aspect] = (aspects[r.aspect] || 0) + 1; });
    console.log('Aspect ratio coverage:', JSON.stringify(aspects));

    if (results.error.length > 0) {
      console.log('Broken deliverable videos:');
      results.error.forEach(e => console.log(`  ✗ ${e}`));
    }

    // All deliverable versions should have working videos (these are actively managed)
    expect(results.error, `${results.error.length} deliverable videos broken:\n${results.error.join('\n')}`).toHaveLength(0);
  });

  test('video elements render on watch pages without errors', async ({ page }) => {
    // Get films that have working video files
    const films = await page.evaluate(() =>
      fetch('/api/films').then(r => r.json())
    );

    // Test a small sample of public films
    const publicFilms = films.filter(f => f.video && f.visibility === 'public');
    const sample = publicFilms.slice(0, 5);

    const errors = [];
    for (const film of sample) {
      // First check if video file exists
      const headStatus = await page.evaluate(async (v) => {
        try { return (await fetch(v, { method: 'HEAD' })).status; } catch { return 0; }
      }, film.video);

      if (headStatus !== 200 && headStatus !== 206) continue; // Skip films with missing files

      await page.goto(`/watch/${film.slug}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);

      const hasVideo = await page.locator('video').count() > 0;
      if (!hasVideo) {
        errors.push(`${film.title}: no <video> element on watch page`);
        continue;
      }

      const videoError = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return 'no video element';
        if (v.error) return `MediaError code ${v.error.code}: ${v.error.message}`;
        return null;
      });

      if (videoError) {
        errors.push(`${film.title}: ${videoError}`);
      }
    }

    if (errors.length > 0) {
      console.log('Video element errors:');
      errors.forEach(e => console.log(`  ✗ ${e}`));
    }
    expect(errors).toHaveLength(0);
  });
});
