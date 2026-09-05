/** Identity-changing resets and identity-stable world widening are different
 * cache operations. Browser org E2E proves the retained menu/data behavior;
 * this lock pins the one cache funnel and its invitation caller. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, stripComments, ROOT } from '../../tests/helpers/source.ts'

test('cache-wide revalidation keeps data while refetching every live key', () => {
  const cache = stripComments(read(join(ROOT, 'src', 'api', 'cache.ts')))
  const start = cache.indexOf('export function revalidateAll()')
  assert.ok(start >= 0, 'the cache owns a named all-query revalidation funnel')
  const end = cache.indexOf('export function useQuery', start)
  assert.ok(end > start, 'the revalidation block remains independently inspectable')
  const block = cache.slice(start, end)
  assert.match(block, /for \(const \[key, e\] of entries\)/)
  assert.match(block, /if \(e\.fetcher\) run\(key, e\.fetcher\)/)
  assert.doesNotMatch(block, /IDLE|setState\(/, 'revalidation never drops truthful cached data')
})

test('accepting an org seat widens the live world without resetting identity', () => {
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'orgInviteVerdictCommands.ts')))
  const start = commands.indexOf('export async function applyOrgInviteVerdict')
  assert.ok(start >= 0)
  const block = commands.slice(start)
  assert.match(block, /intent\.verdict === 'accept'/)
  assert.match(block, /revalidateAll\(\)/)
  assert.match(block, /else setData\(keys\.meOrgs, incoming\)/, 'an unopened cache adopts the complete authoritative roster')
  assert.doesNotMatch(block, /setData\(keys\.meOrgs, \[membership\]\)/, 'one accepted seat cannot erase older memberships')
  assert.doesNotMatch(block, /resetAll\(/, 'a seat changes reach, not the signed-in principal')
})
