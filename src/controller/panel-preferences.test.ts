import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PanelFocus, SessionPreferences } from '../types.ts'
import { ROOT, filesUnder, read, stripComments } from '../../tests/helpers/source.ts'
import { createPanelPreferenceController } from './panelPreferencesCore.ts'

const repo = (id: string): PanelFocus => ({ kind: 'repo', id })
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function harness() {
  const local = new Map<string, { focus: PanelFocus | null; dirty: boolean }>()
  const calls: Array<{ id: string; focus: PanelFocus | null }> = []
  const waiters: Array<(value: SessionPreferences) => void> = []
  const controller = createPanelPreferenceController({
    scope: () => null,
    patch: (id, focus) => {
      calls.push({ id, focus })
      return new Promise((resolve) => waiters.push(resolve))
    },
    getLocal: (id) => local.get(id),
    setLocal: (id, focus) => local.set(id, { focus, dirty: true }),
    acknowledge: (id, expected, returned) => {
      const current = local.get(id)
      if (current?.dirty && JSON.stringify(current.focus) === JSON.stringify(expected)) {
        local.set(id, { focus: returned.panelFocus ?? null, dirty: false })
      }
    },
    adopt: (_id, returned) => returned?.panelFocus,
  })
  return { controller, local, calls, waiters }
}

test('rapid choices serialize and a stale acknowledgement cannot erase the newer intent', async () => {
  const h = harness()
  h.controller.remember('s1', repo('a'))
  h.controller.remember('s1', repo('b'))
  assert.deepEqual(h.calls, [{ id: 's1', focus: repo('a') }])
  h.waiters.shift()!({ panelFocus: repo('a') })
  await tick()
  assert.deepEqual(h.calls, [
    { id: 's1', focus: repo('a') },
    { id: 's1', focus: repo('b') },
  ])
  assert.deepEqual(h.local.get('s1'), { focus: repo('b'), dirty: true })
  h.waiters.shift()!({ panelFocus: repo('b') })
  await tick()
  assert.deepEqual(h.local.get('s1'), { focus: repo('b'), dirty: false })
})

test('a dirty offline choice wins a server read and is retried without a hot loop', async () => {
  const local = new Map([['s1', { focus: null as PanelFocus | null, dirty: true }]])
  let calls = 0
  const controller = createPanelPreferenceController({
    scope: () => null,
    patch: async () => {
      calls += 1
      throw new Error('offline')
    },
    getLocal: (id) => local.get(id),
    setLocal: (id, focus) => local.set(id, { focus, dirty: true }),
    acknowledge: () => {},
    adopt: (_id, returned) => returned?.panelFocus,
  })
  assert.equal(controller.resolve('s1', { panelFocus: repo('server') }), null)
  await tick()
  assert.equal(calls, 1)
  assert.equal(controller.resolve('s1', { panelFocus: repo('server') }), null)
  await tick()
  assert.equal(calls, 2, 'the next authoritative read retries exactly once')
})

test('a newly attached focus waits for its workspace persistence barrier', async () => {
  const h = harness()
  let release!: () => void
  const workspaceWrite = new Promise<void>((resolve) => { release = resolve })
  h.controller.remember('s1', repo('newly-attached'), workspaceWrite)
  assert.deepEqual(h.calls, [], 'the server cannot validate the focus before the workspace lands')
  assert.deepEqual(
    h.controller.resolve('s1', { panelFocus: null }),
    repo('newly-attached'),
    'the persistence barrier never delays the local UI',
  )
  assert.deepEqual(h.calls, [], 'an authoritative read cannot bypass the barrier')

  release()
  await tick()
  assert.deepEqual(h.calls, [{ id: 's1', focus: repo('newly-attached') }])
})

test('clean state adopts the server tri-state', () => {
  const controller = createPanelPreferenceController({
    scope: () => null,
    patch: async (_id, focus) => ({ panelFocus: focus }),
    getLocal: () => undefined,
    setLocal: () => {},
    acknowledge: () => {},
    adopt: (_id, returned) => returned?.panelFocus,
  })
  assert.deepEqual(controller.resolve('s1', { panelFocus: repo('remote') }), repo('remote'))
  assert.equal(controller.resolve('s1', { panelFocus: null }), null)
  assert.equal(controller.resolve('s1', {}), undefined)
})

test('production panel writes cannot bypass the durable controller', () => {
  const directImports = filesUnder('src')
    .filter((file) => /import\s*{[\s\S]*?\bsetPanelPref\b[\s\S]*?}\s*from\s*['"][^'"]*panelPrefs/.test(stripComments(read(file))))
    .map((file) => file.slice(ROOT.length + 1))
  assert.deepEqual(directImports, ['src/controller/panelPreferences.ts'])
})

test('an in-flight acknowledgement stays with the account that started it', async () => {
  let active: 'ada' | 'grace' = 'ada'
  const key = (scope: string | null, id: string) => `${scope}:${id}`
  const local = new Map<string, { focus: PanelFocus | null; dirty: boolean }>()
  const calls: Array<{ scope: string; focus: PanelFocus | null }> = []
  const waiters: Array<(value: SessionPreferences) => void> = []
  const controller = createPanelPreferenceController({
    scope: () => active,
    patch: (_id, focus) => {
      calls.push({ scope: active, focus })
      return new Promise((resolve) => waiters.push(resolve))
    },
    getLocal: (id, scope) => local.get(key(scope, id)),
    setLocal: (id, focus, scope) => local.set(key(scope, id), { focus, dirty: true }),
    acknowledge: (id, expected, returned, scope) => {
      const stored = local.get(key(scope, id))
      if (stored?.dirty && JSON.stringify(stored.focus) === JSON.stringify(expected)) {
        local.set(key(scope, id), { focus: returned.panelFocus ?? null, dirty: false })
      }
    },
    adopt: (_id, returned) => returned?.panelFocus,
  })

  controller.remember('s1', repo('ada-choice'))
  active = 'grace'
  controller.remember('s1', repo('grace-choice'))
  assert.deepEqual(calls, [
    { scope: 'ada', focus: repo('ada-choice') },
    { scope: 'grace', focus: repo('grace-choice') },
  ])

  waiters.shift()!({ panelFocus: repo('ada-choice') })
  await tick()
  assert.deepEqual(local.get('ada:s1'), { focus: repo('ada-choice'), dirty: false })
  assert.deepEqual(local.get('grace:s1'), { focus: repo('grace-choice'), dirty: true })

  waiters.shift()!({ panelFocus: repo('grace-choice') })
  await tick()
  assert.deepEqual(local.get('grace:s1'), { focus: repo('grace-choice'), dirty: false })
})
