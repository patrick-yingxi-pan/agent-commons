/** Owned verification stacks do not need development file watching.
 *
 *  Playwright and the UI sweep each boot an immutable stack for one run. Letting
 *  the backend recursively watch the repository in every owned stack exhausted
 *  the host's file-descriptor limit before Chromium could start. The ordinary
 *  `npm run dev` path keeps hot reload; only explicit harness opt-outs disable
 *  the backend watcher. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read as readAbs } from './helpers/source.ts'

const read = (path: string) => readAbs(join(ROOT, path))

test('owned browser stacks disable backend watching while normal development keeps it', () => {
  const launcher = read('scripts/dev.mjs')
  const playwright = read('playwright.config.ts')
  const sweep = read('scripts/ui-sweep.mjs')

  assert.match(
    launcher,
    /process\.env\.SERVER_WATCH === 'off'/,
    'the shared launcher exposes an explicit no-watch seam',
  )
  assert.match(launcher, /\['--watch', 'server\/index\.ts'\]/, 'normal development still watches the backend')
  assert.match(playwright, /SERVER_WATCH: 'off'/, 'Playwright owns a stable, non-watching backend')
  assert.match(sweep, /SERVER_WATCH: 'off'/, 'the UI sweep owns a stable, non-watching backend')
})
