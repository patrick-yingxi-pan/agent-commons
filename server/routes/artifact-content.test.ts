/** PATCH /artifacts/:id/content is the owner's durable body-edit seam. The
 *  body revision orders concurrent rewrites while legacy unconditional clients
 *  remain compatible and every accepted write advances the same counter. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { docBlockText, type ArtifactContent, type ArtifactContentLibrary, type ArtifactItem } from '../../contract/index.ts'
import { call } from '../testkit/http.ts'

async function editableArtifact() {
  const artifacts = (await call('GET', '/artifacts')).json as ArtifactItem[]
  const library = (await call('GET', '/artifact-content')).json as ArtifactContentLibrary
  for (const artifact of artifacts) {
    if (artifact.own === false) continue
    const body = library[artifact.id] ?? library[artifact.name]
    if (!body || body.type !== 'doc') continue
    const block = body.blocks.findIndex((candidate) => docBlockText(candidate) !== undefined)
    if (block >= 0) return { artifact, body, block, text: docBlockText(body.blocks[block]!)! }
  }
  throw new Error('fixture must expose one owned, editable document')
}

async function restore(artifactId: string, block: number, text: string) {
  const restored = await call('PATCH', `/artifacts/${artifactId}/content`, { block, text })
  assert.equal(restored.status, 200, 'test restores the authored prose for later suites')
}

test('artifact body PATCH refuses a stale revision and replays one logical retry', async () => {
  const { artifact, body, block, text: original } = await editableArtifact()
  const revision = body.revision ?? 0
  const firstText = `${original} Revision-safe.`
  const secondText = `${original} Rebased.`
  const headers = { 'idempotency-key': `artifact-body-${artifact.id}-${revision}-${Date.now()}` }

  try {
    const first = await call('PATCH', `/artifacts/${artifact.id}/content`, {
      block,
      text: firstText,
      expectedRevision: revision,
    }, headers)
    assert.equal(first.status, 200)
    assert.equal(first.json.revision, revision + 1)

    const replay = await call('PATCH', `/artifacts/${artifact.id}/content`, {
      block,
      text: firstText,
      expectedRevision: revision,
    }, headers)
    assert.equal(replay.status, 200)
    assert.equal(replay.json.revision, revision + 1, 'the same logical retry advances once')

    const stale = await call('PATCH', `/artifacts/${artifact.id}/content`, {
      block,
      text: secondText,
      expectedRevision: revision,
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.json.error.code, 'conflict')

    const afterConflict = (await call('GET', '/artifact-content')).json as ArtifactContentLibrary
    const unchanged = afterConflict[artifact.id] ?? afterConflict[artifact.name]
    assert.equal(unchanged?.revision, revision + 1)
    assert.equal(unchanged?.type === 'doc' ? docBlockText(unchanged.blocks[block]!) : undefined, firstText)

    const rebased = await call('PATCH', `/artifacts/${artifact.id}/content`, {
      block,
      text: secondText,
      expectedRevision: revision + 1,
    })
    assert.equal(rebased.status, 200)
    assert.equal(rebased.json.revision, revision + 2)
  } finally {
    await restore(artifact.id, block, original)
  }
})

test('artifact body revision validates its precondition and preserves legacy clients', async () => {
  const { artifact, body, block, text: original } = await editableArtifact()
  const revision = body.revision ?? 0

  const malformed = await call('PATCH', `/artifacts/${artifact.id}/content`, {
    block,
    text: 'No',
    expectedRevision: -1,
  })
  assert.equal(malformed.status, 400)

  try {
    const legacy = await call('PATCH', `/artifacts/${artifact.id}/content`, {
      block,
      text: `${original} Legacy client.`,
    })
    assert.equal(legacy.status, 200)
    assert.equal(legacy.json.revision, revision + 1, 'an unconditional legacy write still advances ordering')
  } finally {
    await restore(artifact.id, block, original)
  }
})

test('saving a document materializes its bounded body atomically with the artifact', async () => {
  const stamp = Date.now().toString(36)
  const name = `authored-${stamp}.md`
  const body = 'The release opens with a truthful first paragraph.\n\nThe second paragraph remains independently editable.'
  const response = await call('POST', '/relations/ops', {
    op: {
      kind: 'save-artifact',
      artifact: { name, kind: 'doc', meta: 'Document', body },
    },
  }, { 'idempotency-key': `authored-document-${stamp}` })
  assert.equal(response.status, 200)

  const artifact = (response.json.extraArtifacts as ArtifactItem[]).find((candidate) => candidate.name === name)
  assert.ok(artifact, 'the acknowledged graph carries the created artifact')
  assert.equal(artifact.excerpt, 'The release opens with a truthful first paragraph.')

  const library = (await call('GET', '/artifact-content')).json as ArtifactContentLibrary
  const stored = library[artifact.id]
  assert.equal(stored?.type, 'doc')
  if (!stored || stored.type !== 'doc') throw new Error('authored body must be a document')
  assert.equal(stored.revision, 0)
  assert.equal(stored.title, `authored-${stamp}`)
  assert.deepEqual(stored.blocks.map(docBlockText), [
    'The release opens with a truthful first paragraph.',
    'The second paragraph remains independently editable.',
  ])
})

test('a document body is validated before the relation graph changes', async () => {
  const before = (await call('GET', '/relations')).json
  const invalid = await call('POST', '/relations/ops', {
    op: {
      kind: 'save-artifact',
      artifact: { name: 'empty.md', kind: 'doc', meta: 'Document', body: '   ' },
    },
  })
  assert.equal(invalid.status, 400)
  assert.match(invalid.json.error.message, /body/i)
  assert.deepEqual((await call('GET', '/relations')).json, before, 'a refused body mints no metadata-only artifact')
})

test('same-source document replay is idempotent only for the same authored body', async () => {
  const stamp = Date.now().toString(36)
  const name = `replay-${stamp}.md`
  const op = {
    kind: 'save-artifact',
    artifact: { name, kind: 'doc', meta: 'Document', body: 'Original body.' },
  }
  const first = await call('POST', '/relations/ops', { op })
  assert.equal(first.status, 200)
  const replay = await call('POST', '/relations/ops', { op })
  assert.equal(replay.status, 200, 'an exact logical replay stays idempotent')

  const collision = await call('POST', '/relations/ops', {
    op: { ...op, artifact: { ...op.artifact, body: 'Different work with the same name.' } },
  })
  assert.equal(collision.status, 409)
  assert.match(collision.json.error.message, /already exists/i)

  const graph = (await call('GET', '/relations')).json
  const artifacts = graph.extraArtifacts as ArtifactItem[]
  assert.equal(artifacts.filter((artifact) => artifact.name === name).length, 1)
  const artifact = artifacts.find((candidate) => candidate.name === name)!
  const library = (await call('GET', '/artifact-content')).json as ArtifactContentLibrary
  const stored = library[artifact.id]
  assert.equal(stored?.type === 'doc' ? docBlockText(stored.blocks[0]!) : undefined, 'Original body.')
})

test('an authored document requires a visible name before graph mutation', async () => {
  const before = (await call('GET', '/relations')).json
  const invalid = await call('POST', '/relations/ops', {
    op: {
      kind: 'save-artifact',
      artifact: { name: '   ', kind: 'doc', meta: 'Document', body: 'Named content.' },
    },
  })
  assert.equal(invalid.status, 400)
  assert.match(invalid.json.error.message, /name/i)
  assert.deepEqual((await call('GET', '/relations')).json, before)
})

test('an authored document canonicalizes its visible name at the server boundary', async () => {
  const stamp = Date.now().toString(36)
  const name = `trimmed-${stamp}.md`
  const response = await call('POST', '/relations/ops', {
    op: {
      kind: 'save-artifact',
      artifact: { name: `  ${name}  `, kind: 'doc', meta: 'Document', body: 'Named content.' },
    },
  })
  assert.equal(response.status, 200)
  const artifact = (response.json.extraArtifacts as ArtifactItem[]).find((candidate) => candidate.name === name)
  assert.ok(artifact, 'the canonical graph never exposes padding around a current document name')
})

test('a malformed save shape is a 400, never an internal error', async () => {
  for (const artifact of [undefined, { name: 42, kind: 'doc', meta: 'Document', body: 'Content.' }]) {
    const response = await call('POST', '/relations/ops', { op: { kind: 'save-artifact', artifact } })
    assert.equal(response.status, 400)
    assert.match(response.json.error.message, /name/i)
  }
})
