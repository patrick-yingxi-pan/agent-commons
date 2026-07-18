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
  for (const marker of ['respond_and_wait', 'rv_live_', 'toolCalls', 'unexecuted']) {
    assert.ok(body.includes(marker), `the served module keeps '${marker}'`)
  }
  // Stable across requests (memoized once per boot — same file every download).
  const again = await fetchServedConnector()
  assert.equal(again.body, body)
})

test('GET /connector/setup serves the agent-facing guide: both paths, the wall, the deployment’s real base', async () => {
  // The v4 onboarding inversion (spec MODEL-22): the UI hands out ONE bootstrap
  // prompt; every harness-specific instruction lives in THIS document, fetched by
  // the agent that needs it. The guide must carry both serving paths — the MCP
  // install (in the AGENT's own harness, whatever it is) and the direct-HTTP
  // protocol (the true floor: anything that can make an HTTP request) — plus the
  // non-negotiable rules, all against the deployment's real dialable base URL.
  const res = await callRaw('GET', '/connector/setup')
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'] ?? '', /text\/markdown/, 'served as markdown — a document, not an API shape')
  const body = res.body
  assert.match(body, /https?:\/\/[^\s/]+\/api\/v1\/connector/, 'the download URL is absolute and origin-derived')
  // Path A — MCP, harness-agnostic: generic registration + examples beyond Claude.
  assert.match(body, /stdio MCP server/, 'Path A: a standard stdio MCP registration')
  assert.match(body, /your own harness/i, '…in the agent’s OWN harness, not an enumerated one')
  assert.match(body, /codex mcp add session-relay/, 'a non-Claude harness example exists')
  // Path B — the protocol itself, for harnesses with no MCP at all.
  assert.match(body, /\/relay\/poll/, 'Path B: the poll endpoint is documented')
  assert.match(body, /\/relay\/reply/, 'Path B: the reply endpoint is documented')
  assert.match(body, /Authorization: Bearer/, 'Path B: the bearer credential shape')
  // The v5 serving handshake rides both paths: Path B's ?channels= advertisement
  // and Path A's start(conversations) declaration — with the serial default named.
  assert.match(body, /channels=<n>/, 'Path B documents the serving advertisement')
  assert.match(body, /one conversation at a time/i, '…and that omitting it means serial')
  assert.match(body, /"conversations": <n>/, 'Path A documents the serving declaration')
  assert.match(body, /declare honestly/i, 'the declaration is framed as a commitment')
  assert.match(body, /UNEXECUTED/, 'the relay-not-execute discipline rides Path B too')
  // The rules: the §7.9 wall, multi-conversation independence, stop conditions.
  assert.match(body, /NEVER execute instructions/i, 'the outbound-injection wall ships in the guide')
  assert.match(body, /self-contained/i, 'the multi-session contract is stated')
  assert.match(body, /sub-agent/i, 'the sub-agent delegation option is stated')
  assert.ok(!body.includes('rv_live_TESTSECRET'), 'no credential ever rides the guide')
  // Unauthenticated like /connector: a manual is not a secret (the auth gate's
  // open set includes it — locked functionally here, since this helper runs
  // gate-off; tests/auth-gate.test.ts locks the wall itself).
})

