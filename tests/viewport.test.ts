/** Viewport tier (src/lib/viewport.ts) — the pure breakpoint rule behind the FWD-3
 *  responsive panel ladder. Locks the boundaries so a future tweak to the layout can't
 *  silently shift where the panel switches from side-by-side to an overlay drawer. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tierFor, WIDE_MIN, MEDIUM_MIN } from '../src/lib/viewport.ts'

test('tierFor: wide at/above 1024, medium 640..1023, narrow below 640', () => {
  assert.equal(tierFor(1440), 'wide')
  assert.equal(tierFor(WIDE_MIN), 'wide', 'exactly 1024 is wide')
  assert.equal(tierFor(WIDE_MIN - 1), 'medium', 'just under 1024 is medium')
  assert.equal(tierFor(800), 'medium')
  assert.equal(tierFor(MEDIUM_MIN), 'medium', 'exactly 640 is medium')
  assert.equal(tierFor(MEDIUM_MIN - 1), 'narrow', 'just under 640 is narrow')
  assert.equal(tierFor(375), 'narrow')
})
