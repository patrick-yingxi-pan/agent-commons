import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { call } from '../testkit/http.ts'
import { originAllowed } from './origin.ts'

test('a pinned origin walls every ordinary API route, not only MCP', async (t) => {
  process.env.CORS_ORIGIN = 'https://app.example'
  t.after(() => delete process.env.CORS_ORIGIN)

  const refused = await call('GET', '/capabilities', undefined, { origin: 'https://evil.example' })
  assert.equal(refused.status, 403)
  assert.equal(refused.json.error.code, 'forbidden')

  const matching = await call('GET', '/capabilities', undefined, { origin: 'https://app.example' })
  assert.equal(matching.status, 200)
  const machine = await call('GET', '/capabilities')
  assert.equal(machine.status, 200, 'native and non-browser callers send no Origin')
})

test('wildcard development policy remains permissive, while preflight uses the same predicate', () => {
  assert.equal(originAllowed({ origin: 'https://anything.example' }, { CORS_ORIGIN: '*' }), true)
  assert.equal(originAllowed({ origin: 'https://evil.example' }, { CORS_ORIGIN: 'https://app.example' }), false)
  assert.equal(originAllowed({ origin: 'https://app.example' }, { CORS_ORIGIN: 'https://app.example' }), true)
  assert.equal(originAllowed({}, { CORS_ORIGIN: 'https://app.example' }), true)
})

test('the socket and router re-entry funnels both enforce the shared origin policy', () => {
  const entry = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
  const routes = readFileSync(new URL('../routes/index.ts', import.meta.url), 'utf8')
  assert.ok(entry.includes('if (!enforceOrigin(req, res)) return'), 'socket traffic is checked before preflight and routing')
  assert.ok(routes.includes('r.use((ctx) => enforceOrigin(ctx.req, ctx.res))'), 'router re-entry carries the same wall')
})
