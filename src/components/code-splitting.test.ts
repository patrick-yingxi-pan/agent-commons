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

test('tool activity UI loads only for transcripts that contain tool activity', () => {
  const message = stripComments(read(join(ROOT, 'src', 'components', 'Message.tsx')))
  const source = stripComments(read(join(ROOT, 'src', 'components', 'DeferredToolActivityCard.tsx')))
  assert.doesNotMatch(message, /import\s+\{\s*ToolActivityCard\s*\}\s+from/,
    'tool activity must stay out of the cold conversation graph')
  assert.match(source, /lazy\(\(\)\s*=>\s*import\('\.\/ToolActivityCard\.tsx'\)/,
    'the conditional tool surface owns a dynamic import boundary')
  assert.match(message, /message\.toolActivities && message\.toolActivities\.length > 0[\s\S]*<DeferredToolActivityCard/,
    'ordinary transcript rows do not request the tool UI')
  assert.match(source, /role="status"[\s\S]*data-tool-activity-loading/,
    'a tool transcript retains an announced loading face while its UI arrives')
  assert.match(source, /getDerivedStateFromError[\s\S]*data-tool-activity-load-error[\s\S]*window\.location\.reload\(\)/,
    'a rejected tool chunk retains honest consent copy and an explicit retry')
  assert.doesNotMatch(source, /Nothing was approved/,
    'a display failure cannot claim that historical or already-running activity was never approved')
})
