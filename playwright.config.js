import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 3030);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node dev-server.js`,
    env: {
      PORT: String(PORT),
      DEMO_MODE: process.env.PLAYWRIGHT_SUPABASE_MODE ? 'false' : 'true',
      RATE_LIMIT_PER_MIN: '10000',
      // Pass through Supabase env vars if testing against live backend
      ...(process.env.PLAYWRIGHT_SUPABASE_MODE ? {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
        SUPABASE_REPORTS_TABLE: process.env.SUPABASE_REPORTS_TABLE,
      } : {}),
    },
    url: `http://127.0.0.1:${PORT}/api/config`,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
