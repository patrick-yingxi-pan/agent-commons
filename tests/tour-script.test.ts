/** Boundary lock: the guided tour's client script (src/data/demo.ts) and the mock
 *  model's tour table (server/model/intents.ts) must agree verbatim — the client
 *  sends these exact strings and the mock matches them by fixed string, so any
 *  drift (a re-typed quote, a re-ordered beat) silently breaks the tour. This test
 *  is the seam that catches it. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_STEPS } from '../src/data/demo.ts'
import { TOUR_TURNS, matchIntents } from '../server/model/intents.ts'

test('the client tour and the mock tour table have the same beats, in the same order', () => {
  assert.equal(DEMO_STEPS.length, TOUR_TURNS.length)
  for (let i = 0; i < DEMO_STEPS.length; i++) {
    assert.equal(DEMO_STEPS[i].userText, TOUR_TURNS[i].text, `beat ${i} (${DEMO_STEPS[i].id})`)
  }
})

test('every tour message the client sends resolves to a tool decision on the mock side', () => {
  for (const step of DEMO_STEPS) {
    // matchIntents must not throw and must return the scripted calls for this text.
    const calls = matchIntents(step.userText)
    const expected = TOUR_TURNS.find((t) => t.text === step.userText)!
    assert.deepEqual(calls.map((c) => c.name), expected.calls.map((c) => c.name), step.id)
  }
})
