import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { StructuredArtifactBody } from '../../contract/index.ts'
import { createArtifactEditDraftStore, type ArtifactEditDraft } from './artifactEditDraftsCore.ts'

type WriteCall = {
  id: string
  draft: ArtifactEditDraft
  resolve: (outcome: 'applied' | 'discarded') => void
  reject: (error: unknown) => void
}

function deferredWrites() {
  const calls: WriteCall[] = []
  const store = createArtifactEditDraftStore((id, draft) => new Promise((resolve, reject) => {
    calls.push({ id, draft, resolve, reject })
  }))
  return { calls, store }
}

const sheet = (): StructuredArtifactBody => ({
  type: 'sheet',
  columns: ['Name', 'Count'],
  rows: [['apples', '3']],
  note: 'inventory',
})

const slides = (): StructuredArtifactBody => ({
  type: 'slides',
  slides: [{ title: 'Plan', bullets: ['Draft', 'Review'] }],
})

test('document, sheet, and slides drafts retain their format and opening revision', () => {
  const { store } = deferredWrites()
  const document: ArtifactEditDraft = { kind: 'document', block: 2, text: '# Notes' }
  const table: ArtifactEditDraft = { kind: 'structured', content: sheet(), expectedRevision: 7 }
  const deck: ArtifactEditDraft = { kind: 'structured', content: slides(), expectedRevision: 11 }

  store.start('doc', document)
  store.start('sheet', table)
  store.start('slides', deck)

  assert.deepEqual(store.get('doc'), { draft: document, held: false, error: null })
  assert.deepEqual(store.get('sheet'), { draft: table, held: false, error: null })
  assert.deepEqual(store.get('slides'), { draft: deck, held: false, error: null })
})

test('start and update keep detached structured snapshots; start preserves an existing draft', () => {
  const { store } = deferredWrites()
  const initial = sheet()
  const initialDraft: ArtifactEditDraft = { kind: 'structured', content: initial, expectedRevision: 4 }
  store.start('artifact', initialDraft)
  initial.columns[0] = 'mutated outside'
  initial.rows[0]![0] = 'outside'
  const pristineInitial: ArtifactEditDraft = {
    kind: 'structured',
    content: { type: 'sheet', columns: ['Name', 'Count'], rows: [['apples', '3']], note: 'inventory' },
    expectedRevision: 4,
  }
  assert.deepEqual(store.get('artifact')?.draft, {
    kind: 'structured',
    content: { type: 'sheet', columns: ['Name', 'Count'], rows: [['apples', '3']], note: 'inventory' },
    expectedRevision: 4,
  })

  const replacement: ArtifactEditDraft = { kind: 'structured', content: slides(), expectedRevision: 99 }
  store.start('artifact', replacement)
  assert.deepEqual(store.get('artifact')?.draft, pristineInitial, 'start is idempotent for an existing draft')

  store.update('artifact', replacement)
  replacement.content.slides[0]!.bullets[0] = 'mutated outside'
  assert.deepEqual(store.get('artifact')?.draft, {
    kind: 'structured',
    content: { type: 'slides', slides: [{ title: 'Plan', bullets: ['Draft', 'Review'] }] },
    expectedRevision: 99,
  })
})

test('subscriptions publish edits and allow a remounted view to read current state', () => {
  const { store } = deferredWrites()
  const firstView: unknown[] = []
  const unsubscribe = store.subscribe(() => firstView.push(store.get('artifact')))
  store.start('artifact', { kind: 'document', block: 0, text: 'one' })
  store.update('artifact', { kind: 'document', block: 1, text: 'two' })
  unsubscribe()
  store.update('artifact', { kind: 'document', block: 3, text: 'three' })

  const remountedView: unknown[] = []
  const stopRemounted = store.subscribe(() => remountedView.push(store.get('artifact')))
  assert.deepEqual(store.get('artifact'), {
    draft: { kind: 'document', block: 3, text: 'three' }, held: false, error: null,
  })
  store.cancel('artifact')
  assert.equal(firstView.length, 2, 'an unmounted listener receives no later publications')
  assert.equal(remountedView.length, 1)
  assert.equal(store.get('artifact'), undefined)
  stopRemounted()
})

test('cancel removes an editable draft, while update and cancel cannot change a held save', async () => {
  const { calls, store } = deferredWrites()
  store.start('cancel-me', { kind: 'document', block: 0, text: 'discard' })
  store.cancel('cancel-me')
  assert.equal(store.get('cancel-me'), undefined)

  store.start('saving', { kind: 'structured', content: sheet(), expectedRevision: 5 })
  const saving = store.save('saving')
  assert.equal(store.get('saving')?.held, true)
  store.update('saving', { kind: 'document', block: 0, text: 'too late' })
  store.cancel('saving')
  assert.equal(store.get('saving')?.held, true)
  assert.deepEqual(calls[0]?.draft, { kind: 'structured', content: sheet(), expectedRevision: 5 })

  calls[0]!.resolve('applied')
  assert.equal(await saving, 'applied')
  assert.equal(store.get('saving'), undefined)
})

