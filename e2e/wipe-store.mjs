// Reset the E2E store so every `npm run e2e` starts from the seeds. Runs as the
// FIRST step of playwright.config.ts's webServer command — NOT as globalSetup,
// which Playwright runs AFTER the webServer boots: the server would already hold
// the old store in memory and persist it right back over the wipe. Specs still
// STAMP their entity names (the store is shared WITHIN a run); this only stops
// state accumulating ACROSS runs (strict-mode locator collisions).
//
// The path comes from DATA_FILE, which the webServer sets per SHARD — wiping a
// hard-coded '.data/e2e-store.json' from shard 2 would erase shard 0's store
// mid-run, which is the one way a sharded suite can corrupt itself.
import { rmSync } from 'node:fs'

rmSync(process.env.DATA_FILE ?? '.data/e2e-store.json', { force: true })
