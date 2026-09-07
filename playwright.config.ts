import { defineConfig, devices } from '@playwright/test'
import { availableParallelism } from 'node:os'
import { budget, resolvedFactor } from './scripts/hostSpeed.mjs'

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
/** Shard isolation. `npm run verify` runs several playwright processes at once,
 *  each over its own slice of the spec files, and each needs a stack of its
 *  OWN: sharing a UI port would make them fight, and sharing DATA_FILE or the
 *  mock model would make them corrupt each other. Every one of these is already
 *  an env seam the server reads, so isolation is arithmetic on the shard index
 *  rather than new machinery.
 *
 *  `E2E_SHARD` unset ⇒ 0 ⇒ exactly the ports and store this config always used,
 *  so a bare `npm run e2e` is unchanged. */
const SHARD = Number(process.env.E2E_SHARD ?? 0)

/** How slow this machine is relative to the box every timing in
 *  scripts/verify.mjs's header was measured on, and how many shards are
 *  competing for it. `E2E_SHARDS` is what the runner actually launched; a
 *  direct `npx playwright test` is one lane, so it gets the unscaled budget. */
const HOST_FACTOR = resolvedFactor()
const SHARD_TOTAL = Number(process.env.E2E_SHARDS ?? 1) || 1
/** UI port; the mock backend takes PORT+1 (dev.mjs's rule), so shards step by 10. */
const UI_PORT = 5183 + SHARD * 10
/** The mock MODEL server, one per shard.
 *
 *  Deliberately NOT `8788 + SHARD`, which is what this was: 8788 is the default
 *  a developer's `npm run dev` already holds, so shard 0 found it in use, stood
 *  its own mock down and dialled the dev stack's — logging ":8788 in use —
 *  assuming an external model server is up" on every run. That made the E2E
 *  depend on a process it does not own: stop or restart `npm run dev` mid-sweep
 *  and shard 0's generation specs fail on a dead connection. The whole point of
 *  pinning this seam (see ANTHROPIC_BASE_URL below) is that the model the specs
 *  talk to is theirs. 8830 is clear of both the dev default and dev.mjs's
 *  PORT+1 backend rule. */
const MODEL_PORT = 8830 + SHARD
const STORE = SHARD === 0 ? '.data/e2e-store.json' : `.data/e2e-store-${SHARD}.json`

export default defineConfig({
  testDir: './e2e',
  // Each Playwright process also owns its artifact scratch space. Sharing the
  // root lets a sibling worker delete live trace resources during cleanup.
  outputDir: `test-results/shard-${SHARD}`,
  // Reference milliseconds, scaled to this host and to the contention the sweep
  // creates by running SHARDS stacks at once. A flat 30s is a claim about one
  // machine; these numbers have to hold on a Mac, on a laptop throttling, and
  // alongside two sibling shards. See scripts/hostSpeed.mjs.
  timeout: budget(30_000, HOST_FACTOR, SHARD_TOTAL),
  expect: { timeout: budget(8_000, HOST_FACTOR, SHARD_TOTAL) },
  fullyParallel: false,
  workers: 1, // the mock backend is a single shared store — serialize
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    // The E2E stack's OWN ports (UI 5183, backend 5184 via dev.mjs's PORT+1 rule) —
    // never 5173, so a developer's running `npm run dev` (mock backend, live store)
    // can't be silently reused in the wrong mode / against the wrong store.
    baseURL: `http://127.0.0.1:${UI_PORT}`,
    // Local runs have no automatic retry. Opt into first-failure evidence when
    // diagnosing an intermittent full-suite failure, without changing the gate.
    trace: process.env.E2E_TRACE === '1' ? 'retain-on-failure' : 'on-first-retry',
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
    url: `http://127.0.0.1:${UI_PORT}`,
    // Always boot our own stack: an "existing server" can't be trusted to carry this
    // config's BACKEND/DATA_FILE env (that's exactly how a run once polluted the dev
    // store). The dedicated ports make the fresh boot conflict-free.
    reuseExistingServer: false,
    timeout: budget(120_000, HOST_FACTOR, SHARD_TOTAL),
    env: {
      PORT: String(UI_PORT),
      DATA_FILE: STORE,
      BACKEND: 'remote',
      // Pin the model seam to the in-process mock: an ambient ANTHROPIC_BASE_URL in the
      // invoking shell (e.g. a coding agent's harness exports api.anthropic.com) would
      // otherwise stand the mock down and dial a real API — E2E must be deterministic.
      MODEL_PORT: String(MODEL_PORT),
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${MODEL_PORT}`,
      // The desktop-provider browser lane injects the renderer's narrow vault
      // face. Its fixed generated reference also has to resolve in this
      // browser-owned backend; packaged smoke exercises the real IPC handoff.
      [`PROVIDER_DESKTOP_${'F'.repeat(32)}`]: 'e2e-device-provider-key',
      // A real boot defaults the AUTH GATE ON (server/index.ts). The E2E stack
      // opts out: its specs impersonate tenants via the dev header seam and
      // drive the sign-in flow explicitly where they test it; the gate's WALL
      // (401s + the anonymous principal) is locked by tests/auth-gate.test.ts.
      AUTH_GATE: 'off',
      // This stack is immutable for the run. Avoid one recursive backend watcher
      // per shard: they add no reload value here and can exhaust host file handles.
      SERVER_WATCH: 'off',
      // The maintainer console (FWD-7): Ada is the allowlisted maintainer so
      // e2e/admin.spec.ts can drive the grant-gated Maintain section. The grant
      // lands only on VERIFIED resolutions, so the default (headerless) boot
      // still shows no console — exactly what the spec asserts.
      MAINTAINERS: 'user-ada',
    },
  },
})
