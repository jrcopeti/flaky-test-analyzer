// FIXTURE — deliberately misconfigured. Positive control for rule-catalog category F
// (plus E03). Paired with flaky-samples.spec.ts; the oracle is EXPECTED.md.

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  retries: 2,
  workers: 8,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: true,
  },
})
