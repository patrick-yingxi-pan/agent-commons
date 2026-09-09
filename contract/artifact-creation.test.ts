import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ARTIFACT_CREATION_ID_PATTERN,
  ARTIFACT_CREATION_ID_PREFIX,
  isArtifactCreationId,
  type CreateArtifactRequest,
  type CreateArtifactResponse,
} from './artifactCreation.ts'
import { emptyGraph } from './graph.ts'

test('direct Artifact creation exposes one reserved opaque identity schema', () => {
  const id = `${ARTIFACT_CREATION_ID_PREFIX}${'a'.repeat(24)}`
  assert.equal(ARTIFACT_CREATION_ID_PREFIX, 'artifact-new-')
  assert.equal(ARTIFACT_CREATION_ID_PATTERN.test(id), true)
  assert.equal(isArtifactCreationId(id), true)
  for (const invalid of [
    `art-new-${'a'.repeat(24)}`,
    `${ARTIFACT_CREATION_ID_PREFIX}${'A'.repeat(24)}`,
    `${ARTIFACT_CREATION_ID_PREFIX}${'a'.repeat(23)}`,
    `${ARTIFACT_CREATION_ID_PREFIX}${'a'.repeat(25)}`,
    7,
  ]) assert.equal(isArtifactCreationId(invalid), false)
})

test('direct Artifact request and acknowledgement carry authored intent and exact row', () => {
  const request = {
    name: 'review.sheet',
    kind: 'sheet',
    body: { type: 'sheet', columns: ['State'], rows: [['Ready']] },
    projectId: null,
  } satisfies CreateArtifactRequest
  const response = {
    artifact: {
      id: `${ARTIFACT_CREATION_ID_PREFIX}${'b'.repeat(24)}`,
      name: request.name,
      kind: request.kind,
      meta: 'Sheet',
      source: 'Created here',
      projectId: '',
      editedAt: 1,
    },
    graph: emptyGraph(),
  } satisfies CreateArtifactResponse

  assert.equal(request.body.type, 'sheet')
  assert.equal(response.artifact.id, `${ARTIFACT_CREATION_ID_PREFIX}${'b'.repeat(24)}`)
  assert.deepEqual(response.graph.extraArtifacts, [])
})
