/** Section pages are a real on-demand feature boundary: a conversation boot
 * must not eagerly evaluate the 14k-line all-sections surface. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'

test('MainSplit lazy-loads SectionPane behind accessible in-pane loading and failure states', () => {
  const source = stripComments(read(join(ROOT, 'src', 'components', 'MainSplit.tsx')))
  assert.doesNotMatch(source, /import\s+\{\s*SectionPane\s*\}\s+from/, 'SectionPane must stay out of the boot graph')
  assert.match(source, /lazy\(\(\)\s*=>\s*import\('\.\/SectionPane'\)/, 'the section surface has one dynamic import boundary')
  assert.match(source, /<Suspense\s+fallback=\{<SectionLoadingState\b/, 'the lazy pane cannot blank while its chunk loads')
  assert.match(source, /role="status"/, 'the loading state is announced to assistive technology')
  assert.match(source, /data-section-loading/, 'browser checks have a stable loading-state seam')
  assert.match(source, /getDerivedStateFromError/, 'a rejected section chunk cannot crash the workspace')
  assert.match(source, /role="alert"/, 'the failed state is announced to assistive technology')
  assert.match(source, /data-section-load-error/, 'browser checks have a stable failed-state seam')
  assert.match(source, /window\.location\.reload\(\)/, 'retry reloads the document so a stale deployment gets fresh asset URLs')
})
