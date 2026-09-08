/** HTTP owner-only display rename: strict metadata CAS, read-wall projection,
 * current export filename, replay identity, and minimal tenant-gated events. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ArtifactItem, ServerEvent } from '../../contract/index.ts'
import { call } from '../testkit/http.ts'
import { buildRouter } from './index.ts'

const OWNER = 'tenant-personal'
const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'

async function createDocument(name: string, tenant = OWNER): Promise<ArtifactItem> {
  const response = await call('POST', '/relations/ops', {
    op: { kind: 'save-artifact', artifact: { name, kind: 'doc', meta: 'Document', body: 'Original body.\n\nSecond block.' }, sessionTitle: 'Metadata route session' },
  }, { 'x-tenant-id': tenant, 'idempotency-key': `artifact-metadata-create-${name}` })
  assert.equal(response.status, 200)
  const row = (response.json.extraArtifacts as ArtifactItem[]).find((artifact) => artifact.name === name)
  assert.ok(row)
  return row
}

async function stream(tenant: string) {
  let body = ''
  let status = 0
  let ended = false
  const callbacks = new Map<string, () => void>()
  const req = {
    method: 'GET', headers: { 'x-tenant-id': tenant },
    on(name: string, callback: () => void) { callbacks.set(name, callback); return req },
  }
  const res = {
    writeHead(value: number) { status = value; return res },
    setHeader() {}, flushHeaders() {}, on() {},
    write(chunk: unknown) { body += String(chunk); return true },
    end() { ended = true },
    get writableEnded() { return ended },
  }
  await buildRouter().handle(req as never, res as never, new URL('http://test/events'))
  assert.equal(status, 200)
  return {
    close: () => callbacks.get('close')?.(),
    events: (): ServerEvent[] => [...body.matchAll(/^data: (.+)$/gm)].flatMap((match) => {
      const event = JSON.parse(match[1])
      return event?.type ? [event] : []
    }),
  }
}

test('artifact metadata route is strict-CAS, owner-only, and projects the current name everywhere', async () => {
  const stamp = Date.now().toString(36)
  const originalName = `metadata-route-${stamp}.md`
  const renamed = `metadata-route-renamed-${stamp}.md`
  const artifact = await createDocument(originalName)
  const grant = await call('POST', '/grants', {
    subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: READER }, tier: 'view',
  }, { 'x-tenant-id': OWNER })
  assert.equal(grant.status, 200)
  const [ownerEvents, readerEvents, foreignEvents] = await Promise.all([stream(OWNER), stream(READER), stream(FOREIGN)])
  try {
    const ownerBefore = await call('GET', `/artifacts/${artifact.id}`, undefined, { 'x-tenant-id': OWNER })
    const readerBefore = await call('GET', `/artifacts/${artifact.id}`, undefined, { 'x-tenant-id': READER })
    assert.equal(ownerBefore.status, 200)
    assert.equal(readerBefore.status, 200)
    assert.equal((ownerBefore.json as ArtifactItem).metadataRevision ?? 0, 0)
    assert.equal((readerBefore.json as ArtifactItem).own, false)

    for (const tenant of [FOREIGN]) {
      assert.equal((await call('GET', `/artifacts/${artifact.id}`, undefined, { 'x-tenant-id': tenant })).status, 404)
      assert.equal((await call('PATCH', `/artifacts/${artifact.id}`, { name: renamed, expectedRevision: 0 }, { 'x-tenant-id': tenant })).status, 404)
    }
    assert.equal((await call('GET', '/artifacts/missing-artifact', undefined, { 'x-tenant-id': OWNER })).status, 404)
    assert.equal((await call('PATCH', `/artifacts/${artifact.id}`, { name: renamed }, { 'x-tenant-id': OWNER })).status, 400)

    const renamedResponse = await call('PATCH', `/artifacts/${artifact.id}`, { name: renamed, expectedRevision: 0 }, { 'x-tenant-id': OWNER })
    assert.equal(renamedResponse.status, 200)
    assert.equal((renamedResponse.json as ArtifactItem).name, renamed)
    assert.equal((renamedResponse.json as ArtifactItem).metadataRevision, 1)
    assert.equal((await call('PATCH', `/artifacts/${artifact.id}`, { name: 'stale.md', expectedRevision: 0 }, { 'x-tenant-id': OWNER })).status, 409)
    assert.equal((await call('PATCH', `/artifacts/${artifact.id}`, { name: renamed, expectedRevision: 1 }, { 'x-tenant-id': OWNER })).status, 200)

    const ownerRow = (await call('GET', `/artifacts/${artifact.id}`, undefined, { 'x-tenant-id': OWNER })).json as ArtifactItem
    const readerRow = (await call('GET', `/artifacts/${artifact.id}`, undefined, { 'x-tenant-id': READER })).json as ArtifactItem
    assert.equal(ownerRow.name, renamed)
    assert.equal(readerRow.name, renamed)
    assert.equal((await call('GET', '/artifacts', undefined, { 'x-tenant-id': READER })).json.find((row: ArtifactItem) => row.id === artifact.id)?.name, renamed)
    assert.equal((await call('GET', `/artifacts/${artifact.id}/export`, undefined, { 'x-tenant-id': READER })).json.filename, renamed)
    assert.equal(JSON.stringify(ownerRow.saveOrigin), JSON.stringify(artifact.saveOrigin))

    const readerHints = readerEvents.events().filter((event) => event.type === 'artifact.changed' && event.artifactId === artifact.id)
    assert.ok(readerHints.length >= 1, 'granted readers receive the minimal artifact invalidation')
    assert.equal(foreignEvents.events().some((event) => event.type === 'artifact.changed' && event.artifactId === artifact.id), false)
    for (const observer of [readerEvents, foreignEvents]) {
      assert.equal(observer.events().some((event) => event.type === 'relation.applied'), false,
        'private relation graph payloads do not cross the artifact read grant')
    }
    for (const event of [...ownerEvents.events(), ...readerEvents.events(), ...foreignEvents.events()]) {
      if (event.type === 'artifact.changed') assert.deepEqual(Object.keys(event).sort(), ['artifactId', 'type'])
      assert.doesNotMatch(JSON.stringify(event), /Original body|Second block|Metadata route session|metadata-route-/)
    }
  } finally {
    ownerEvents.close(); readerEvents.close(); foreignEvents.close()
  }
})

test('save-artifact replay after rename returns the original id and cannot overwrite its display name', async () => {
  const stamp = Date.now().toString(36)
  const originalName = `metadata-replay-${stamp}.md`
  const renamed = `metadata-replay-renamed-${stamp}.md`
  const idempotency = `metadata-replay-create-${stamp}`
  const first = await call('POST', '/relations/ops', {
    op: { kind: 'save-artifact', artifact: { name: originalName, kind: 'doc', meta: 'Document', body: 'Replay body.' }, sessionTitle: 'Replay source' },
  }, { 'x-tenant-id': OWNER, 'idempotency-key': idempotency })
  assert.equal(first.status, 200)
  const created = (first.json.extraArtifacts as ArtifactItem[]).find((row) => row.name === originalName)
  assert.ok(created)
  assert.equal((await call('PATCH', `/artifacts/${created.id}`, { name: renamed, expectedRevision: 0 }, { 'x-tenant-id': OWNER })).status, 200)
  const replay = await call('POST', '/relations/ops', {
    op: { kind: 'save-artifact', artifact: { name: originalName, kind: 'doc', meta: 'Document', body: 'Replay body.' }, sessionTitle: 'Replay source' },
  }, { 'x-tenant-id': OWNER, 'idempotency-key': idempotency })
  assert.equal(replay.status, 200)
  const rows = (await call('GET', '/artifacts', undefined, { 'x-tenant-id': OWNER })).json as ArtifactItem[]
  assert.deepEqual(rows.filter((row) => row.id === created.id).map((row) => row.name), [renamed])
  assert.equal(rows.filter((row) => row.saveOrigin?.name === originalName).length, 1)
})
