import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServedAttachmentRefreshIntent } from './servedAttachmentRefreshIntent.ts'
import { EMPTY_LIVE, DRAFT_ID, workspaceOf } from '../data/liveSession.ts'
import { mergeServedAttachmentRefresh } from './servedAttachmentRefreshCore.ts'

const oldId = '11111111-1111-4111-8111-111111111111'
const newId = '22222222-2222-4222-8222-222222222222'
const saved = { version: 2 as const, snapshotId: oldId, capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'report.docx', text: 'old', documentImport: { format: 'docx' as const, status: 'ready' as const } }
const next = { ...saved, snapshotId: newId, text: 'new' }
const attachment = { id: 'cloud::report.docx', label: 'report.docx', kind: 'file' as const, source: { id: 'cloud', kind: 'cloud' as const, label: 'Cloud' }, textSnapshot: saved }
const before = { live: { ...EMPTY_LIVE, attachments: [attachment] }, focus: null }

test('lost-acknowledgement Retry sends the same captured bytes, key and account source without rereading', async () => {
  let reads = 0
  const writes = []
  const intent = createServedAttachmentRefreshIntent('session', attachment, newId, {
    assertCurrent() {},
    capture: async () => { reads++; return structuredClone(next) },
    refresh: async (...args) => { writes.push(args); if (writes.length === 1) throw new Error('lost acknowledgement'); return { contexts: [], workspace: workspaceOf(before.live) } },
    reconcile: async () => { throw new Error('unexpected reconciliation') },
  })
  const plan = intent.plan(before)
  await assert.rejects(intent.mutate!(before, plan, 'ada'), /lost acknowledgement/)
  await intent.mutate!(before, plan, 'ada')
  assert.equal(reads, 1)
  assert.deepEqual(writes[0], writes[1])
  assert.equal(writes[1][3], 'ada')
  assert.deepEqual(writes[1][2], { expectedSnapshotId: oldId, requestId: newId, snapshot: next })
})

test('failed capture can retry, but detached or newer targets refuse before reading', async () => {
  let reads = 0
  let writes = 0
  const intent = createServedAttachmentRefreshIntent('session', attachment, newId, {
    assertCurrent() {}, capture: async () => { reads++; if (reads === 1) throw new Error('unreadable'); return next },
    refresh: async () => { writes++; return { contexts: [], workspace: workspaceOf(before.live) } },
    reconcile: async () => { throw new Error('unused') },
  })
  const plan = intent.plan(before)
  await assert.rejects(intent.mutate!(before, plan), /unreadable/)
  assert.equal(writes, 0)
  await intent.mutate!(before, plan)
  assert.equal(reads, 2)
  await assert.rejects(intent.mutate!({ ...before, live: { ...before.live, attachments: [] } }, plan), /no longer attached/)
  await assert.rejects(intent.mutate!({ ...before, live: { ...before.live, attachments: [{ ...attachment, textSnapshot: { ...saved, snapshotId: '33333333-3333-4333-8333-333333333333' } }] } }, plan), /saved copy changed/)
  assert.equal(reads, 2)
  assert.equal(writes, 1)
})

test('draft Refresh and read-only reconciliation retain saved projections and never issue HTTP mutations', async () => {
  let reads = 0
  const intent = createServedAttachmentRefreshIntent(DRAFT_ID, attachment, newId, {
    assertCurrent() {}, capture: async () => { reads++; return next },
    refresh: async () => { throw new Error('unexpected write') }, reconcile: async () => { throw new Error('unexpected read') },
  })
  const updated = await intent.mutate!(before, intent.plan(before))
  const merged = mergeServedAttachmentRefresh(before.live, updated, { attachmentId: attachment.id, expectedSnapshotId: oldId, requestId: newId })
  assert.deepEqual(merged.attachments[0].textSnapshot, next)
  const reconciled = await intent.reconcile!({ ...before, live: merged }, new AbortController().signal)
  assert.deepEqual(reconciled.workspace.attachments[0].textSnapshot, next)
  assert.equal(reads, 1)
})

test('account changes after capture prevent publication and reconciliation does not perform another capture', async () => {
  let checks = 0
  const intent = createServedAttachmentRefreshIntent('session', attachment, newId, {
    assertCurrent() { if (++checks > 1) throw new Error('account changed') }, capture: async () => next,
    refresh: async () => { throw new Error('unexpected write') },
    reconcile: async () => { throw new Error('unexpected read') },
  })
  await assert.rejects(intent.mutate!(before, intent.plan(before)), /account changed/)
  await assert.rejects(intent.reconcile!(before, new AbortController().signal), /account changed/)
})

test('served image Retry and drafts use the exact nested image receipt without text payloads', async () => {
  const image = { id: 'img-' + 'a'.repeat(64), mimeType: 'image/png', width: 2, height: 2, byteLength: 80 }
  const imageSnapshot = { version: 1, snapshotId: oldId, capturedAt: saved.capturedAt, sourceId: 'cloud', path: 'a.png', image }
  const photo = { id: 'cloud::a.png', label: 'a.png', kind: 'photo', source: attachment.source, imageSnapshot }
  const state = { live: { ...EMPTY_LIVE, attachments: [photo] }, focus: null }
  const captured = { ...imageSnapshot, snapshotId: newId, image: { ...image, id: 'img-' + 'b'.repeat(64) } }
  let reads = 0; const writes: unknown[] = []
  const deps = {
    assertCurrent() {}, capture: async () => { reads++; return captured },
    refresh: async (...args) => { writes.push(args); if (writes.length === 1) throw new Error('lost acknowledgement'); return { contexts: [], workspace: workspaceOf(state.live) } },
    reconcile: async () => { throw new Error('unexpected read') },
  }
  const intent = createServedAttachmentRefreshIntent('session', photo, newId, deps)
  await assert.rejects(intent.mutate!(state, intent.plan(state), 'ada'), /lost acknowledgement/)
  await intent.mutate!(state, intent.plan(state), 'ada')
  assert.equal(reads, 1)
  assert.deepEqual(writes[0], writes[1])
  assert.deepEqual(writes[0][2], { expectedSnapshotId: oldId, requestId: newId, imageSnapshot: captured })
  const draft = createServedAttachmentRefreshIntent(DRAFT_ID, photo, newId, deps)
  const updated = await draft.mutate!(state, draft.plan(state))
  assert.deepEqual(updated.workspace.attachments[0].imageSnapshot, captured)
  assert.equal(updated.workspace.attachments[0].image, undefined)
  assert.equal(updated.workspace.attachments[0].textSnapshot, undefined)
  assert.equal(writes.length, 2, 'draft capture cannot issue a session mutation')
})
