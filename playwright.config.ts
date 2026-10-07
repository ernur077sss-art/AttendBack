import { defineConfig } from '@playwright/test';
import path from 'node:path';
process.env.DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://attendback:attendback@127.0.0.1:54329/attendback_e2e_test';
process.env.APP_ORIGIN = 'http://127.0.0.1:3001';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:3001',
    headless: true,
    channel: 'chromium',
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${path.resolve('.local/camera.y4m')}`,
      ],
    },
    viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: './scripts/pnpmw exec node --import tsx scripts/e2e-server.ts',
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: './scripts/pnpmw recovery:start',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
  reporter: [['list'], ['html', { open: 'never' }]],
});
