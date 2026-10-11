import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { connect } from 'node:net'
import { openMcpOAuthCallback } from './mcpOAuthCallback.mjs'

const issuer = 'https://auth.example'
const parameters = () => ({
  issuer, resource: 'https://mcp.example/mcp', clientId: 'test-native-client', scopes: ['read'],
  metadata: {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
    response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'], authorization_response_iss_parameter_supported: true,
  },
})
const callback = (flow, extra = {}) => `${flow.redirectUri}?${new URLSearchParams({
  state: new URL(flow.authorizationUrl).searchParams.get('state')!, code: 'private-code', iss: issuer, ...extra,
})}`

function send(url: string, options = {}): Promise<{ status: number, headers: object, body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { agent: false, ...options }, incoming => {
      let body = ''
      incoming.setEncoding('utf8')
      incoming.on('data', chunk => { body += chunk })
      incoming.on('end', () => resolve({ status: incoming.statusCode!, headers: incoming.headers, body }))
      incoming.on('error', reject)
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
}

test('real native loopback callback emits one private exchange request and closes its listener', async () => {
  const flow = await openMcpOAuthCallback(parameters())
  try {
    const target = new URL(flow.redirectUri)
    assert.equal(target.hostname, '127.0.0.1')
    assert.ok(Number(target.port) > 0)
    const received = await send(callback(flow))
    assert.equal(received.status, 200)
    assert.equal(received.headers['cache-control'], 'no-store')
    assert.equal(received.headers['referrer-policy'], 'no-referrer')
    assert.match(received.headers['content-security-policy'], /default-src 'none'/)
    assert.equal(received.body, 'Authorization response received. Return to Agent Commons.')
    assert.equal(received.body.includes('private-code'), false)
    const result = await flow.result
    assert.equal(result.endpoint, `${issuer}/token`)
    assert.equal(new URLSearchParams(result.body).get('code'), 'private-code')
    assert.equal(new URLSearchParams(result.body).get('resource'), 'https://mcp.example/mcp')
    await assert.rejects(send(callback(flow)))
  } finally { flow.cancel() }
})

test('wrong host, browser-origin requests, body-bearing methods and unrelated paths do not settle authorization', async () => {
  const flow = await openMcpOAuthCallback(parameters())
  try {
    const valid = callback(flow)
    for (const [url, options] of [
      [valid, { headers: { Host: 'attacker.example' } }],
      [valid, { headers: { Origin: 'https://attacker.example' } }],
      [valid, { method: 'POST' }], [valid, { headers: { 'Content-Length': '1' } }],
      [valid.replace('/oauth/callback?', '/unrelated?'), {}],
      [callback(flow, { state: 'wrong' }), {}], [valid + '&state=ambiguous', {}],
    ]) assert.equal((await send(url, options)).status, 400)
    assert.equal((await send(valid)).status, 200)
    assert.equal(new URLSearchParams((await flow.result).body).get('code'), 'private-code')
  } finally { flow.cancel() }
})

test('issuer mismatch and authorization denial fail closed without reflecting remote prose', async () => {
  for (const mismatch of [true, false]) {
    const flow = await openMcpOAuthCallback(parameters())
    try {
      const url = new URL(callback(flow))
      url.searchParams.delete('code')
      url.searchParams.set('error', 'access_denied')
      url.searchParams.set('error_description', 'private upstream description')
      url.searchParams.set('iss', mismatch ? 'https://wrong.example' : issuer)
      const result = await send(url.href)
      assert.equal(result.status, 400)
      assert.equal(result.body.includes('private upstream'), false)
      await assert.rejects(flow.result, error => error.code === (mismatch ? 'issuer' : 'denied'))
      await assert.rejects(send(callback(flow)))
    } finally { flow.cancel() }
  }
})

test('abort before/after listen and deadline close the exact receiver without a callback result', async () => {
  const stopped = new AbortController(); stopped.abort()
  await assert.rejects(openMcpOAuthCallback(parameters(), { signal: stopped.signal }), error => error.code === 'cancelled')
  const active = new AbortController()
  const flow = await openMcpOAuthCallback(parameters(), { signal: active.signal })
  active.abort()
  await assert.rejects(flow.result, error => error.code === 'cancelled')
  await assert.rejects(send(callback(flow)))
  const expired = await openMcpOAuthCallback(parameters(), { timeoutMs: 1_000 })
  await assert.rejects(expired.result, error => error.code === 'expired')
  await assert.rejects(send(callback(expired)))
  const interrupted = new AbortController()
  const pending = openMcpOAuthCallback(parameters(), { signal: interrupted.signal })
  interrupted.abort()
  await assert.rejects(pending, error => error.code === 'cancelled')
})

test('invalid preparation releases its bound port and incomplete sockets cannot keep cancellation alive', async () => {
  await assert.rejects(openMcpOAuthCallback({ ...parameters(), clientId: '' }), error => error.code === 'request')
  const flow = await openMcpOAuthCallback(parameters())
  const socket = connect(Number(new URL(flow.redirectUri).port), '127.0.0.1')
  try {
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
    socket.write('GET /oauth/callback HTTP/1.1\r\n')
    const closed = new Promise<void>(resolve => socket.once('close', () => resolve()))
    flow.cancel()
    await assert.rejects(flow.result, error => error.code === 'cancelled')
    await closed
    await assert.rejects(send(callback(flow)))
  } finally { socket.destroy(); flow.cancel() }
})
