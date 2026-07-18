/** ── Locking test: the reader-facing relay primer stays true ─────────────────
 *  docs/session-relay-primer.md explains the Session-relay connector from zero
 *  and promises, in its own header, to stay in sync with behavior. This test is
 *  that promise, mechanized: the load-bearing facts the primer states (defaults,
 *  clamps, tool names, endpoints, the security walls) are read FROM THE SOURCE
 *  and asserted to appear in the primer — so changing the relay without updating
 *  the primer fails here, with a message naming the stale section. The
 *  cross-links are locked too: the files whose changes should force a primer
 *  update must point at it, and it must point back at the deep docs. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const primer = read('../docs/session-relay-primer.md')

test('the primer states the CURRENT defaults — read from the source, not hardcoded', () => {
  const connector = read('../connector/relay-connector.ts')
  const relay = read('../server/relay.ts')

  const conv = connector.match(/const DEFAULT_CONVERSATIONS = (\d+)/)?.[1]
  assert.ok(conv, 'DEFAULT_CONVERSATIONS moved — retarget this scan')
  assert.ok(primer.includes(`connector default ${conv}`), `primer §6 must state the connector's declaration default (${conv})`)

  const cap = relay.match(/RELAY_MAX_INFLIGHT, (\d+)/)?.[1]
  assert.ok(cap, 'the RELAY_MAX_INFLIGHT default moved — retarget this scan')
  assert.ok(primer.includes(`RELAY_MAX_INFLIGHT (default ${cap})`), `primer §6 must state the server cap default (${cap})`)

  const timeoutMs = relay.match(/RELAY_TIMEOUT_MS, ([\d_]+)/)?.[1]?.replaceAll('_', '')
  assert.ok(timeoutMs, 'the RELAY_TIMEOUT_MS default moved — retarget this scan')
  assert.ok(primer.includes(`default ${Number(timeoutMs) / 1000} s`), `primer §10 must state the turn deadline (${Number(timeoutMs) / 1000} s)`)

  const clampMax = connector.match(/clampConversations = \(n: number\): number => Math\.max\(1, Math\.min\((\d+)/)?.[1]
  assert.ok(clampMax, 'the declaration clamp moved — retarget this scan')
  assert.ok(primer.includes(`1–${clampMax}`), `primer §6 must state the declaration clamp (1–${clampMax})`)
})

test('the primer covers the live protocol surface: tools, endpoints, handshakes, walls', () => {
  // The three connector tools, by their real names.
  for (const tool of ['`start`', '`respond_and_wait`', '`refresh`']) {
    assert.ok(primer.includes(tool), `primer must name the ${tool} tool`)
  }
  // The wire the far side actually touches.
  for (const marker of ['?channels=', '?have=', 'rv_live_', '/connector/setup', 'GET /connector', 'entryId']) {
    assert.ok(primer.includes(marker), `primer must mention ${marker}`)
  }
  // The three handshake layers, the fan-out default, and the walls.
  assert.match(primer, /Advertised.*\n?.*protocol layer/i, 'the advertisement layer is explained')
  assert.match(primer, /Declared.*\n?.*cognition layer/i, 'the declaration layer is explained')
  assert.match(primer, /Observed.*\n?.*user-facing layer/i, 'the observed layer is explained')
  assert.match(primer, /delegate to sub-agents by default/i, 'the default serving mode is stated')
  assert.match(primer, /relay, never execute|relay-not-execute/i, 'the tool-relay wall is stated')
  assert.match(primer, /latch/i, 'the first-call latch is stated')
  assert.match(primer, /superseded/, 'the stop conditions are covered')
})

test('the primer is cross-linked: deep docs from it, and back-pointers from the files that change behavior', () => {
  // Primer → the deep docs.
  assert.ok(primer.includes('delegated-cognition-provider.md'), 'primer must link the design log')
  assert.ok(primer.includes('spec/06-model-and-tools.md'), 'primer must link the requirement ledger')
  // Behavior-owning files → primer (the "update me too" pointer).
  for (const file of ['../connector/relay-connector.ts', '../server/connectorSetup.ts', '../docs/delegated-cognition-provider.md', '../AGENTS.md']) {
    assert.ok(read(file).includes('session-relay-primer.md'), `${file.replace('../', '')} must point at the primer so edits there prompt a primer update`)
  }
})
