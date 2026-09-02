/** A named structural Back target must also perform that transition (UI-64). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'

test('a direct detail Back falls through to the section root when no history entry exists', () => {
  const source = stripComments(read(join(ROOT, 'src', 'components', 'SectionPane.tsx')))
  const start = source.indexOf('const onBack = () => {')
  const end = source.indexOf('\n  const top =', start)
  assert.ok(start >= 0 && end > start, 'the one SectionPane Back funnel is present')
  const onBack = source.slice(start, end)

  assert.match(onBack, /if \(backOut\) backOut\.go\(\)/, 'carried pane history wins when it exists')
  assert.match(onBack, /else setFocus\(NO_FOCUS\)/, 'a direct deep link clears detail focus to its structural section root')
  assert.match(onBack, /setFocus\(stack\[stack\.length - 1\] \?\? NO_FOCUS\)/, 'local pane history still restores its exact prior focus')
})
