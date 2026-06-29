/** The opt-in prompt-fit probe route (docs/agent-commons.md, D10/OQ5) — POST
 *  /system-prompts/:id/probe scores a library prompt against a chosen provider's model
 *  family (the default when absent). The static tag stays the default; this is the deeper,
 *  opt-in upgrade. Mock fulfilment (a deterministic score); the seam is real. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

test('POST /system-prompts/:id/probe scores the prompt against the default provider family', async () => {
  // A claude-authored prompt on the default (claude) provider → a matched, strong pairing.
  const strong = await call('POST', '/system-prompts/sp-concise-reviewer/probe', {})
  assert.equal(strong.status, 200)
  assert.equal(strong.json.verdict, 'strong')
  assert.ok(strong.json.score >= 85)

  // An open-authored prompt on the default (claude) provider → a mismatch: weaker overall,
  // with tool-use fidelity called out — the deeper signal the binary tag cannot give.
  const weak = await call('POST', '/system-prompts/sp-open-generalist/probe', {})
  assert.equal(weak.status, 200)
  assert.ok(weak.json.score < strong.json.score, 'a mismatch scores lower than a match')
  assert.ok(
    weak.json.aspects.some((a: any) => a.name === 'tool-use fidelity' && a.score < 70),
    'tool-use fidelity is surfaced as the weak point',
  )

  // An unknown prompt → 404.
  const missing = await call('POST', '/system-prompts/sp-ghost/probe', {})
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'not_found')
})
