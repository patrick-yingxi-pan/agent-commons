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
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
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

test('every install recipe is re-run-safe: remove-first guard, scope-pinned, download gated', () => {
  // `claude mcp add` refuses a name that already exists (no overwrite flag), so a
  // recipe that only `add`s errors on the second mint / a connector refresh. Every
  // copy of the recipe in the repo must therefore (a) pin BOTH sides to `-s local`
  // (an unpinned remove wedges on multi-scope state and silently relocates a
  // user-/project-scope install) and (b) guard each add with the fully-silenced
  // remove (its not-found chatter isn't reliably on stderr). The panel's copyable
  // command is additionally locked byte-exact: `curl -fsSL` makes an HTTP error a
  // *failed* download, and the temp-file + `mv` keeps a dropped re-download from
  // truncating the file a working registration points at.
  const RECIPE_FILES = [
    '../src/components/SectionView.tsx',
    '../connector/relay-connector.ts',
    '../docs/delegated-cognition-provider.md',
    '../docs/spec/06-model-and-tools.md',
  ]
  const GUARD = '(claude mcp remove -s local session-relay >/dev/null 2>&1; claude mcp add -s local session-relay'
  // An *invocation* names the server; prose mentions of the bare command don't count.
  const INVOCATION = /claude mcp add(?: -s \S+)? session-relay/g
  for (const file of RECIPE_FILES) {
    const raw = readFileSync(new URL(file, import.meta.url), 'utf8')
    // Unwrap block-comment prefixes and backslash line-continuations, collapse whitespace.
    const text = raw.replace(/^\s*\*\s?/gm, '').replace(/\\\n/g, ' ').replace(/\s+/g, ' ')
    const invocations = text.match(INVOCATION) ?? []
    assert.ok(invocations.length > 0, `${file} lost its install recipe`)
    for (const inv of invocations) {
      assert.equal(inv, 'claude mcp add -s local session-relay', `${file}: install invocation not scope-pinned: '${inv}'`)
    }
    const guarded = text.split(GUARD).length - 1
    assert.equal(guarded, invocations.length, `${file}: ${invocations.length - guarded} of ${invocations.length} install invocations lack the remove-first guard`)
  }
  const panel = readFileSync(new URL('../src/components/SectionView.tsx', import.meta.url), 'utf8')
  assert.ok(
    panel.includes(
      'curl -fsSL ${connectorUrl} -o ~/session-relay.mjs.tmp && mv ~/session-relay.mjs.tmp ~/session-relay.mjs && (claude mcp remove -s local session-relay >/dev/null 2>&1; claude mcp add -s local session-relay -- node ~/session-relay.mjs)',
    ),
    'the panel installCommand drifted from the locked byte-exact shape',
  )
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
