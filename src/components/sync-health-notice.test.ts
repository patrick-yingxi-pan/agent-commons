/** Structural lock for the global half of SYNC-10. Browser E2E proves the
 * actual error → notice → validated-recovery walk. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, stripComments, ROOT } from '../../tests/helpers/source.ts'

test('the workspace renders one API-driven, accessible sync notice', () => {
  const app = stripComments(read(join(ROOT, 'src', 'App.tsx')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'SyncHealthNotice.tsx')))
  assert.equal((app.match(/<SyncHealthNotice\s*\/>/g) ?? []).length, 1, 'one global notice, not one per pane')
  assert.match(notice, /useAmbientSyncHealth\(\)/, 'the component reads the API state funnel')
  assert.match(notice, /role="status"/)
  assert.match(notice, /aria-live="polite"/)
  assert.doesNotMatch(`${app}\n${notice}`, /navigator\.onLine/, 'link state is not server continuity')
})
