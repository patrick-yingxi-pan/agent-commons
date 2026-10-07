import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactContent } from '../../contract/content.ts'
import type { ArtifactHistoryVersion } from '../../contract/artifactHistory.ts'
import type { PersistedState } from './format.ts'
import { migrateDocumentIdentityV6 } from './documentIdentityV6.ts'
import { docBlockId } from '../documentIdentity.ts'

function state(overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    version: 5,
    sessions: [], bindings: [], workspaces: [], schedules: [],
    recents: {} as PersistedState['recents'], graph: {} as PersistedState['graph'],
    seq: {} as PersistedState['seq'],
    artifactBodies: [], artifactHistory: [], discussions: [], socialProposals: [],
    ...overrides,
  }
}

const doc = (text: string, revision: number, ids?: string[]): ArtifactContent => ({
  type: 'doc', title: 'Migration fixture', revision,
  blocks: text.split('|').map((p, index) => ({ p, ...(ids ? { id: ids[index] } : {}) })) as never,
})

function version(revision: number, body: ArtifactContent, reason: 'baseline' | 'edit' | 'restore' = revision === 0 ? 'baseline' : 'edit', restoredFromRevision?: number): ArtifactHistoryVersion {
  const { revision: _revision, ...withoutRevision } = body
  return {
    revision, savedAt: reason === 'baseline' ? null : new Date(revision * 1000).toISOString(), reason,
    ...(restoredFromRevision === undefined ? {} : { restoredFromRevision }), body: withoutRevision as never,
  }
}

test('v6 identifies each retained legacy Document revision independently and matches current to latest', () => {
  const source = state({
    artifactBodies: [['doc-a', doc('changed|second', 1)]],
    artifactHistory: [['doc-a', [version(0, doc('first|second', 0)), version(1, doc('changed|second', 1))]]],
    discussions: [{ id: 'discussion-a', anchors: [{ blockIndex: 1 }] } as never],
  })
  const before = structuredClone(source)
  const migrated = migrateDocumentIdentityV6(source)
  assert.deepEqual(source, before, 'migration does not mutate the v5 input')
  const histories = migrated.artifactHistory?.[0]?.[1]
  assert.ok(histories)
  assert.deepEqual(histories[0].body.type === 'doc' ? histories[0].body.blocks.map((b) => b.id) : [], [
    docBlockId('doc-a', 0, 0), docBlockId('doc-a', 0, 1),
  ])
  assert.deepEqual(histories[1].body.type === 'doc' ? histories[1].body.blocks.map((b) => b.id) : [], [
    docBlockId('doc-a', 1, 0), docBlockId('doc-a', 1, 1),
  ], 'a later whole-body revision receives independent deterministic identities')
  assert.deepEqual(migrated.artifactBodies?.[0]?.[1], { ...doc('changed|second', 1), blocks: histories[1].body.type === 'doc' ? histories[1].body.blocks : [] })
  assert.deepEqual(migrated.discussions, source.discussions, 'legacy numeric anchors remain untouched and unresolved')
})

test('v6 exact restore reuses identified source IDs, and already identified history is preserved', () => {
  const originalIds = ['stable-a', 'stable-b']
  const sourceBody = doc('one|two', 0, originalIds)
  const edited = doc('changed|two', 1, ['edit-a', 'edit-b'])
  const restored = doc('one|two', 2, originalIds)
  const source = state({
    artifactBodies: [['doc-a', restored]],
    artifactHistory: [['doc-a', [
      version(0, sourceBody), version(1, edited), version(2, restored, 'restore', 0),
    ]]],
  })
  const migrated = migrateDocumentIdentityV6(source)
  const history = migrated.artifactHistory?.[0]?.[1]
  assert.ok(history)
  assert.deepEqual(history.map((entry) => entry.body.type === 'doc' ? entry.body.blocks.map((b) => b.id) : []), [
    originalIds, ['edit-a', 'edit-b'], originalIds,
  ])
  assert.deepEqual((migrated.artifactBodies?.[0]?.[1] as Extract<ArtifactContent, { type: 'doc' }>).blocks.map((b) => b.id), originalIds)
})

test('v6 identifies a no-history Document, but leaves every non-Document body unchanged', () => {
  const legacy = doc('legacy one|legacy two', 8)
  const sheet = { type: 'sheet', name: 'S', columns: [], rows: [], cells: [], notes: [], revision: 0 } as unknown as ArtifactContent
  const source = state({ artifactBodies: [['doc-a', legacy], ['sheet-a', sheet]] })
  const migrated = migrateDocumentIdentityV6(source)
  assert.deepEqual((migrated.artifactBodies?.[0]?.[1] as Extract<ArtifactContent, { type: 'doc' }>).blocks.map((b) => b.id), [
    docBlockId('doc-a', 8, 0), docBlockId('doc-a', 8, 1),
  ])
  assert.deepEqual(migrated.artifactBodies?.[1]?.[1], sheet)
})

test('v6 refuses a current/history mismatch or malformed identity before returning any transformed state', () => {
  const baseHistory = [version(0, doc('one|two', 0)), version(1, doc('changed|two', 1))]
  const malformed: PersistedState[] = [
    state({ artifactBodies: [['doc-a', doc('different|two', 1)]], artifactHistory: [['doc-a', baseHistory]] }),
    state({ artifactBodies: [['doc-a', doc('one|two', 1, ['valid', 'valid'])]] }),
    state({ artifactBodies: [['doc-a', doc('one|two', 1, ['valid', 'bad!'])]] }),
    state({ artifactBodies: [['doc-a', doc('changed|two', 1)]], artifactHistory: [['doc-a', [
      version(0, doc('one|two', 0)), version(1, doc('changed|two', 1, ['id-one', 'id-two'])),
    ]]] }),
  ]
  for (const candidate of malformed) {
    const before = structuredClone(candidate)
    assert.throws(() => migrateDocumentIdentityV6(candidate), TypeError)
    assert.deepEqual(candidate, before, 'failure leaves source snapshot untouched')
  }
})
