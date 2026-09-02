import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SavedContext, SavedContextsSnapshot } from '../../contract/index.ts'
import {
  mergeSavedContextConnection,
  mergeSavedContextConnectionSnapshot,
} from './savedContextRevision.ts'

const row = (status: SavedContext['status'], connectionRevision: number): SavedContext => ({
  id: 'ctx',
  label: 'Context',
  kind: 'connector',
  status,
  connectionRevision,
  detail: `detail-${connectionRevision}`,
  lastUsedAt: connectionRevision,
  sessions: connectionRevision,
})

test('connection acknowledgements advance only their orthogonal status dimension', () => {
  const current = row('connected', 2)
  const incoming = row('needs-auth', 3)
  const merged = mergeSavedContextConnection(current, incoming)
  assert.equal(merged.status, 'needs-auth')
  assert.equal(merged.connectionRevision, 3)
  assert.equal(merged.detail, current.detail, 'descriptive state is not ordered by a connection revision')
  assert.equal(merged.lastUsedAt, current.lastUsedAt, 'usage activity is not rewound by a status acknowledgement')
  assert.equal(merged.sessions, current.sessions)
  assert.equal(mergeSavedContextConnection(merged, current), merged, 'an older acknowledgement cannot rewind status')
})

test('an addressed merge derives quick lists, removes authoritatively absent rows, and never resurrects', () => {
  const current = row('connected', 0)
  const sibling = { ...row('connected', 4), id: 'sibling', kind: 'mcp' as const }
  const snapshot: SavedContextsSnapshot = {
    contexts: [current, sibling],
    connectedConnectorIds: ['ctx'],
    connectedMcpIds: ['sibling'],
  }
  const changed = mergeSavedContextConnectionSnapshot(snapshot, 'ctx', row('needs-auth', 1))
  assert.deepEqual(changed.connectedConnectorIds, [])
  assert.deepEqual(changed.connectedMcpIds, ['sibling'], 'a sibling projection survives addressed reconciliation')
  assert.equal(changed.contexts.find((context) => context.id === 'sibling'), sibling)

  const removed = mergeSavedContextConnectionSnapshot(changed, 'ctx', undefined)
  assert.ok(!removed.contexts.some((context) => context.id === 'ctx'))
  assert.equal(
    mergeSavedContextConnectionSnapshot(removed, 'ctx', row('connected', 9)),
    removed,
    'a late acknowledgement cannot resurrect a removed row',
  )
})
