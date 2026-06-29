/** The opt-in prompt-fit probe (docs/agent-commons.md, D10/OQ5) — the pure scorer beside
 *  the always-on static tag. It must give MORE than the binary tag: a score + a per-aspect
 *  gradient that names which dimension degrades (tool-use fidelity first). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeScore, PROBE_ASPECTS } from '../contract/probe.ts'

test('probeScore: a matched family pairing scores strong across every aspect', () => {
  const r = probeScore('claude', 'claude')
  assert.equal(r.verdict, 'strong')
  assert.ok(r.score >= 85)
  assert.equal(r.aspects.length, PROBE_ASPECTS.length)
  assert.ok(r.aspects.every((a) => a.score >= 85))
  assert.match(r.detail, /matched pairing/)
})

test('probeScore: a mismatch surfaces tool-use fidelity as the weak point (the signal the tag lacks)', () => {
  const r = probeScore('claude', 'open')
  assert.ok(r.score < probeScore('claude', 'claude').score, 'a mismatch scores lower than a match')
  const toolUse = r.aspects.find((a) => a.name === 'tool-use fidelity')!
  const instr = r.aspects.find((a) => a.name === 'instruction-following')!
  assert.ok(toolUse.score < instr.score, 'tool-use degrades most — the gradient a binary tag cannot express')
  assert.match(r.detail, /tool-use fidelity is the weak point/)
})

test('probeScore is case-insensitive on the family pairing', () => {
  assert.equal(probeScore('Claude', 'claude').verdict, 'strong')
})
