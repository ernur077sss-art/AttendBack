import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
    viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
