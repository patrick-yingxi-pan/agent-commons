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
