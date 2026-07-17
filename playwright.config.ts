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
 *  operate on the project they just created, so re-runs don't collide.
 *
 *  Backend mode: the stack boots with `BACKEND=remote` — the web deployment, where
 *  identity is the F2 header seam (`x-user-id` / `x-tenant-id`) — so the E2E can
 *  impersonate DIFFERENT tenants per browser context (`extraHTTPHeaders`) and lock
 *  multi-tenancy through the rendered UI (e2e/co-author-article.spec.ts). Requests
 *  without headers resolve to the seeded default (Ada / tenant-acme), so single-actor
 *  specs are unaffected; native-only ops 409 by design and no spec relies on them. */
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
    // The E2E stack's OWN ports (UI 5183, backend 5184 via dev.mjs's PORT+1 rule) —
    // never 5173, so a developer's running `npm run dev` (mock backend, live store)
    // can't be silently reused in the wrong mode / against the wrong store.
    baseURL: 'http://127.0.0.1:5183',
    trace: 'on-first-retry',
    // Grant clipboard write so a Copy affordance's write actually SUCCEEDS in
    // headless Chromium (an unfocused headless window otherwise rejects
    // writeText) — CopyButton now honestly shows "Copy failed" on a real
    // rejection, so the "Copied" confirmation the specs assert needs a working
    // clipboard, exactly as a real focused browser provides.
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Wipe the E2E store FIRST, then boot — a clean slate per run (see
    // e2e/wipe-store.mjs for why this can't be globalSetup).
    command: 'node e2e/wipe-store.mjs && npm run dev',
    url: 'http://127.0.0.1:5183',
    // Always boot our own stack: an "existing server" can't be trusted to carry this
    // config's BACKEND/DATA_FILE env (that's exactly how a run once polluted the dev
    // store). The dedicated ports make the fresh boot conflict-free.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: '5183',
      DATA_FILE: '.data/e2e-store.json',
      BACKEND: 'remote',
      // Pin the model seam to the in-process mock: an ambient ANTHROPIC_BASE_URL in the
      // invoking shell (e.g. a coding agent's harness exports api.anthropic.com) would
      // otherwise stand the mock down and dial a real API — E2E must be deterministic.
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8788',
      // A real boot defaults the AUTH GATE ON (server/index.ts). The E2E stack
      // opts out: its specs impersonate tenants via the dev header seam and
      // drive the sign-in flow explicitly where they test it; the gate's WALL
      // (401s + the anonymous principal) is locked by tests/auth-gate.test.ts.
      AUTH_GATE: 'off',
    },
  },
})
