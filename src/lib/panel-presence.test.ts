import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scopePanelPresence } from './panelPresence.ts'

test('a removed lazy shell cannot recreate a ghost exit claim after its animation finishes', () => {
  const children = new Map<string | number, boolean>()
  const parent = {
    isPresent: true,
    register(id: string | number) {
      children.set(id, false)
      return () => { children.delete(id) }
    },
    onExitComplete(id: string | number) { children.set(id, true) },
  }
  const active = new Set<string | number>()
  const loading = scopePanelPresence(parent, active)
  const removeLoading = loading.register('loading')
  removeLoading()
  loading.onExitComplete('loading')
  assert.equal(children.size, 0, 'an old animation cannot resurrect its removed registration')

  const resolved = scopePanelPresence({ ...parent, isPresent: false }, active)
  const removeBody = resolved.register('body')
  loading.onExitComplete('loading')
  assert.deepEqual([...children], [['body', false]], 'only the current body can hold the exit')
  resolved.onExitComplete('body')
  assert.deepEqual([...children], [['body', true]])
  removeBody()
  assert.equal(children.size, 0)
  assert.equal(active.size, 0)
})

test('scoped presence preserves parent fields and does not own sibling registrations', () => {
  const completed: Array<string | number> = []
  const parent = { id: 'parent', isPresent: true, register: () => () => {}, onExitComplete: (id: string | number) => { completed.push(id) } }
  const first = scopePanelPresence(parent, new Set())
  const second = scopePanelPresence(parent, new Set())
  assert.equal(first.id, parent.id)
  assert.equal(first.isPresent, true)
  const remove = first.register(7)
  second.onExitComplete(7)
  assert.deepEqual(completed, [])
  first.onExitComplete(7)
  assert.deepEqual(completed, [7])
  remove()
  first.onExitComplete(7)
  assert.deepEqual(completed, [7])
})
