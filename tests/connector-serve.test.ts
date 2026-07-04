/** ── Locking tests: the PUBLIC connector install path (spec MODEL-14) ─────────
 *  A hosted user can't run a repo script, so `GET /connector` serves the user-side
 *  connector as ONE self-contained plain-JS module (the checked-in TS with types
 *  erased at request time by `node:module.stripTypeScriptTypes`). The strongest
 *  lock here is behavioral: the byte-for-byte SERVED body is written to disk and
 *  spawned with PLAIN node (no TypeScript, no repo, no npm install), then driven
 *  through the real latch-and-drain protocol against a relay stub — proving the
 *  download-and-run flow a public user follows actually runs. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call, callRaw } from './helpers/http.ts'
import { callTool, spawnConnector, startRelayStub } from './helpers/connector.ts'

async function fetchServedConnector(): Promise<{ body: string; headers: Record<string, string> }> {
  const res = await callRaw('GET', '/connector')
  assert.equal(res.status, 200)
  return { body: res.body, headers: res.headers }
}

test('GET /connector serves a type-stripped, self-contained JS module with download headers', async () => {
  const { body, headers } = await fetchServedConnector()
  assert.match(headers['content-type'] ?? '', /text\/javascript/, 'served as JavaScript')
  assert.match(headers['content-disposition'] ?? '', /attachment.*session-relay\.mjs/, 'a browser click saves session-relay.mjs')
  // Types are erased; the protocol surface survives.
  assert.ok(!body.includes('import type'), 'the type-only contract import is stripped — nothing to resolve outside the file')
  assert.ok(!/^\s*interface\s/m.test(body), 'no interface declarations remain')
  for (const marker of ['respond_and_wait', 'rv_live_', 'prose only']) {
    assert.ok(body.includes(marker), `the served module keeps '${marker}'`)
  }
  // Stable across requests (memoized once per boot — same file every download).
  const again = await fetchServedConnector()
  assert.equal(again.body, body)
})

test('the SERVED bytes run under plain node: latch, refuse a redirect, drain a round-trip', async () => {
  const { body } = await fetchServedConnector()
  const dir = mkdtempSync(join(tmpdir(), 'served-connector-'))
  const script = join(dir, 'session-relay.mjs')
  writeFileSync(script, body)
  const stub = await startRelayStub()
  stub.pollQueue.push({ entryId: 'rve-99', prompt: { system: 'served briefing', messages: [{ role: 'user', text: 'ping?' }] } })
  const c = spawnConnector(script)
  try {
    const init = await c.rpc('initialize', {})
    assert.match((init.result as { instructions?: string })?.instructions ?? '', /never stop the loop on idle/i, 'the standing instruction ships from the served form too')

    const document = await callTool(c, 'start', { url: stub.url, secret: 'rv_live_public' })
    assert.match(document, /entry rve-99/, 'the served connector drains a real prompt')
    assert.equal(stub.seen[0]!.auth, 'Bearer rv_live_public')

    assert.match(await callTool(c, 'start', { url: 'http://attacker.example/v1', secret: 'rv_live_evil' }), /already bound/, 'the first-call latch survives type stripping')
    assert.equal(stub.seen.length, 1, 'the refusal made no network request')

    assert.match(await callTool(c, 'respond_and_wait', { entryId: 'rve-99', answer: 'pong' }), /Nothing pending/)
    const reply = stub.seen.find((s) => s.path === '/v1/relay/reply')
    assert.ok(reply, 'the answer reached the relay')
    assert.deepEqual(JSON.parse(reply.body), { entryId: 'rve-99', completion: 'pong' })
  } finally {
    c.close()
    await stub.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
