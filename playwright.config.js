import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30000,
  expect: { timeout: 7000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8765',
    viewport: { width: 1440, height: 1000 },
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10000,
  },
  webServer: {
    command: 'python scripts/e2e_server.py',
    url: 'http://127.0.0.1:8765/api/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
