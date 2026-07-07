/** Surface-audit S5 — a turn's byline is the Agent that DROVE it (per-turn provenance,
 *  so a D16 mid-thread hand-off is visible), not a flat 'Claude' constant. These lock
 *  the pure resolver: the default agent / an absent id / an unresolvable id all read
 *  'Claude' (ordinary single-agent threads are byte-unchanged), while a non-default
 *  worker Agent reads its own label. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driverByline, DEFAULT_AGENT_ID } from '../src/lib/driverByline.ts'

const agents = [
  { id: 'agent-scout', label: 'Research scout' },
  { id: 'agent-default', label: 'Default agent' },
]

test('a user turn / a legacy message with no driver reads Claude', () => {
  assert.equal(driverByline(undefined, agents), 'Claude')
})

test('the DEFAULT agent reads Claude, NOT its stored label ("Default agent")', () => {
  assert.equal(driverByline(DEFAULT_AGENT_ID, agents), 'Claude')
  assert.equal(driverByline('agent-default', agents), 'Claude', 'ordinary N=1 threads unchanged')
})

test('a non-default agent that drove the turn reads its own label — the hand-off is visible', () => {
  assert.equal(driverByline('agent-scout', agents), 'Research scout')
})

test('an unresolvable (since-deleted) driver falls back to Claude, never blank', () => {
  assert.equal(driverByline('agent-gone', agents), 'Claude')
  assert.equal(driverByline('agent-scout', []), 'Claude')
})
