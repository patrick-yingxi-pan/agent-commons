/** Artifact index excerpts follow authored bodies unless the author supplied a synopsis. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artifactCreationId } from '../artifactCreationIdentity.ts'
import { store } from './index.ts'

const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function directArtifact(tenantId: string, key: string, kind: 'doc' | 'sheet' | 'slide', body: unknown) {
  const name = `${key}-${stamp}.${kind === 'doc' ? 'md' : kind === 'sheet' ? 'csv' : 'pptx'}`
  const id = artifactCreationId(tenantId, `${key}-${stamp}`)
  const created = store.createArtifact({ name, kind, body: body as never }, tenantId, id)
  assert.ok(created && created !== 'invalid')
  return { id, name, artifact: created.artifact }
}

function savedArtifact(tenantId: string, name: string, body: unknown, excerpt?: string) {
  const artifact = {
    name,
    kind: 'doc',
    meta: 'Document',
    body,
    ...(excerpt === undefined ? {} : { excerpt }),
  }
  store.applyRelationOp({ kind: 'save-artifact', artifact }, tenantId)
  const row = store.relationGraph(tenantId).extraArtifacts.find((candidate) => candidate.name === name)
  assert.ok(row, 'the save-artifact operation creates its authored row')
  return row
}

test('directly created document excerpt tracks body edits and remains current through rename, replay, and grants', () => {
  const owner = `tenant-excerpt-owner-${stamp}`
  const initial = directArtifact(owner, 'direct-doc', 'doc', 'Creation excerpt from the first paragraph.')
  assert.equal(initial.artifact.excerpt, 'Creation excerpt from the first paragraph.')

  assert.ok(store.updateArtifactBlock(initial.id, 0, 'Current body after the edit.'))
  const current = 'Current body after the edit.'
  assert.equal(store.listArtifacts(owner).find((row) => row.id === initial.id)?.excerpt, current)

  const renamed = store.renameArtifact(initial.id, `renamed-${stamp}.md`, 0, owner)
  assert.equal(renamed?.excerpt, current, 'rename changes the display name, not the current body preview')
  const replay = store.createArtifact(
    { name: initial.name, kind: 'doc', body: 'ignored on represented retry' },
    owner,
    artifactCreationId(owner, `direct-doc-${stamp}`),
  )
  assert.ok(replay && replay !== 'invalid')
  assert.equal(replay.artifact.id, initial.id)
  assert.equal(replay.artifact.name, `renamed-${stamp}.md`)
  assert.equal(replay.artifact.excerpt, current, 'replay returns current metadata and body-derived preview')
  assert.deepEqual(store.listArtifacts(owner).filter((row) => row.id === initial.id).map((row) => row.excerpt), [current])

  const grant = store.createGrant(
    { subject: { kind: 'artifact', id: initial.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    owner,
  )
  assert.ok(grant)
  const shared = store.listArtifacts('tenant-beta').find((row) => row.id === initial.id)
  assert.equal(shared?.own, false)
  assert.equal(shared?.excerpt, current, 'granted readers see the same current excerpt')
  assert.equal(store.listArtifacts(`tenant-excerpt-foreign-${stamp}`).some((row) => row.id === initial.id), false)
  assert.equal(store.revokeGrant(grant.id, owner), 'ok')
  assert.equal(store.listArtifacts('tenant-beta').some((row) => row.id === initial.id), false)
})

test('direct sheet and slide excerpts summarize their current saved bodies after edits', () => {
  const tenant = `tenant-excerpt-structured-${stamp}`
  const sheet = directArtifact(tenant, 'direct-sheet', 'sheet', {
    type: 'sheet', columns: ['Before'], rows: [['one']],
  })
  const slide = directArtifact(tenant, 'direct-slide', 'slide', {
    type: 'slides', slides: [{ title: 'Before', bullets: ['first'] }],
  })
  assert.equal(sheet.artifact.excerpt, '1 rows · Before')
  assert.equal(slide.artifact.excerpt, '1 slides · Before')

  assert.ok(store.updateStructuredArtifactContent(sheet.id, {
    type: 'sheet', columns: ['Current metric', 'Value'], rows: [['Retention', '42%']],
  }, 0, tenant))
  assert.ok(store.updateStructuredArtifactContent(slide.id, {
    type: 'slides', slides: [{ title: 'Current title', bullets: ['updated'] }],
  }, 0, tenant))
  const rows = store.listArtifacts(tenant)
  assert.equal(rows.find((row) => row.id === sheet.id)?.excerpt, '1 rows · Current metric · Value')
  assert.equal(rows.find((row) => row.id === slide.id)?.excerpt, '1 slides · Current title')
})

test('save-artifact with absent or blank excerpt derives a live preview; explicit synopsis stays independent', () => {
  const tenant = `tenant-excerpt-save-${stamp}`
  const absentName = `absent-${stamp}.md`
  const blankName = `blank-${stamp}.md`
  const explicitName = `explicit-${stamp}.md`
  const equalName = `equal-${stamp}.md`

  const absent = savedArtifact(tenant, absentName, 'First derived preview.')
  const blank = savedArtifact(tenant, blankName, 'Blank starts from body.', '  ')
  const explicit = savedArtifact(tenant, explicitName, 'Initial body text.', 'A hand-written synopsis.')
  const equal = savedArtifact(tenant, equalName, 'Initially body and synopsis match.', 'Initially body and synopsis match.')

  for (const row of [absent, blank, explicit, equal]) {
    const content = store.artifactContent(tenant)[row.id]
    assert.equal(content?.type, 'doc')
    assert.ok(store.updateArtifactBlock(row.id, 0, `Edited body for ${row.name}.`))
  }

  const listed = new Map(store.listArtifacts(tenant).map((row) => [row.id, row]))
  assert.equal(listed.get(absent.id)?.excerpt, `Edited body for ${absentName}.`)
  assert.equal(listed.get(blank.id)?.excerpt, `Edited body for ${blankName}.`)
  assert.equal(listed.get(explicit.id)?.excerpt, 'A hand-written synopsis.')
  assert.equal(listed.get(equal.id)?.excerpt, 'Initially body and synopsis match.',
    'an explicitly supplied synopsis remains explicit even when it initially equals the body excerpt')
})