test('save publishes the exact claimed draft, coalesces duplicate and reentrant saves, then removes on acknowledgement', async () => {
  let store!: ReturnType<typeof createArtifactEditDraftStore>
  const calls: WriteCall[] = []
  let reentrant: Promise<'applied' | 'discarded'> | undefined
  store = createArtifactEditDraftStore((id, draft) => {
    reentrant = store.save(id)
    return new Promise((resolve, reject) => calls.push({ id, draft, resolve, reject }))
  })
  const input: ArtifactEditDraft = { kind: 'structured', content: slides(), expectedRevision: 12 }
  store.start('deck', input)
  const firstSave = store.save('deck')
  const duplicateSave = store.save('deck')

  assert.equal(calls.length, 1)
  assert.equal(store.get('deck')?.held, true, 'the held state is published before write can reenter')
  assert.deepEqual(calls[0]?.draft, input)
  calls[0]!.resolve('applied')
  assert.equal(await firstSave, 'applied')
  assert.equal(await duplicateSave, 'applied')
  assert.equal(await reentrant, 'applied')
  assert.equal(store.get('deck'), undefined)
})

test('a discarded write keeps the exact draft editable and reports a recovery error', async () => {
  const { calls, store } = deferredWrites()
  const draft: ArtifactEditDraft = { kind: 'structured', content: sheet(), expectedRevision: 3 }
  store.start('sheet', draft)
  const saving = store.save('sheet')
  calls[0]!.resolve('discarded')

  assert.equal(await saving, 'discarded')
  const state = store.get('sheet')
  assert.deepEqual(state?.draft, draft)
  assert.equal(state?.held, false)
  assert.equal(typeof state?.error, 'string')
  assert.ok(state?.error)
})

test('a rejected write becomes an editable draft with its failure message and no rejected save promise', async () => {
  const { calls, store } = deferredWrites()
  const draft: ArtifactEditDraft = { kind: 'document', block: 1, text: 'exact prose' }
  store.start('doc', draft)
  const saving = store.save('doc')
  calls[0]!.reject(new Error('network unavailable'))

  assert.equal(await saving, 'discarded')
  assert.deepEqual(store.get('doc'), { draft, held: false, error: 'network unavailable' })
})

test('a synchronous write throw becomes an editable draft with its failure message', async () => {
  const store = createArtifactEditDraftStore((): Promise<'applied' | 'discarded'> => {
    throw new Error('write setup failed')
  })
  const draft: ArtifactEditDraft = { kind: 'document', block: 0, text: 'keep this' }
  store.start('doc', draft)

  assert.equal(await store.save('doc'), 'discarded')
  assert.deepEqual(store.get('doc'), { draft, held: false, error: 'write setup failed' })
})

test('a listener can reentrantly save during draft publication and shares the claimed write', async () => {
  const calls: WriteCall[] = []
  const store = createArtifactEditDraftStore((id, draft) => new Promise((resolve, reject) => {
    calls.push({ id, draft, resolve, reject })
  }))
  let listenerSave: Promise<'applied' | 'discarded'> | undefined
  const unsubscribe = store.subscribe(() => {
    if (store.get('listener') && !listenerSave) listenerSave = store.save('listener')
  })
  const draft: ArtifactEditDraft = { kind: 'document', block: 4, text: 'saved from listener' }
  store.start('listener', draft)
  const directSave = store.save('listener')

  assert.equal(calls.length, 1)
  assert.equal(store.get('listener')?.held, true)
  calls[0]!.resolve('applied')
  assert.equal(await directSave, 'applied')
  assert.equal(await listenerSave, 'applied')
  assert.equal(store.get('listener'), undefined)
  unsubscribe()
})

test('clearAll fences a late completion from a new same-id account entry', async () => {
  const { calls, store } = deferredWrites()
  store.start('same-id', { kind: 'document', block: 0, text: 'old account' })
  const oldSave = store.save('same-id')
  store.clearAll()
  assert.equal(store.get('same-id'), undefined)

  const newDraft: ArtifactEditDraft = { kind: 'structured', content: slides(), expectedRevision: 21 }
  store.start('same-id', newDraft)
  const changes: unknown[] = []
  const unsubscribe = store.subscribe(() => changes.push(store.get('same-id')))
  calls[0]!.resolve('applied')
  assert.equal(await oldSave, 'discarded', 'retired account work is discarded')
  assert.deepEqual(store.get('same-id'), { draft: newDraft, held: false, error: null })
  assert.deepEqual(changes, [], 'late completion cannot publish into the new account')
  unsubscribe()
})

test('clearAll settles a pending save and does not let its completion remove replacement state', async () => {
  const { calls, store } = deferredWrites()
  store.start('artifact', { kind: 'document', block: 0, text: 'old' })
  const pending = store.save('artifact')
  store.clearAll()
  assert.equal(await pending, 'discarded')

  store.start('artifact', { kind: 'document', block: 2, text: 'new' })
  calls[0]!.resolve('applied')
  await Promise.resolve()
  assert.deepEqual(store.get('artifact'), {
    draft: { kind: 'document', block: 2, text: 'new' }, held: false, error: null,
  })
})

test('account disposal during held-state publication prevents the old write from starting', async () => {
  const { calls, store } = deferredWrites()
  store.start('old', { kind: 'document', block: 0, text: 'private draft' })
  store.subscribe(() => { if (store.get('old')?.held) store.clearAll() })
  assert.equal(await store.save('old'), 'discarded')
  assert.equal(calls.length, 0)
  assert.equal(store.get('old'), undefined)
})
