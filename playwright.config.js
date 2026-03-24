const { defineConfig } = require('@playwright/test');

const BASE_URL = 'http://192.168.10.25:3501';

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/html-report' }]],
  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
    actionTimeout: 10000,
    navigationTimeout: 15000,
    reducedMotion: 'reduce',
    launchOptions: {
      args: ['--blink-settings=imagesEnabled=false'],
    },
  },
  outputDir: 'test-results',
  projects: [
    {
      name: 'setup',
      testMatch: /global-setup\.js/,
    },
    {
      name: 'cleanup',
      testMatch: /cleanup\.js/,
      dependencies: ['setup'],
      use: {
        storageState: 'test-results/.auth/admin.json',
      },
    },
    {
      name: 'tests',
      dependencies: ['cleanup'],
      use: {
        storageState: 'test-results/.auth/admin.json',
      },
    },
  ],
});
