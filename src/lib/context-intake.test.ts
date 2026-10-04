import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createContextIntakeGate } from './contextIntake.ts'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('context intake holds overlapping pickers until the final owner releases', () => {
  const gate = createContextIntakeGate()
  const states: boolean[] = []
  const unsubscribe = gate.subscribe(() => states.push(gate.getSnapshot('a')))
  assert.equal(gate.getSnapshot('a'), false)
  const first = gate.acquire('a')
  const second = gate.acquire('a')
  first()
  first()
  assert.equal(gate.getSnapshot('a'), true, 'closing one picker cannot release another')
  assert.equal(gate.getSnapshot('b'), false, 'off-focus pickers never cover another session')
  second()
  assert.equal(gate.getSnapshot('a'), false)
  assert.deepEqual(states, [true, false], 'only visible gate transitions notify')
  unsubscribe()
  const next = gate.acquire('a')
  next()
  assert.deepEqual(states, [true, false])
})

test('strict-mode cleanup and remount cannot leave an overlay permanently held', () => {
  const gate = createContextIntakeGate()
  const abandoned = gate.acquire('a')
  abandoned()
  const mounted = gate.acquire('a')
  abandoned()
  assert.equal(gate.getSnapshot('a'), true)
  mounted()
  assert.equal(gate.getSnapshot('a'), false)
})

test('all conversation intake hosts use the same session-scoped overlay gate', () => {
  const source = (file: string) => stripComments(read(join(ROOT, 'src', file)))
  assert.match(source('components/AddContextButton.tsx'), /useContextIntake\(sessionId, open\)/)
  for (const [file, session] of [['Composer', 'sessionId'], ['EmptyState', 'DRAFT_ID']]) {
    assert.match(source(`components/${file}.tsx`), new RegExp(`<AddContextButton\\s+sessionId=\\{${session}\\}`))
  }
  const app = source('App.tsx')
  assert.match(app, /useContextIntakeOpen\(focusedSessionId\)/)
  assert.match(app, /if \(!focusedSessionId \|\| \(tier === 'wide' && contextIntakeOpen\)\) return/)
  assert.match(app, /inert=\{tier !== 'wide' && !!focusedFocus && !contextIntakeOpen\}/)
  assert.match(app, /tier !== 'wide' && !contextIntakeOpen && \(\s*<OverlayPanelDock/)
})
