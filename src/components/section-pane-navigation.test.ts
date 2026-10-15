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

test('Agent request detail navigation is a canonical pane focus with Requests as its return surface', () => {
  const pane = stripComments(read(join(ROOT, 'src', 'components', 'SectionPane.tsx')))
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  assert.match(pane, /initialSub \?\? \(initialFocus\?\.agentRequestId \? 'requests' : null\)/)
  assert.match(pane, /focusRequestId=\{focus\.agentRequestId\}/)
  assert.match(pane, /onOpenRequest=\{\(id\) =>[\s\S]*?navigate\(\{ agentRequestId: id \}\)/)
  assert.match(view, /focusRequestId \|\| subview === 'requests'[\s\S]*?<AgentRequestsPage requestId=\{focusRequestId\}/)
  assert.match(view, /<AgentRequestsSummary onOpenRequest=\{onOpenRequest\}/)
})
