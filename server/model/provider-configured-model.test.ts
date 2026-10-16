/** A real Messages fixture without a list API must remain usable everywhere
 * that requires an explicit model. No paid/public endpoint is contacted. */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { Server } from 'node:http'
import { startModelServer } from './index.ts'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'
import { providerModelChoices } from '../../contract/providers.ts'

let server: Server
let baseURL: string
let listed = false

before(async () => {
  server = startModelServer(0, '127.0.0.1')
  const handlers = server.listeners('request')
  server.removeAllListeners('request')
  server.on('request', (request, response) => {
    if (!listed && request.url?.split('?')[0] === '/v1/models') {
      response.writeHead(404).end()
      return
    }
    for (const handler of handlers) handler.call(server, request, response)
  })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  baseURL = `http://127.0.0.1:${address.port}`
})

after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })

test('catalog-less configured IDs survive refresh failure, rotate exactly, and yield to a real catalog', async () => {
  const created = await call('POST', '/providers', {
    label: 'List-less tested endpoint', modelFamily: 'custom', effortLevels: [],
    defaultModelId: 'forged', execution: 'mock',
    config: { baseURL, model: 'exact-configured-id' },
  })
  assert.equal(created.status, 200)
  const provider = created.json
  assert.equal(provider.models, undefined)
  assert.equal(provider.catalogSource, undefined)
  assert.equal(provider.defaultModelId, 'exact-configured-id')
  assert.equal(provider.execution, 'configured')
  assert.deepEqual(providerModelChoices(provider), [{ id: 'exact-configured-id', label: 'exact-configured-id' }])

  const selected = await call('POST', '/sessions', {
    firstMessage: 'Keep this explicit model', providerId: provider.id, modelId: 'exact-configured-id',
  })
  assert.equal(selected.status, 200, JSON.stringify(selected.json))
  const sessionId = selected.json.id
  for (const modelId of ['forged', 'arbitrary-model']) {
    assert.equal((await call('PATCH', `/sessions/${sessionId}`, { modelId })).status, 400)
  }
  const usage = await call('GET', `/usage?session=${sessionId}`)
  assert.equal(usage.json.context.windowTokens, undefined, 'unknown capacity stays unknown')

  const refresh = await call('POST', `/providers/${provider.id}/models/refresh`, { expectedRevision: 0 })
  assert.equal(refresh.status, 400)
  assert.equal(store.getSession(sessionId)?.modelId, 'exact-configured-id')
  assert.equal(store.listProviders().find((row) => row.id === provider.id)?.connectionRevision, 0)

  const rotation = await call('PATCH', `/providers/${provider.id}/connection`, {
    model: 'replacement-id', expectedRevision: 0,
  })
  assert.equal(rotation.status, 200, JSON.stringify(rotation.json))
  assert.equal(rotation.json.defaultModelId, 'replacement-id')
  assert.equal(rotation.json.models, undefined, 'derived choices never enter the catalog')
  assert.equal(store.getSession(sessionId)?.modelId, undefined, 'model-only rotation sweeps stale explicit picks')
  assert.equal((await call('PATCH', `/sessions/${sessionId}`, { modelId: 'exact-configured-id' })).status, 400)
  assert.equal((await call('PATCH', `/sessions/${sessionId}`, { modelId: 'replacement-id' })).status, 200)

  listed = true
  const recovered = await call('POST', `/providers/${provider.id}/models/refresh`, { expectedRevision: 1 })
  assert.equal(recovered.status, 200)
  assert.equal(recovered.json.catalogSource, 'listed')
  assert.ok(recovered.json.models.length > 0)
  assert.equal(store.getSession(sessionId)?.modelId, undefined, 'a real catalog supersedes the fallback')
  assert.equal((await call('PATCH', `/sessions/${sessionId}`, { modelId: 'replacement-id' })).status, 400)
  assert.equal((await call('PATCH', `/sessions/${sessionId}`, { modelId: recovered.json.models[0].id })).status, 200)
})
