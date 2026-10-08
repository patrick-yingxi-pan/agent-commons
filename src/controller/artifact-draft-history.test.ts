import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { EditableArtifactBody } from '../../contract/index.ts'
import { createArtifactEditDraftStore, type ArtifactEditDraft } from './artifactEditDraftsCore.ts'

const bodies: EditableArtifactBody[] = [
  { type: 'doc', title: 'Notes', blocks: [{ id: 'original-heading', h: 'Plan' }, { id: 'original-list', ul: ['one\ntwo', 'three'] }] },
  { type: 'sheet', columns: ['Name', 'Count'], rows: [['one', '1'], ['two', '2']] },
  { type: 'workbook', sheets: [
    { id: 'first', name: 'First', columns: ['Name'], rows: [['one']] },
    { id: 'second', name: 'Second', columns: ['Name'], rows: [['two']] },
  ] },
  { type: 'slides', slides: [{ title: 'First', bullets: ['one', 'two'] }, { title: 'Second', bullets: ['three'] }] },
]
const draft = (content: EditableArtifactBody, expectedRevision = 7): ArtifactEditDraft => ({ kind: 'structured', content, expectedRevision })
const changed = (body: EditableArtifactBody): EditableArtifactBody => body.type === 'doc'
  ? { ...body, blocks: body.blocks.slice(1) }
  : body.type === 'sheet' ? { ...body, rows: body.rows.slice(1) }
    : body.type === 'workbook' ? { ...body, sheets: body.sheets.slice(1) }
      : { ...body, slides: body.slides.slice(1) }

test('every complete Artifact format can undo and redo exact structural edits without writing', () => {
  let writes = 0
  const store = createArtifactEditDraftStore(async () => { writes++; return 'applied' })
  for (const body of bodies) {
    const id = body.type
    const opening = draft(body)
    const edited = draft(changed(body))
    store.start(id, opening)
    assert.equal(store.canUndo(id), false)
    assert.equal(store.canRedo(id), false)
    store.update(id, edited)
    assert.equal(store.canUndo(id), true)
    store.undo(id)
    assert.deepEqual(store.get(id)?.draft, opening, `${id}: exact original identity, literal content, and opening revision`)
    assert.equal(store.canUndo(id), false)
    assert.equal(store.canRedo(id), true)
    store.redo(id)
    assert.deepEqual(store.get(id)?.draft, edited)
    assert.equal(store.canRedo(id), false)
  }
  assert.equal(writes, 0, 'draft history grants no HTTP, save, or server-history operation')
})

test('field edits coalesce, structural edits remain separate, and a new branch retires redo', () => {
  const store = createArtifactEditDraftStore(async () => 'applied')
  const opening = bodies[0]!
  const group = Symbol('one field focus')
  const title = (value: string) => draft({ ...opening, title: value } as EditableArtifactBody)
  store.start('doc', draft(opening))
  store.update('doc', title('A'), group)
  store.update('doc', title('AB'), group)
  store.update('doc', title('ABC'), group)
  store.update('doc', draft(changed(opening)))
  store.undo('doc')
  assert.deepEqual(store.get('doc')?.draft, title('ABC'), 'delete is one independent action')
  store.undo('doc')
  assert.deepEqual(store.get('doc')?.draft, draft(opening), 'continuous typing is one action')
  store.redo('doc')
  assert.deepEqual(store.get('doc')?.draft, title('ABC'))
  store.update('doc', title('ABC'))
  assert.equal(store.canRedo('doc'), true, 'an equal-value render cannot discard redo')
  store.update('doc', title('New branch'), group)
  assert.equal(store.canRedo('doc'), false)
  store.undo('doc')
  assert.deepEqual(store.get('doc')?.draft, title('ABC'), 'typing after Undo starts a fresh step')
})

test('history follows the shared draft across readers and permits sheet/workbook promotion', () => {
  const store = createArtifactEditDraftStore(async () => 'applied')
  const single = draft(bodies[1]!)
  const workbook = draft(bodies[2]!)
  store.start('grid', single)
  const seen: unknown[] = []
  const unsubscribe = store.subscribe(() => seen.push(store.get('grid')?.draft))
  store.update('grid', workbook)
  unsubscribe()
  store.start('grid', draft(changed(bodies[1]!)))
  assert.deepEqual(store.get('grid')?.draft, workbook, 'remount cannot reset an open draft or its history')
  store.undo('grid')
  assert.deepEqual(store.get('grid')?.draft, single)
  store.redo('grid')
  assert.deepEqual(store.get('grid')?.draft, workbook)
  assert.equal(seen.length, 1, 'unmounted projections receive no later notifications')
})

test('held and unavailable drafts refuse history traversal; Dismiss preserves it and Save acknowledgement clears it', async () => {
  let settle!: (result: 'applied' | 'discarded') => void
  let available = true
  const calls: ArtifactEditDraft[] = []
  const store = createArtifactEditDraftStore((_id, value) => {
    calls.push(value)
    return new Promise(resolve => { settle = resolve })
  }, () => available)
  const original = draft(bodies[0]!)
  const edited = draft(changed(bodies[0]!))
  store.start('doc', original)
  store.update('doc', edited)
  available = false
  store.undo('doc')
  assert.equal(store.canUndo('doc'), false)
  assert.deepEqual(store.get('doc')?.draft, edited)
  available = true
  const saving = store.save('doc')
  store.undo('doc')
  store.redo('doc')
  assert.equal(store.canUndo('doc'), false)
  assert.equal(store.canRedo('doc'), false)
  assert.deepEqual(calls, [edited])
  settle('discarded')
  await saving
  assert.equal(store.canUndo('doc'), true)
  store.undo('doc')
  assert.deepEqual(store.get('doc')?.draft, original)
  store.redo('doc')
  const retry = store.save('doc')
  settle('applied')
  await retry
  assert.equal(store.get('doc'), undefined)
  store.start('doc', draft(changed(bodies[0]!), 8))
  assert.equal(store.canUndo('doc'), false, 'saving ends this draft history; saved History is separate')
})

test('cancel, account disposal, and a different draft identity cannot revive retired history', async () => {
  let settle!: (result: 'applied' | 'discarded') => void
  const store = createArtifactEditDraftStore(() => new Promise(resolve => { settle = resolve }))
  const original = draft(bodies[0]!)
  const edited = draft(changed(bodies[0]!))
  store.start('doc', original)
  store.update('doc', edited)
  store.cancel('doc')
  store.start('doc', original)
  assert.equal(store.canUndo('doc'), false)
  store.update('doc', edited)
  const saving = store.save('doc')
  store.clearAll()
  store.start('doc', draft(bodies[0]!, 20))
  store.update('doc', draft(changed(bodies[0]!), 20))
  settle('applied')
  assert.equal(await saving, 'discarded')
  store.undo('doc')
  assert.deepEqual(store.get('doc')?.draft, draft(bodies[0]!, 20), 'late prior-account work cannot clear new history')
  store.update('doc', draft(bodies[3]!, 21))
  assert.equal(store.canUndo('doc'), false, 'history never crosses an opening revision or unrelated format')
  store.update('doc', { kind: 'document', block: 0, text: 'inline draft' })
  assert.equal(store.canUndo('doc'), false, 'inline fields retain their own native text-edit behavior')
})
