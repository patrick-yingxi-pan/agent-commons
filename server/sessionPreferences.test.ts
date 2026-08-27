import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionWorkspace } from '../contract/index.ts'
import {
  getSessionPreferences,
  persistedSessionPreferences,
  pruneSessionPreferences,
  rehydrateSessionPreferences,
  removeSessionPreferences,
  setSessionPreferences,
} from './sessionPreferences.ts'

const workspace: SessionWorkspace = {
  workspaces: [],
  repos: [{ id: 'repo-1', label: 'repo', origin: 'github', branch: 'main', files: [], diff: [], terminal: [] }],
  connectors: [],
  attachments: [],
}

beforeEach(() => rehydrateSessionPreferences(undefined, () => undefined))

test('preferences are isolated by viewer and preserve unset versus explicit close', () => {
  assert.deepEqual(getSessionPreferences('ada', 's1'), {})
  setSessionPreferences('ada', 's1', null, workspace)
  setSessionPreferences('grace', 's1', { kind: 'repo', id: 'repo-1' }, workspace)
  assert.deepEqual(getSessionPreferences('ada', 's1'), { panelFocus: null })
  assert.deepEqual(getSessionPreferences('grace', 's1'), { panelFocus: { kind: 'repo', id: 'repo-1' } })
})

test('dangling focuses are refused on write and pruned to closed after a detach', () => {
  assert.throws(
    () => setSessionPreferences('ada', 's1', { kind: 'repo', id: 'missing' }, workspace),
    /not attached/,
  )
  setSessionPreferences('ada', 's1', { kind: 'repo', id: 'repo-1' }, workspace)
  assert.equal(pruneSessionPreferences('s1', { ...workspace, repos: [] }), true)
  assert.deepEqual(getSessionPreferences('ada', 's1'), { panelFocus: null })
})

test('persistence restores valid rows, closes stale rows, and drops unknown sessions', () => {
  rehydrateSessionPreferences(
    [
      ['ada', [
        ['s1', { panelFocus: { kind: 'repo', id: 'repo-1' } }],
        ['gone', { panelFocus: null }],
      ]],
    ],
    (_userId, sessionId) => (sessionId === 's1' ? { ...workspace, repos: [] } : undefined),
  )
  assert.deepEqual(getSessionPreferences('ada', 's1'), { panelFocus: null })
  assert.deepEqual(getSessionPreferences('ada', 'gone'), {})
  assert.deepEqual(persistedSessionPreferences(), [['ada', [['s1', { panelFocus: null }]]]])
  removeSessionPreferences('s1')
  assert.deepEqual(persistedSessionPreferences(), [])
})
