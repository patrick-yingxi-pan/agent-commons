/** Catalog enumeration uses only authored loopback peers, never paid providers. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { fetchProviderModels } from '../generate.ts'
import { collectProviderModels } from './providerCatalog.ts'

async function peer(pages: (url: URL, index: number) => unknown, status: (index: number) => number = () => 200) {
  const requests: URL[] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    requests.push(url)
    res.writeHead(status(requests.length - 1), { 'content-type': 'application/json', 'retry-after-ms': '100' })
    res.end(JSON.stringify(pages(url, requests.length - 1)))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    baseURL: `http://127.0.0.1:${address.port}`, requests,
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) },
  }
}

test('Messages catalog follows exact encoded after_id cursors and preserves later metadata', async () => {
  const cursor = 'model/first?&=+ opaque'
  const fixture = await peer((_url, index) => index === 0
    ? { data: [{ id: cursor }], has_more: true, last_id: cursor }
    : { data: [{ id: 'second', display_name: 'Second', max_input_tokens: 200_000,
      capabilities: { thinking: { supported: true, types: { adaptive: { supported: true } } } } }], has_more: false })
  try {
    assert.deepEqual(await fetchProviderModels({ baseURL: fixture.baseURL }), [
      { id: cursor, label: cursor },
      { id: 'second', label: 'Second', contextWindow: 200_000, capabilities: { thinking: true, adaptiveThinking: true } },
    ])
    assert.deepEqual(fixture.requests.map(url => [url.pathname, Object.fromEntries(url.searchParams)]), [
      ['/v1/models', { limit: '100' }], ['/v1/models', { limit: '100', after_id: cursor }],
    ])
  } finally { await fixture.close() }
})

for (const [label, tail] of Object.entries({
  'non-array data': { data: {}, has_more: false },
  'empty continuation': { data: [], has_more: false },
  'missing continuation marker': { data: [{ id: 'second' }] },
  'null continuation marker': { data: [{ id: 'second' }], has_more: null },
  'non-boolean continuation marker': { data: [{ id: 'second' }], has_more: 'false' },
  'missing next cursor': { data: [{ id: 'second' }], has_more: true },
  'mismatched next cursor': { data: [{ id: 'second' }], has_more: true, last_id: 'elsewhere' },
  'repeated cursor': { data: [{ id: 'first' }], has_more: true, last_id: 'first' },
  'duplicate model': { data: [{ id: 'first' }], has_more: false },
})) {
  test(`Messages ${label} refuses the entire partial catalog`, async () => {
    const fixture = await peer((_url, index) => index === 0
      ? { data: [{ id: 'first' }], has_more: true, last_id: 'first' } : tail)
    try {
      assert.equal(await fetchProviderModels({ baseURL: fixture.baseURL }), undefined)
      assert.equal(fixture.requests.length, 2)
    } finally { await fixture.close() }
  })
}

test('Messages endless unique pages stop without publishing the bounded prefix', async () => {
  const fixture = await peer((_url, index) => ({ data: [{ id: `model-${index}` }], has_more: true, last_id: `model-${index}` }))
  try {
    assert.equal(await fetchProviderModels({ baseURL: fixture.baseURL }), undefined)
    assert.equal(fixture.requests.length, 20)
  } finally { await fixture.close() }
})

test('oversized catalog is unavailable rather than truncated', async () => {
  const fixture = await peer(() => ({ data: Array.from({ length: 2_001 }, (_, i) => ({ id: `model-${i}` })), has_more: false }))
  try {
    assert.equal(await fetchProviderModels({ baseURL: fixture.baseURL }), undefined)
    assert.equal(fixture.requests.length, 1)
  } finally { await fixture.close() }
})

test('OpenAI stays a single unpaginated list with unknown capacity', async () => {
  const fixture = await peer(() => ({ object: 'list', data: [{ id: 'native-openai' }] }))
  try {
    assert.deepEqual(await fetchProviderModels({ protocol: 'openai-responses', baseURL: `${fixture.baseURL}/v1`, model: 'native-openai' }),
      [{ id: 'native-openai', label: 'native-openai' }])
    assert.deepEqual(fixture.requests.map(url => [url.pathname, url.search]), [['/v1/models', '']])
  } finally { await fixture.close() }
})

test('legacy compatible Messages endpoints may return one list without pagination metadata', async () => {
  const fixture = await peer(() => ({ data: [{ id: 'compatible-model' }] }))
  try {
    assert.deepEqual(await fetchProviderModels({ protocol: 'anthropic-messages', baseURL: fixture.baseURL }),
      [{ id: 'compatible-model', label: 'compatible-model' }])
    assert.equal(fixture.requests.length, 1)
  } finally { await fixture.close() }
})

for (const has_more of [null, 0, '', 'false', []]) {
  test(`raw SDK pagination refuses malformed first-page marker ${JSON.stringify(has_more)}`, async () => {
    const fixture = await peer(() => ({ data: [{ id: 'first' }], has_more }))
    try {
      assert.equal(await fetchProviderModels({ baseURL: fixture.baseURL }), undefined)
      assert.equal(fixture.requests.length, 1)
    } finally { await fixture.close() }
  })
}

test('twenty completed pages at the raw-row boundary publish, not an arbitrary prefix', async () => {
  let requests = 0
  const result = await collectProviderModels(async (params) => {
    const index = requests++
    assert.deepEqual(params, { limit: 100, ...(index ? { after_id: `model-${index * 100 - 1}` } : {}) })
    return { data: Array.from({ length: 100 }, (_, n) => ({ id: `model-${index * 100 + n}` })),
      has_more: index < 19, last_id: `model-${index * 100 + 99}` }
  }, 'anthropic-messages', new AbortController().signal)
  assert.equal(requests, 20)
  assert.equal(result?.length, 2_000)
  assert.equal(result?.at(-1)?.id, 'model-1999')
})

test('raw-row budget counts malformed entries across pages', async () => {
  let requests = 0
  const result = await collectProviderModels(async () => {
    const index = requests++
    return { data: [...Array.from({ length: 1_000 }, () => null), { id: `model-${index}` }],
      has_more: index === 0, last_id: `model-${index}` }
  }, 'anthropic-messages', new AbortController().signal)
  assert.equal(result, undefined)
  assert.equal(requests, 2)
})

test('every continuation shares the original cancellation signal and a late page cannot publish', async () => {
  const controller = new AbortController()
  let requests = 0
  const result = await collectProviderModels(async (_params, options) => {
    assert.equal(options.signal, controller.signal)
    const index = requests++
    if (index === 1) controller.abort()
    return { data: [{ id: `model-${index}` }], has_more: index === 0, last_id: `model-${index}` }
  }, 'anthropic-messages', controller.signal)
  assert.equal(result, undefined, 'even a completed page is discarded after the original deadline')
  assert.equal(requests, 2)
  let cancelledReads = 0
  assert.equal(await collectProviderModels(async () => { cancelledReads++; return {} },
    'anthropic-messages', controller.signal), undefined)
  assert.equal(cancelledReads, 0, 'cancelled enumeration cannot start')
})

test('the endpoint seam creates one deadline for the entire enumeration', async (t) => {
  const controller = new AbortController()
  const timeout = t.mock.method(AbortSignal, 'timeout', () => controller.signal)
  const fixture = await peer((_url, index) => {
    if (index === 1) controller.abort()
    return { data: [{ id: `model-${index}` }], has_more: index === 0, last_id: `model-${index}` }
  })
  try {
    assert.equal(await fetchProviderModels({ baseURL: fixture.baseURL }), undefined)
    assert.equal(fixture.requests.length, 2)
    assert.equal(timeout.mock.callCount(), 1, 'continuation must not restart the probe deadline')
  } finally { await fixture.close() }
})

for (const protocol of ['anthropic-messages', 'openai-responses'] as const) {
  test(`${protocol} catalog failure does not enter SDK backoff or automatic retry`, async () => {
    const fixture = await peer(() => ({ data: [{ id: 'model' }], has_more: false }), index => index === 0 ? 503 : 200)
    try {
      assert.equal(await fetchProviderModels({ protocol, model: 'model',
        baseURL: `${fixture.baseURL}${protocol === 'openai-responses' ? '/v1' : ''}` }), undefined)
      assert.equal(fixture.requests.length, 1, 'discovery is one attempt per page, not the generation retry budget')
    } finally { await fixture.close() }
  })
}

test('Messages continuation failure also makes only one attempt, without publishing page one', async () => {
  const fixture = await peer((_url, index) => ({ data: [{ id: index === 0 ? 'first' : 'second' }],
    has_more: index === 0, last_id: index === 0 ? 'first' : 'second' }), index => index === 1 ? 503 : 200)
  try {
    assert.equal(await fetchProviderModels({ baseURL: fixture.baseURL }), undefined)
    assert.equal(fixture.requests.length, 2)
  } finally { await fixture.close() }
})
