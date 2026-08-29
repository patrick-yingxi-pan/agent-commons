/** The cadence oracle is shared by editor and scheduler. These examples pin
 *  timezone conversion and DST behavior rather than the host process timezone. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextCadenceFireAt, nextRunLabel, parseCadence, validTimeZone } from './cadence.ts'

test('daily cadence resolves the selected timezone, not the host clock', () => {
  const spec = parseCadence('Daily · 9:00 AM')!
  const after = Date.parse('2026-06-26T15:00:00.000Z') // 08:00 in Los Angeles
  assert.equal(nextCadenceFireAt(spec, after, 'America/Los_Angeles'), Date.parse('2026-06-26T16:00:00.000Z'))
  assert.equal(nextRunLabel(spec, new Date(after), 'America/Los_Angeles'), 'Today, 9:00 AM')
  assert.equal(nextCadenceFireAt(spec, after, 'UTC'), Date.parse('2026-06-27T09:00:00.000Z'))
})

test('weekday and weekly cadences advance over weekends in their local calendar', () => {
  const after = Date.parse('2026-01-03T18:00:00.000Z') // Saturday 10:00 in Los Angeles
  assert.equal(
    nextCadenceFireAt(parseCadence('Weekdays · 9:00 AM')!, after, 'America/Los_Angeles'),
    Date.parse('2026-01-05T17:00:00.000Z'),
  )
  assert.equal(
    nextCadenceFireAt(parseCadence('Mondays · 7:00 AM')!, after, 'America/Los_Angeles'),
    Date.parse('2026-01-05T15:00:00.000Z'),
  )
})

test('a nonexistent spring-forward wall time is skipped rather than shifted', () => {
  const after = Date.parse('2026-03-07T20:00:00.000Z')
  assert.equal(
    nextCadenceFireAt(parseCadence('Daily · 2:30 AM')!, after, 'America/Los_Angeles'),
    Date.parse('2026-03-09T09:30:00.000Z'),
  )
})

test('interval cadence uses local clock boundaries across timezone offsets', () => {
  const after = Date.parse('2026-06-26T15:05:00.000Z') // 08:05 in Los Angeles
  assert.equal(
    nextCadenceFireAt(parseCadence('Every 2 hours')!, after, 'America/Los_Angeles'),
    Date.parse('2026-06-26T17:00:00.000Z'),
  )
})

test('invalid cadence and timezone inputs are explicitly rejected by the oracle', () => {
  assert.equal(parseCadence('Daily · 25:90 PM'), null)
  assert.equal(validTimeZone('Mars/Olympus_Mons'), false)
  assert.equal(nextCadenceFireAt({ freq: 'daily', time: '09:00' }, 0, 'Mars/Olympus_Mons'), undefined)
})
