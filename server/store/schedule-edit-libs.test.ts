/** The schedule detail page's cadence + model editors derive their stored strings
 *  (cadence / WHEN sentence / next-run estimate; the model label) from structured
 *  picks via two pure libs. These lock that derivation so the editor can't drift
 *  from what the routine displays, and so a stored string round-trips back into the
 *  picker's pre-selected state. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeCadence,
  formatTime,
  parseTime,
  parseCadence,
  nextRunLabel,
  type CadenceSpec,
} from '../../src/lib/cadence.ts'
import { effortLevelsFor, pickedProvider, pickedModel } from '../../src/lib/models.ts'
import { composeModelLabel, parseModelChoice } from '../../src/lib/legacyModelChoice.ts'
import { store } from './index.ts'

test('formatTime / parseTime round-trip the 12h ↔ 24h forms', () => {
  assert.equal(formatTime('08:00'), '8:00 AM')
  assert.equal(formatTime('14:30'), '2:30 PM')
  assert.equal(formatTime('00:00'), '12:00 AM')
  assert.equal(formatTime('12:00'), '12:00 PM')
  assert.equal(parseTime('8:00 AM'), '08:00')
  assert.equal(parseTime('2:30 PM'), '14:30')
  assert.equal(parseTime('12:00 AM'), '00:00')
  assert.equal(parseTime('not a time'), null)
})

test('describeCadence renders the cadence chip + WHEN sentence per frequency', () => {
  assert.deepEqual(describeCadence({ freq: 'every-30m' }), { cadence: 'Every 30 min', trigger: 'every 30 minutes' })
  assert.deepEqual(describeCadence({ freq: 'hourly' }), { cadence: 'Every hour', trigger: 'every hour' })
  assert.deepEqual(describeCadence({ freq: 'every-2h' }), { cadence: 'Every 2 hours', trigger: 'every 2 hours' })
  assert.deepEqual(describeCadence({ freq: 'weekdays', time: '08:00' }), {
    cadence: 'Weekdays · 8:00 AM',
    trigger: 'every weekday at 8:00 AM',
  })
  assert.deepEqual(describeCadence({ freq: 'daily', time: '09:00' }), {
    cadence: 'Daily · 9:00 AM',
    trigger: 'every day at 9:00 AM',
  })
  assert.deepEqual(describeCadence({ freq: 'weekly', time: '07:00', weekday: 1 }), {
    cadence: 'Mondays · 7:00 AM',
    trigger: 'every Monday at 7:00 AM',
  })
})

test('parseCadence round-trips describeCadence output (the editor pre-fills from the stored string)', () => {
  const specs: CadenceSpec[] = [
    { freq: 'every-30m' },
    { freq: 'hourly' },
    { freq: 'every-2h' },
    { freq: 'weekdays', time: '08:00' },
    { freq: 'daily', time: '09:00' },
    { freq: 'weekly', time: '07:00', weekday: 1 },
    { freq: 'weekly', time: '15:00', weekday: 5 },
  ]
  for (const spec of specs) {
    const { cadence } = describeCadence(spec)
    const parsed = parseCadence(cadence)
    assert.deepEqual(describeCadence(parsed ?? { freq: 'daily' }), describeCadence(spec), `round-trip for "${cadence}"`)
  }
  assert.equal(parseCadence('something custom the editor does not know'), null, 'unknown shape → null (editor uses a default)')
})

test('nextRunLabel for interval frequencies reads "in N min" / "in Nh Nm" to the next boundary', () => {
  const now = new Date(2026, 5, 26, 10, 5, 0) // 10:05
  assert.equal(nextRunLabel({ freq: 'every-30m' }, now), 'in 25 min', 'next :30 boundary')
  assert.equal(nextRunLabel({ freq: 'hourly' }, now), 'in 55 min', 'next :00 boundary')
  assert.equal(nextRunLabel({ freq: 'every-2h' }, now), 'in 1h 55m', 'next even-hour boundary (12:00)')
})

test('nextRunLabel for daily reads Today vs Tomorrow around the time of day', () => {
  assert.equal(nextRunLabel({ freq: 'daily', time: '09:00' }, new Date(2026, 5, 26, 8, 0)), 'Today, 9:00 AM')
  assert.equal(nextRunLabel({ freq: 'daily', time: '09:00' }, new Date(2026, 5, 26, 10, 0)), 'Tomorrow, 9:00 AM')
})

test('nextRunLabel for weekdays / weekly skips to the right day (Sat 10:00 → next is Monday)', () => {
  const sat = new Date(2026, 0, 3, 10, 0) // Jan 3 2026 is a Saturday
  assert.equal(sat.getDay(), 6, 'precondition: the chosen date is a Saturday')
  assert.equal(nextRunLabel({ freq: 'weekdays', time: '09:00' }, sat), 'Mon, 9:00 AM', 'weekends are skipped')
  assert.equal(nextRunLabel({ freq: 'weekly', time: '07:00', weekday: 1 }, sat), 'Mon, 7:00 AM', 'next Monday')
})

test('every starter routine has an executable cadence before Resume is offered', () => {
  for (const template of store.scheduleTemplates()) {
    assert.ok(parseCadence(template.seed.cadence), `${template.name} has a supported cadence`)
  }
})

// The routine's stored model label is composed from — and parsed against — the
// LIVE provider registry (each provider's own catalog), so the round-trip is
// exercised on the real seeded registry rather than a mirror.
const PROVIDERS = store.listProviders()

test('composeModelLabel / parseModelChoice round-trip every default-provider model × effort combo', () => {
  assert.equal(composeModelLabel(PROVIDERS, { modelId: 'claude-opus-4-8' }, 'High'), 'Claude Opus 4.8 · High')
  assert.equal(composeModelLabel(PROVIDERS, { modelId: 'claude-sonnet-4-6' }, 'Medium'), 'Claude Sonnet 4.6 · Medium')
  const provider = pickedProvider(PROVIDERS, {})
  for (const m of provider?.models ?? []) {
    const levels = effortLevelsFor(provider, m)
    for (const effort of levels.length ? levels : [undefined]) {
      const pick = { modelId: m.id }
      const label = composeModelLabel(PROVIDERS, pick, effort)
      const parsed = parseModelChoice(label, PROVIDERS)
      assert.equal(pickedModel(provider, parsed.pick)?.id, m.id, `model round-trip for "${label}"`)
      assert.equal(parsed.effort, effort, `effort round-trip for "${label}"`)
    }
  }
})

test('parseModelChoice degrades an unrecognized label to the inherit default (never throws)', () => {
  assert.deepEqual(parseModelChoice('Some Unknown Model', PROVIDERS).pick, {})
  assert.deepEqual(parseModelChoice('', PROVIDERS).pick, {})
})

test('parseModelChoice does not choke on effort levels carrying regex metacharacters (caller-suppliable)', () => {
  // A provider's effort levels are its OWN catalog strings (POST/PATCH /providers),
  // so a level like `C++` once made an unescaped RegExp interpolation THROW and
  // crash the picker's render. The match is now a plain segment compare.
  const providers = [
    {
      id: 'provider-anthropic',
      label: 'Default',
      models: [{ id: 'm1', label: 'Model One', effortLevels: ['C++', 'A+', '(fast)'] }],
    },
  ] as unknown as Parameters<typeof parseModelChoice>[1]
  assert.doesNotThrow(() => parseModelChoice('Model One · C++', providers))
  assert.equal(parseModelChoice('Model One · C++', providers).effort, 'C++', 'the metachar level still matches')
  assert.equal(parseModelChoice('Model One · A+', providers).effort, 'A+')
})
