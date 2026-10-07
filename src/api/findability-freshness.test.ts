/** Lock: the findability caches stay FRESH (the D21/D22 review finding). Search and
 *  a workspace profile COMPOSE many other reads, so no per-entity invalidation can
 *  cover them: at the feature's first commit their keys cached forever (`ensure`
 *  early-returns on success) — share a project mid-session, reopen ⌘K, and the new
 *  entity was permanently missing from a previously-typed query. The fix is
 *  two-layered and this test fails if either layer regresses:
 *    1. SWR on mount — `useQuery(..., revalidate: true)` in both hooks, honored by
 *       `ensure(key, fetcher, force)` in the cache.
 *    2. Live invalidation while OPEN — `relation.applied` + `openwork.changed`
 *       refetch both key families via the keys' no-arg prefix form.
 *  Source-level greps, like the other funnel locks (src/lib/addTrigger.test.ts):
 *  the hook wiring is React-bound, which `node --test` can't mount — the greps
 *  lock the wiring, the running app verifies the behavior. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { keys, paths } from './keys.ts'
import { evictPrefix, peek, setData } from './cache.ts'

const src = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

test('the key families follow the prefix convention invalidatePrefix depends on', () => {
  assert.equal(keys.search(), 'search', 'no-arg = the family prefix (the directory-keys convention)')
  assert.equal(keys.search('q1'), 'search:["q1",null,0]')
  assert.equal(keys.ownerProfile(), 'owner-profile')
  assert.equal(keys.ownerProfile('Ada Lab'), 'owner-profile:Ada Lab')
})

test('search page keys cannot alias other queries, categories or offsets and share one invalidation family', () => {
  const variants = [
    keys.search(''), keys.search('q'), keys.search('q', { type: 'artifact', offset: 0 }),
    keys.search('q', { type: 'artifact', offset: 20 }), keys.search('q', { type: 'agent', offset: 0 }),
    keys.search('q:artifact:20'), keys.search('["q","artifact",20]'),
  ]
  assert.equal(new Set(variants).size, variants.length)
  assert.ok(variants.every(key => key.startsWith(`${keys.search()}:`)))
  assert.equal(paths.search('one & two', { type: 'artifact', offset: 20 }), '/search?q=one%20%26%20two&type=artifact&offset=20')
  assert.equal(paths.search('one'), '/search?q=one')
})

test('both findability hooks revalidate on mount (SWR), and the cache honors force', () => {
  const hooks = src('./hooks.ts')
  const fnBlock = (name: string) => {
    const m = hooks.match(new RegExp(`export function ${name}[\\s\\S]*?\\n\\}`))
    assert.ok(m, `${name} exists`)
    return m![0]
  }
  assert.match(fnBlock('useGlobalSearch'), /true,\s*true\)/, 'useGlobalSearch passes revalidate')
  assert.match(fnBlock('useOwnerProfile'), /true,\s*true\)/, 'useOwnerProfile passes revalidate')

  const cache = src('./cache.ts')
  assert.match(cache, /ensure\(key, fetcher as \(\) => Promise<unknown>, revalidate\)/, 'useQuery forwards revalidate to ensure')
  assert.match(cache, /status === 'success' && !force/, 'ensure refetches a loaded key when forced')
})

test('the ambient events that change the commons refetch open profiles and searches', () => {
  const events = src('./events.ts')
  const cases = events.split(/case '/)
  const relationCase = cases.find((c) => c.startsWith('relation.applied'))
  const openworkCase = cases.find((c) => c.startsWith('openwork.changed'))
  for (const [label, block] of [['relation.applied', relationCase], ['openwork.changed', openworkCase]] as const) {
    assert.ok(block, `${label} case exists`)
    assert.match(block, /invalidatePrefix\(keys\.ownerProfile\(\)\)/, `${label} refetches open profiles`)
    assert.match(block, /invalidatePrefix\(keys\.search\(\)\)/, `${label} refetches open searches`)
  }
})

test('body and access changes refresh every current and saved-version search page', () => {
  const cases = src('./events.ts').split(/case '/)
  for (const type of ['artifact.changed', 'grant.changed', 'social-access.changed']) {
    const block = cases.find((candidate) => candidate.startsWith(`${type}':`))
    assert.ok(block, `${type} is handled`)
    const method = type === 'grant.changed' ? 'evictPrefix' : 'invalidatePrefix'
    assert.ok(block.includes(`${method}(keys.search())`), `${type} refreshes all search categories and pages`)
  }
})

test('grant-change eviction removes every cached search variant without crossing other families', () => {
  const variants = [keys.search('private'), keys.search('private', { type: 'artifact', offset: 20 }),
    keys.search('private', { type: 'artifactVersion', offset: 0 }), keys.search('other')]
  for (const key of variants) setData(key, 'private snippet')
  const neighbour = 'search-neighbour:private'
  setData(neighbour, 'independent')
  evictPrefix(keys.search())
  for (const key of variants) assert.equal(peek(key), undefined, key)
  assert.equal(peek(neighbour), 'independent')
  evictPrefix('search-neighbour')
})
