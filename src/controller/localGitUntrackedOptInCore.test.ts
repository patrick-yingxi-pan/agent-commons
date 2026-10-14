import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalGitUntrackedOptInCore } from './localGitUntrackedOptInCore.ts'

test('opt-in is transient and disabling or retaining away a connection clears its browser', () => {
  const dismissed: string[] = []
  const core = createLocalGitUntrackedOptInCore(id => dismissed.push(id))
  let changes = 0
  core.subscribe('repo', () => changes++)
  core.set('repo', true)
  assert.equal(core.get('repo'), true)
  assert.deepEqual(dismissed, [])
  core.set('repo', false)
  assert.equal(core.get('repo'), false)
  assert.deepEqual(dismissed, ['repo'])
  core.set('repo', true)
  core.retain([])
  assert.equal(core.get('repo'), false)
  assert.deepEqual(dismissed, ['repo', 'repo'])
  assert.equal(changes, 4)
  core.set('repo', true)
  core.clear()
  assert.equal(core.get('repo'), false, 'reload/account clear does not preserve opt-in')
  assert.deepEqual(dismissed, ['repo', 'repo', 'repo'])
})
