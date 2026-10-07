import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relationConsentVerdict } from './relationConsent.ts'

test('recorded consent wins over current graph truth; held decisions wait for their exact receipt', () => {
  for (const recorded of ['confirmed', 'skipped', undefined] as const) {
    for (const applied of [false, true]) {
      assert.equal(relationConsentVerdict(recorded, true, applied), 'pending')
      assert.equal(relationConsentVerdict(recorded, false, applied),
        recorded ?? (applied ? 'confirmed' : 'pending'),
        `recorded=${recorded}, applied=${applied}`)
    }
  }
})
