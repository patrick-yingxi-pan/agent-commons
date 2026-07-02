import { defineConfig, devices } from '@playwright/test'

/** End-to-end UI tests (P8 Phase 3 — the checked-in E2E harness).
 *
 *  Runs the REAL dev stack (Vite UI + mock backend + mock model, all booted by
 *  `npm run dev`) and drives the actual rendered UI through a headless Chromium —
 *  the one layer `node --test` can't exercise (it has no DOM). Complements, not
 *  replaces, the store/route suites: those lock the logic, these lock the wiring.
 *
 *  Store isolation: the webServer runs with `DATA_FILE` pointed at a gitignored
 *  E2E snapshot so a test that creates projects never pollutes the dev store. Tests
 *  operate on the project they just created, so re-runs don't collide. */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1, // the mock backend is a single shared store — serialize
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { DATA_FILE: '.data/e2e-store.json' },
  },
})
