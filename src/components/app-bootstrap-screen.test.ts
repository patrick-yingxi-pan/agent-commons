/** Structural half of ADAPT-26. Browser E2E proves the held-load, failure, and
 * retry walk against the real query cache. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, stripComments, ROOT } from '../../tests/helpers/source.ts'

test('App routes unresolved bootstrap through one accessible shared surface', () => {
  const app = stripComments(read(join(ROOT, 'src', 'App.tsx')))
  const screen = stripComments(read(join(ROOT, 'src', 'components', 'AppBootstrapScreen.tsx')))

  assert.match(app, /resolveAppBootstrap\(/, 'the shell uses the explicit bootstrap policy')
  assert.match(
    app,
    /resolveAppBootstrap\(\s*capabilities\.data,\s*identity\.data,/,
    'the barrier reads the cache directly; reset means earn a fresh pair',
  )
  assert.doesNotMatch(app, /lastCaps|lastMe|BootstrapSnapshot/, 'identity never survives a deliberate cache reset in an ad-hoc ref')
  assert.equal((app.match(/<AppBootstrapScreen\b/g) ?? []).length, 1, 'one pre-application surface')
  assert.doesNotMatch(app, /if \(!cap \|\| !ident\) return null/, 'a failed or slow first load is never blank')
  assert.match(screen, /role="status"/)
  assert.match(screen, /aria-live="polite"/)
  assert.match(screen, /role="alert"/)
  assert.match(screen, /<Spinner\b/, 'loading uses the shared motion-safe spinner')
  assert.match(screen, /SOLID_BUTTON_CLASS/, 'the one recovery action uses the shared CTA face')
})