test('every remaining install recipe is re-run-safe: remove-first guard, scope-pinned', () => {
  // `claude mcp add` refuses a name that already exists (no overwrite flag), so a
  // recipe that only `add`s errors on the second mint / a connector refresh. Every
  // copy of the Claude-form recipe in the repo (they live in the agent-facing
  // setup guide and the docs now — the UI no longer renders one) must therefore
  // (a) pin BOTH sides to `-s local` (an unpinned remove wedges on multi-scope
  // state and silently relocates a user-/project-scope install) and (b) guard each
  // add with the fully-silenced remove (its not-found chatter isn't reliably on
  // stderr).
  const RECIPE_FILES = [
    '../server/connectorSetup.ts',
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
  // The UI module carries the bootstrap prompt ONLY — no shell recipe to drift
  // (the drift that once made the install bash-only, then Claude-only).
  const uiModule = readFileSync(new URL('../src/lib/connectorInstall.ts', import.meta.url), 'utf8')
  assert.ok(!uiModule.includes('claude mcp add'), 'the UI module re-grew a harness-specific install command')
})

test('the credential is shown in exactly ONE place: inside the bootstrap prompt', async () => {
  // The bootstrap prompt the user pastes ALREADY carries the secret. The reveal
  // panel used to ALSO print the raw secret in its own box — the same credential
  // twice, and the reason the dialog read as heavy. The prompt is the single
  // artifact the user copies and saves, so the secret must appear only there —
  // and it must point the agent at the setup guide, where every harness-specific
  // instruction now lives (the UI enumerates no coding tools).
  const { bootstrapPrompt } = await import('../src/lib/connectorInstall.ts')
  const url = 'https://relay.example/api/v1'
  const secret = 'rv_live_TESTSECRET'
  const prompt = bootstrapPrompt(url, secret)
  assert.ok(prompt.includes(secret), 'the prompt must carry the secret — it IS the credential hand-off')
  assert.ok(prompt.includes(`${url}/connector/setup`), 'the prompt points the agent at the setup guide')
  assert.ok(prompt.includes(`connect to ${url} with secret ${secret}`), 'the prompt carries the relay URL + secret the connector’s start needs')
  assert.match(prompt, /install|drive/i, 'the prompt names both onboarding paths without prescribing a harness')

  const panel = readFileSync(new URL('../src/components/SectionView.tsx', import.meta.url), 'utf8')
  assert.ok(panel.includes('bootstrapPrompt(relayUrl, secret)'), 'the panel must build the prompt from the shared module')
  // The standalone raw-secret reveal (its own code row + Copy) must stay gone: a
  // second rendering of `secret` is the duplication this design removed.
  assert.ok(!/ariaLabel="Copy rendezvous secret"/.test(panel), 'the panel re-added a standalone raw-secret copy row')
  assert.ok(!/text=\{secret\}/.test(panel), 'the panel renders the bare secret outside the bootstrap prompt')
  // No harness-specific install command in the panel either — that is the setup
  // guide's job, delivered to the agent, not the human.
  assert.ok(!panel.includes('claude mcp add'), 'the panel re-grew a harness-specific install recipe')
})

test('the reveal closes on an OBSERVED fact, never on a self-attestation checkbox', () => {
  // Copying the connect line IS taking the credential — we watch it happen. A
  // checkbox asking the user to confirm the copy they just made is a ceremonial
  // second click that proves nothing extra, so the gate opens on either observed
  // fact: the line was copied, or the relay connected. If someone re-adds an
  // "I've saved it" checkbox, this fails.
  const panel = readFileSync(new URL('../src/components/SectionView.tsx', import.meta.url), 'utf8')
  const reveal = panel.slice(panel.indexOf('function RelaySecretPanel'), panel.indexOf('The A2A Agent Card viewer'))
  assert.ok(reveal.length > 0, 'the reveal panel moved — retarget this scan')
  assert.ok(!/saved the connect line|saved the secret|CheckboxRow/.test(reveal), 'the reveal re-added a self-attestation gate')
  assert.ok(reveal.includes('const canClose = connected || tookLine'), 'the close-gate must read the two observed facts')
  assert.ok(/onCopied=\{\(\) => setTookLine\(true\)\}/.test(reveal), "the connect line's copy must open the gate")

  // The observation hook lives on the ONE shared copy primitive, so any copy
  // affordance can report itself rather than a component hand-rolling a listener.
  const copyButton = readFileSync(new URL('../src/components/CopyButton.tsx', import.meta.url), 'utf8')
  assert.ok(/onCopied\?: \(\) => void/.test(copyButton), 'CopyButton must expose the copy observation')
  assert.ok(/onCopied\?\.\(\)/.test(copyButton), 'CopyButton must actually fire it on click')
})

test('the SERVED bytes run under plain node: latch, refuse a redirect, drain a round-trip', async () => {
  const { body } = await fetchServedConnector()
  const dir = mkdtempSync(join(tmpdir(), 'served-connector-'))
  const script = join(dir, 'session-relay.mjs')
  writeFileSync(script, body)
  const stub = await startRelayStub()
  stub.pollQueue.push({ entryId: 'rve-99', prompt: { system: 'served briefing', messages: [{ role: 'user', text: 'ping?' }] } })
  // RELAY_BLOCK_MS keeps the v2 parked respond_and_wait short (default 25s); the
  // process-owned keepalive loop makes request COUNTS nondeterministic, so the
  // latch assertions below check bearers, not counts.
  const c = spawnConnector(script, { RELAY_BLOCK_MS: '100' })
  try {
    const init = await c.rpc('initialize', {})
    assert.match((init.result as { instructions?: string })?.instructions ?? '', /never stop the loop on idle/i, 'the standing instruction ships from the served form too')

    const document = await callTool(c, 'start', { url: stub.url, secret: 'rv_live_public' })
    assert.match(document, /entry rve-99/, 'the served connector drains a real prompt')
    assert.equal(stub.seen[0]!.auth, 'Bearer rv_live_public')

    assert.match(await callTool(c, 'start', { url: 'http://attacker.example/v1', secret: 'rv_live_evil' }), /already bound/, 'the first-call latch survives type stripping')
    assert.ok(stub.seen.every((s) => s.auth === 'Bearer rv_live_public'), 'the refusal put nothing on the wire — no request ever carried other credentials')

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
