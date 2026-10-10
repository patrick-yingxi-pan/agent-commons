/** Identity-changing resets and identity-stable world widening are different
 * cache operations. Browser org E2E proves the retained menu/data behavior;
 * this lock pins the one cache funnel and its invitation caller. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, stripComments, ROOT } from '../../tests/helpers/source.ts'
import { ApiRequestError } from './client.ts'
import { queryFailureState } from './cache.ts'

test('query failure state evicts authoritative absence and access denials, but retains transient errors', () => {
  assert.equal(queryFailureState(new ApiRequestError('not_found', 'gone', 404)), 'evict')
  assert.equal(queryFailureState(new ApiRequestError('unauthorized', 'sign in', 401)), 'evict')
  assert.equal(queryFailureState(new ApiRequestError('forbidden', 'not permitted', 403)), 'evict')
  assert.equal(queryFailureState(new ApiRequestError('internal', 'not found upstream', 404)), 'retain')
  assert.equal(queryFailureState(new ApiRequestError('not_found', 'server error', 500)), 'retain')
  assert.equal(queryFailureState(new ApiRequestError('internal', 'offline', 0)), 'retain')
  assert.equal(queryFailureState(new Error('offline')), 'retain')
  assert.equal(queryFailureState({ code: 'not_found', status: 404 }), 'retain')
})

test('query runner applies the failure policy without dropping transient stale data', () => {
  const cache = stripComments(read(join(ROOT, 'src', 'api', 'cache.ts')))
  const start = cache.indexOf('function run(')
  const end = cache.indexOf('export function invalidate', start)
  assert.ok(start >= 0 && end > start)
  const block = cache.slice(start, end)
  assert.match(block, /queryFailureState\(error\)/)
  assert.match(block, /data: failureState === 'evict' \? undefined : e\.state\.data/)
  assert.match(block, /if \(e\.gen === myGen\) \{\s*const failureState/, 'crossed failures cannot evict newer data')
})

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
