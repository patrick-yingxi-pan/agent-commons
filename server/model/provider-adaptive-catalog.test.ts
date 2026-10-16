/** Regression locks for provider-owned adaptive-thinking metadata. The wire
 * capability and caller-authored static catalog are both explicit boundaries:
 * neither model names nor generic thinking support imply adaptive support. */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer, type Server } from 'node:http'
import { fetchProviderModels } from '../generate.ts'
import { providerCatalogModels } from '../routes/providerCatalog.ts'

let server: Server
let baseURL = ''

const wireModels = [
  {
    id: 'claude-opus-4-8',
    display_name: 'Opus with explicit adaptive support',
    capabilities: {
      thinking: { supported: true, types: { adaptive: { supported: true } } },
    },
  },
  {
    id: 'claude-sonnet-4-6',
    display_name: 'Thinking, but no adaptive declaration',
    capabilities: { thinking: { supported: true } },
  },
  {
    id: 'custom-explicit-false',
    capabilities: {
      thinking: { supported: true, types: { adaptive: { supported: false } } },
    },
  },
  {
    id: 'custom-malformed-adaptive',
    capabilities: {
      thinking: { supported: true, types: { adaptive: { supported: 'true' } } },
    },
  },
  {
    id: 'custom-unknown-adaptive-shape',
    capabilities: {
      thinking: { supported: true, types: { adaptive: 'supported' } },
    },
  },
  {
    id: 'custom-parent-disables-thinking',
    capabilities: {
      thinking: { supported: false, types: { adaptive: { supported: true } } },
    },
  },
  { display_name: 'Malformed row without an id', capabilities: { thinking: { supported: true } } },
  null, false, 42, 'not a model',
]

before(async () => {
  server = createServer((request, response) => {
    if (request.url?.split('?')[0] !== '/v1/models') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      data: wireModels,
      has_more: false,
      first_id: wireModels[0].id,
      last_id: 'custom-parent-disables-thinking',
    }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  baseURL = `http://127.0.0.1:${address.port}`
})

after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })

test('listed catalogs normalize only the literal adaptive.supported boolean, row by row', async () => {
  const listed = await fetchProviderModels({ baseURL })
  assert.ok(listed)
  const byId = Object.fromEntries(listed.map((model) => [model.id, model]))

  assert.equal((byId['claude-opus-4-8'].capabilities as Record<string, unknown>).adaptiveThinking, true)
  assert.equal((byId['claude-sonnet-4-6'].capabilities as Record<string, unknown>).adaptiveThinking, undefined,
    'generic thinking support and a Claude-looking name do not infer adaptive support')
  assert.equal((byId['custom-explicit-false'].capabilities as Record<string, unknown>).adaptiveThinking, false,
    'a literal false declaration remains distinct from unknown')
  assert.equal((byId['custom-malformed-adaptive'].capabilities as Record<string, unknown>).adaptiveThinking, undefined)
  assert.equal((byId['custom-unknown-adaptive-shape'].capabilities as Record<string, unknown>).adaptiveThinking, undefined)
  assert.equal((byId['custom-parent-disables-thinking'].capabilities as Record<string, unknown>).adaptiveThinking, undefined,
    'a contradictory child cannot enable adaptive thinking when thinking is explicitly disabled')
  assert.equal(listed.length, 6, 'malformed rows do not discard the six valid catalog rows')
})

test('static catalogs accept explicit adaptiveThinking true and false', () => {
  const models = providerCatalogModels([
    { id: 'adaptive', label: 'Adaptive', capabilities: { thinking: true, adaptiveThinking: true } },
    { id: 'fixed', label: 'Fixed', capabilities: { thinking: true, adaptiveThinking: false } },
  ])
  assert.deepEqual(models.map((model) => model.capabilities), [
    { thinking: true, adaptiveThinking: true },
    { thinking: true, adaptiveThinking: false },
  ])
})

test('static catalogs reject malformed, unknown, and contradictory adaptive metadata', () => {
  for (const capabilities of [
    { adaptiveThinking: 'true' },
    { adaptiveThinking: null },
    { adaptiveThinking: true, experimentalAdaptive: true },
    { thinking: false, adaptiveThinking: true },
  ]) {
    assert.throws(
      () => providerCatalogModels([{ id: 'bad', label: 'Bad', capabilities }]),
      undefined,
      `reject ${JSON.stringify(capabilities)}`,
    )
  }
})
