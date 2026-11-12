import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import { createTooltipLifecycle } from './tooltipLifecycle.ts'

test('tooltip delay and repeated same-owner hover/focus keep one pending timer without hiding a visible bubble', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const lifecycle = createTooltipLifecycle()
  const owner = {}
  const events: string[] = []
  const open = () => lifecycle.open(owner, () => events.push('show'), () => events.push('hide'), 400)
  open()
  t.mock.timers.tick(399)
  assert.equal(events.length, 0)
  open()
  t.mock.timers.tick(399)
  assert.deepEqual(events, [], 'focus replaces the same hover timer, rather than leaking it')
  t.mock.timers.tick(1)
  assert.deepEqual(events, ['show'])
  open()
  assert.deepEqual(events, ['show'], 'same-owner focus does not flash an already visible bubble')
  t.mock.timers.tick(400)
  lifecycle.cancel(owner)
  assert.deepEqual(events, ['show', 'show', 'hide'])
})

test('a new tooltip cancels the prior pending timer; stale blur and unmount cannot cancel its replacement', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const lifecycle = createTooltipLifecycle()
  const first = {}, second = {}
  const events: string[] = []
  lifecycle.open(first, () => events.push('first show'), () => events.push('first hide'), 400)
  t.mock.timers.tick(200)
  lifecycle.open(second, () => events.push('second show'), () => events.push('second hide'), 400)
  t.mock.timers.tick(200)
  assert.deepEqual(events, ['first hide'], 'the old deadline cannot publish after takeover')
  lifecycle.cancel(first)
  lifecycle.cancel(first, false)
  t.mock.timers.tick(200)
  assert.deepEqual(events, ['first hide', 'second show'])
  lifecycle.cancel(second)
  assert.deepEqual(events, ['first hide', 'second show', 'second hide'])
})

test('focus-to-hover takeover immediately hides the old visible bubble and stale cleanup leaves the new one alone', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const lifecycle = createTooltipLifecycle()
  const first = {}, second = {}
  const visible = new Set<string>()
  lifecycle.open(first, () => visible.add('focused'), () => visible.delete('focused'), 400)
  t.mock.timers.tick(400)
  assert.deepEqual([...visible], ['focused'])
  lifecycle.open(second, () => visible.add('hovered'), () => visible.delete('hovered'), 400)
  assert.deepEqual([...visible], [], 'one owner, even during the new hover delay')
  t.mock.timers.tick(400)
  lifecycle.cancel(first)
  lifecycle.cancel(first, false)
  assert.deepEqual([...visible], ['hovered'])
  lifecycle.cancel(second)
  assert.equal(visible.size, 0)
})

test('active unmount retires pending and visible ownership without updating its unmounted component', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const lifecycle = createTooltipLifecycle()
  const owner = {}
  const events: string[] = []
  const open = () => lifecycle.open(owner, () => events.push('show'), () => events.push('hide'), 400)
  open()
  lifecycle.cancel(owner, false)
  t.mock.timers.tick(400)
  assert.equal(events.length, 0)
  open()
  t.mock.timers.tick(400)
  lifecycle.cancel(owner, false)
  lifecycle.open({}, () => events.push('next show'), () => events.push('next hide'), 400)
  t.mock.timers.tick(400)
  assert.deepEqual(events, ['show', 'next show'], 'cleanup releases ownership without a stale setState')
})

test('a superseded timer already queued for delivery cannot reopen its old owner', t => {
  const queued: Array<() => void> = []
  t.mock.method(globalThis, 'setTimeout', (callback: () => void) => { queued.push(callback); return 0 })
  const lifecycle = createTooltipLifecycle()
  const first = {}, second = {}
  const visible = new Set<string>()
  lifecycle.open(first, () => visible.add('old'), () => visible.delete('old'), 400)
  lifecycle.open(second, () => visible.add('new'), () => visible.delete('new'), 400)
  queued[0]()
  assert.equal(visible.size, 0)
  queued[1]()
  assert.deepEqual([...visible], ['new'])
  lifecycle.cancel(second)
  queued[1]()
  assert.equal(visible.size, 0, 'a delivered callback cannot outlive cancellation either')
})

test('Tooltip uses one shared owner for pointer, keyboard and unmount without changing its delay or portal styling', () => {
  const source = stripComments(read(join(ROOT, 'src/components/Tooltip.tsx')))
  assert.match(source, /import \{ tooltipLifecycle \} from '\.\.\/lib\/tooltipLifecycle\.ts'/)
  assert.match(source, /delay = 400/)
  assert.match(source, /const owner = useRef\(\{\}\)/)
  assert.match(source, /tooltipLifecycle\.open\(owner\.current,/)
  assert.match(source, /tooltipLifecycle\.cancel\(owner\.current\)/)
  assert.match(source, /useEffect\(\(\) => \{\s*const identity = owner\.current\s*return \(\) => tooltipLifecycle\.cancel\(identity, false\)/)
  assert.doesNotMatch(source, /setTimeout|clearTimeout/, 'the shared lifecycle owns every timer')
  for (const event of ['onMouseEnter', 'onFocus']) assert.match(source, new RegExp(`${event}=\\{openSoon\\}`))
  for (const event of ['onMouseLeave', 'onBlur']) assert.match(source, new RegExp(`${event}=\\{cancel\\}`))
  assert.match(source, /role="tooltip"/)
  assert.match(source, /pointer-events-none fixed z-50/)
  assert.match(source, /document\.body/)
})
