/** PATCH /artifacts/:id/content is the owner's durable body-edit seam. The
 *  body revision orders concurrent rewrites while legacy unconditional clients
 *  remain compatible and every accepted write advances the same counter. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { docBlockText, type ArtifactContent, type ArtifactContentLibrary, type ArtifactItem } from '../../contract/index.ts'
import { call } from '../testkit/http.ts'
import { store } from '../store/index.ts'

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
  const current = (await call('GET', '/artifact-content')).json as ArtifactContentLibrary
  const expectedRevision = current[artifactId]?.revision ?? 0
  const restored = await call('PATCH', `/artifacts/${artifactId}/content`, { block, text, expectedRevision })
  assert.equal(restored.status, 200, 'test restores the authored prose for later suites')
}

test('artifact body PATCH refuses a stale revision and replays one logical retry', async (t) => {
  const { artifact, body, block, text: original } = await editableArtifact()
  const revision = body.revision ?? 0
  const firstText = `${original} Revision-safe.`
  const secondText = `${original} Rebased.`
  const headers = { 'idempotency-key': `artifact-body-${artifact.id}-${revision}-${Date.now()}` }
  const editNow = artifact.editedAt + 1_000
  t.mock.method(Date, 'now', () => editNow)

  try {
    const first = await call('PATCH', `/artifacts/${artifact.id}/content`, {
      block,
      text: firstText,
      expectedRevision: revision,
    }, headers)
    assert.equal(first.status, 200)
    assert.equal(first.json.revision, revision + 1)
    const afterFirst = ((await call('GET', '/artifacts')).json as ArtifactItem[]).find((row) => row.id === artifact.id)
    assert.ok(afterFirst)
    assert.equal(afterFirst.editedAt, editNow, 'the canonical artifact row reflects the accepted body edit')
    assert.equal(store.artifactHistoryPage(artifact.id, store.identity({}).tenant.id)?.versions[0]?.savedAt,
      new Date(editNow).toISOString(), 'the retained version shares the body edit commit timestamp')

    const replay = await call('PATCH', `/artifacts/${artifact.id}/content`, {
      block,
      text: firstText,
      expectedRevision: revision,
    }, headers)
    assert.equal(replay.status, 200)
    assert.equal(replay.json.revision, revision + 1, 'the same logical retry advances once')
    const afterReplay = ((await call('GET', '/artifacts')).json as ArtifactItem[]).find((row) => row.id === artifact.id)
    assert.equal(afterReplay?.editedAt, afterFirst.editedAt, 'the same logical retry does not invent another edit time')

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
  const tenant = store.defaultTenantId()
  const stamp = Date.now().toString(36)
  const created = await call('POST', '/artifacts', {
    name: `legacy-client-${stamp}.md`, kind: 'doc', body: 'A fresh identified body for an old client.',
  }, { 'x-tenant-id': tenant, 'idempotency-key': `legacy-client-${stamp}` })
  assert.equal(created.status, 201)
  const artifact = created.json.artifact as ArtifactItem
  const library = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': tenant })).json as ArtifactContentLibrary
  const body = library[artifact.id]!
  const block = 0
  const original = body.type === 'doc' ? docBlockText(body.blocks[block]!)! : ''
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
    const current = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': tenant })).json as ArtifactContentLibrary
    await call('PATCH', `/artifacts/${artifact.id}/content`, {
      block, text: original, expectedRevision: current[artifact.id]?.revision ?? revision,
    }, { 'x-tenant-id': tenant })
  }
})

test('stable blockId prose edits require CAS, resolve the exact current h/p block, and preserve identity', async () => {
  const { artifact, body } = await editableArtifact()
  const doc = body as Extract<ArtifactContent, { type: 'doc' }>
  const index = doc.blocks.findIndex((candidate) => 'p' in candidate || 'h' in candidate)
  assert.ok(index >= 0)
  const target = doc.blocks[index]!
  const blockId = target.id
  assert.ok(blockId)
  const original = docBlockText(target)!
  const revision = body.revision ?? 0
  const headers = { 'idempotency-key': `stable-block-edit-${artifact.id}-${Date.now()}` }

  const noCas = await call('PATCH', `/artifacts/${artifact.id}/content`, { blockId, text: 'No implicit rebase.' }, headers)
  assert.equal(noCas.status, 400)
  const mixedAddress = await call('PATCH', `/artifacts/${artifact.id}/content`, {
    block: index, blockId, text: 'Ambiguous target.', expectedRevision: revision,
  })
  assert.equal(mixedAddress.status, 400)
  const extraField = await call('PATCH', `/artifacts/${artifact.id}/content`, {
    blockId, text: 'No unknown fields.', expectedRevision: revision, extra: true,
  })
  assert.equal(extraField.status, 400)
  const wrongBlock = await call('PATCH', `/artifacts/${artifact.id}/content`, {
    blockId: 'unknown-block-id', text: 'Must not land on a neighbor.', expectedRevision: revision,
  })
  assert.equal(wrongBlock.status, 400)

  try {
    const changed = await call('PATCH', `/artifacts/${artifact.id}/content`, {
      blockId, text: `${original} Stable identity.`, expectedRevision: revision,
    })
    assert.equal(changed.status, 200)
    const current = (await call('GET', '/artifact-content')).json as ArtifactContentLibrary
    const saved = current[artifact.id] as Extract<ArtifactContent, { type: 'doc' }>
    assert.equal(saved.blocks[index]?.id, blockId)
    assert.equal(docBlockText(saved.blocks[index]!), `${original} Stable identity.`)
  } finally {
    const current = (await call('GET', '/artifact-content')).json as ArtifactContentLibrary
    const saved = current[artifact.id]
    await call('PATCH', `/artifacts/${artifact.id}/content`, {
      blockId, text: original, expectedRevision: saved?.revision ?? revision,
    })
  }
})

test('complete Document replacements preserve IDs through reorder and never reuse retired IDs', async () => {
  const { artifact, body } = await editableArtifact()
  const initial = body as Extract<ArtifactContent, { type: 'doc' }>
  const originalIds = initial.blocks.map((block) => block.id)
  assert.ok(originalIds.every((id) => typeof id === 'string'))
  const firstRevision = body.revision ?? 0
  const insertedId = `inserted-${Date.now().toString(36)}`
  const reordered = {
    type: 'doc' as const,
    title: initial.title,
    blocks: [
      { id: insertedId, ul: ['A newly inserted list item.'] },
      ...[...initial.blocks].reverse(),
    ],
  }
  const first = await call('PATCH', `/artifacts/${artifact.id}/content`, {
    content: reordered, expectedRevision: firstRevision,
  })
  assert.equal(first.status, 200)
  assert.equal(first.json.revision, firstRevision + 1)
  assert.equal(first.json.blocks[0].id, insertedId)
  assert.deepEqual(first.json.blocks.slice(1).map((block: { id: string }) => block.id), [...originalIds].reverse())
  const nonProsePatch = await call('PATCH', `/artifacts/${artifact.id}/content`, {
    blockId: insertedId, text: 'Lists are not inline prose targets.', expectedRevision: firstRevision + 1,
  })
  assert.equal(nonProsePatch.status, 400, 'stable prose patches address only h/p blocks')
  const legacyAfterReorder = await call('PATCH', `/artifacts/${artifact.id}/content`, {
    block: 1, text: 'Must not address the new occupant without a revision.',
  })
  assert.equal(legacyAfterReorder.status, 409, 'an index without CAS is refused after identity order changes')

  const removeInserted = {
    type: 'doc' as const,
    title: first.json.title,
    blocks: first.json.blocks.slice(1),
  }
  const second = await call('PATCH', `/artifacts/${artifact.id}/content`, {
    content: removeInserted, expectedRevision: firstRevision + 1,
  })
  assert.equal(second.status, 200)
  const reused = await call('PATCH', `/artifacts/${artifact.id}/content`, {
    content: { ...removeInserted, blocks: [{ id: insertedId, p: 'Trying to reuse a retired identity.' }, ...removeInserted.blocks] },
    expectedRevision: firstRevision + 2,
  })
  assert.equal(reused.status, 400, 'retained history makes a deleted identity unavailable for reuse')
  const current = (await call('GET', '/artifact-content')).json as ArtifactContentLibrary
  assert.deepEqual(current[artifact.id], second.json, 'rejected identity reuse leaves the saved body untouched')
  const restored = await call('PATCH', `/artifacts/${artifact.id}/content`, {
    content: { type: 'doc', title: initial.title, blocks: initial.blocks },
    expectedRevision: firstRevision + 2,
  })
  assert.equal(restored.status, 200, 'the fixture is restored without inventing new block identities')
})

test('stable-ID prose edits still target the same block after reorder', async () => {
  const tenant = store.defaultTenantId()
  const stamp = Date.now().toString(36)
  const created = await call('POST', '/artifacts', {
    name: `reordered-inline-${stamp}.md`, kind: 'doc', body: 'First target.\n\nSecond stays put.',
  }, { 'x-tenant-id': tenant, 'idempotency-key': `reordered-inline-${stamp}` })
  assert.equal(created.status, 201)
  const id = created.json.artifact.id
  const library = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': tenant })).json as ArtifactContentLibrary
  const initial = library[id] as Extract<ArtifactContent, { type: 'doc' }>
  const targetId = initial.blocks[0]!.id!
  const moved = await call('PATCH', `/artifacts/${id}/content`, {
    content: { type: 'doc', title: initial.title, blocks: [...initial.blocks].reverse() },
    expectedRevision: initial.revision ?? 0,
  }, { 'x-tenant-id': tenant })
  assert.equal(moved.status, 200)
  const patched = await call('PATCH', `/artifacts/${id}/content`, {
    blockId: targetId, text: 'First target edited after reorder.', expectedRevision: moved.json.revision,
  }, { 'x-tenant-id': tenant })
  assert.equal(patched.status, 200)
  assert.equal(patched.json.blocks[0].p, 'Second stays put.')
  assert.equal(patched.json.blocks[1].id, targetId)
  assert.equal(patched.json.blocks[1].p, 'First target edited after reorder.')
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

test('saving an authored document also makes it visible through the canonical artifact list', async () => {
  const stamp = Date.now().toString(36)
  const tenant = 'tenant-personal'
  const name = `listed-route-${stamp}.md`
  const body = 'The route-created document must appear in the artifact registry.'
  const saved = await call('POST', '/relations/ops', {
    op: {
      kind: 'save-artifact',
      artifact: { name, kind: 'doc', meta: 'Document', body },
      projectId: 'p-insights',
      projectName: 'Insights dashboard',
    },
  }, { 'x-tenant-id': tenant, 'idempotency-key': `listed-route-${stamp}` })
  assert.equal(saved.status, 200)
  const created = (saved.json.extraArtifacts as ArtifactItem[]).find((artifact) => artifact.name === name)
  assert.ok(created, 'the acknowledged graph carries the strict authored row')

  const listed = await call('GET', '/artifacts', undefined, { 'x-tenant-id': tenant })
  assert.equal(listed.status, 200)
  const row = (listed.json as ArtifactItem[]).find((artifact) => artifact.id === created.id)
  assert.ok(row, 'GET /artifacts includes the authored row')
  assert.equal(row?.own, true)
  assert.equal(row?.projectId, 'p-insights', 'the canonical row retains its project filing')

  const moved = await call('POST', '/relations/ops', {
    op: {
      kind: 'refile-artifact', artifactId: created.id, artifactName: name,
      projectId: 'p-infra', projectName: 'Platform hardening',
    },
  }, { 'x-tenant-id': tenant, 'idempotency-key': `listed-route-refile-${stamp}` })
  assert.equal(moved.status, 200)
  const movedRow = ((await call('GET', '/artifacts', undefined, { 'x-tenant-id': tenant })).json as ArtifactItem[]).find((artifact) => artifact.id === created.id)
  assert.equal(movedRow?.projectId, 'p-infra', 'the canonical route row follows a refile')

  const unfiled = await call('POST', '/relations/ops', {
    op: {
      kind: 'refile-artifact', artifactId: created.id, artifactName: name,
      projectId: null, projectName: 'Platform hardening',
    },
  }, { 'x-tenant-id': tenant, 'idempotency-key': `listed-route-unfile-${stamp}` })
  assert.equal(unfiled.status, 200)
  const unfiledRow = ((await call('GET', '/artifacts', undefined, { 'x-tenant-id': tenant })).json as ArtifactItem[]).find((artifact) => artifact.id === created.id)
  assert.equal(unfiledRow?.projectId, '', 'the canonical route row preserves explicit unfiled state')
})

test('canonical artifact listing keeps a foreign authored row hidden', async () => {
  const stamp = Date.now().toString(36)
  const owner = 'tenant-personal'
  const bystander = 'tenant-beta'
  const name = `private-route-${stamp}.md`
  const saved = await call('POST', '/relations/ops', {
    op: {
      kind: 'save-artifact',
      artifact: { name, kind: 'doc', meta: 'Document', body: 'Private authored body.' },
    },
  }, { 'x-tenant-id': owner, 'idempotency-key': `private-route-${stamp}` })
  assert.equal(saved.status, 200)
  const created = (saved.json.extraArtifacts as ArtifactItem[]).find((artifact) => artifact.name === name)
  assert.ok(created)

  const listed = await call('GET', '/artifacts', undefined, { 'x-tenant-id': bystander })
  assert.equal(listed.status, 200)
  assert.equal((listed.json as ArtifactItem[]).some((artifact) => artifact.id === created.id), false)
})

test('a granted authored route row redacts tenant identity and revocation removes its body projection', async () => {
  const stamp = Date.now().toString(36)
  const owner = 'tenant-personal'
  const audience = 'tenant-beta'
  const name = `shared-route-${stamp}.md`
  const saved = await call('POST', '/relations/ops', {
    op: { kind: 'save-artifact', artifact: { name, kind: 'doc', meta: 'Document', body: 'Shared route body.' } },
  }, { 'x-tenant-id': owner, 'idempotency-key': `shared-route-${stamp}` })
  assert.equal(saved.status, 200)
  const created = (saved.json.extraArtifacts as ArtifactItem[]).find((artifact) => artifact.name === name)
  assert.ok(created)
  const grant = await call('POST', '/grants', {
    subject: { kind: 'artifact', id: created.id }, audience: { kind: 'org', orgId: audience }, tier: 'view',
  }, { 'x-tenant-id': owner })
  assert.equal(grant.status, 200)

  const ownerRow = ((await call('GET', '/artifacts', undefined, { 'x-tenant-id': owner })).json as ArtifactItem[]).find((artifact) => artifact.id === created.id)
  const sharedRow = ((await call('GET', '/artifacts', undefined, { 'x-tenant-id': audience })).json as ArtifactItem[]).find((artifact) => artifact.id === created.id)
  assert.equal(ownerRow?.tenantId, owner, 'the owner retains its tenant stamp')
  assert.equal(sharedRow?.tenantId, undefined, 'a grant-only row redacts the owner tenant stamp')
  const sharedBody = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': audience })).json as ArtifactContentLibrary
  assert.ok(sharedBody[created.id], 'the granted reader receives the authored body')

  assert.equal((await call('DELETE', `/grants/${grant.json.id}`, undefined, { 'x-tenant-id': owner })).status, 200)
  const revokedBody = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': audience })).json as ArtifactContentLibrary
  assert.equal(revokedBody[created.id], undefined, 'revocation removes the authored body projection')
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
