/** Cursor pagination (design F3 PD14): the reusable keyed pager + its opt-in wiring
 *  on GET /sessions and /audit. The headline property is that the cursor is keyed
 *  (anchored to an item id), so it's stable under appends — no skipped or duplicated
 *  items across pages. Without `?limit`, the endpoints still return the full array. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'
import { paginate, pageParams, MAX_PAGE_LIMIT } from '../server/pagination.ts'
import type { Page, Session } from '../contract/index.ts'

const item = (id: string) => ({ id })
const ids = (p: { items: { id: string }[] }) => p.items.map((i) => i.id)

// ── The pager ────────────────────────────────────────────────────────────────
test('paginate returns the first page + a cursor, then walks to exhaustion', () => {
  const all = ['a', 'b', 'c', 'd', 'e'].map(item)
  const p1 = paginate(all, (i) => i.id, { limit: 2 })
  assert.deepEqual(ids(p1), ['a', 'b'])
  assert.ok(p1.nextCursor)

  const p2 = paginate(all, (i) => i.id, { limit: 2, cursor: p1.nextCursor! })
  assert.deepEqual(ids(p2), ['c', 'd'])

  const p3 = paginate(all, (i) => i.id, { limit: 2, cursor: p2.nextCursor! })
  assert.deepEqual(ids(p3), ['e'])
  assert.equal(p3.nextCursor, null, 'the last page has no next cursor')
})

test('paginate cursor is keyed — stable when items are prepended between pages', () => {
  const all = ['a', 'b', 'c', 'd'].map(item)
  const p1 = paginate(all, (i) => i.id, { limit: 2 }) // ['a','b']
  // A new item arrives at the front before the next page is fetched.
  const grown = [item('NEW'), ...all]
  const p2 = paginate(grown, (i) => i.id, { limit: 2, cursor: p1.nextCursor! })
  assert.deepEqual(ids(p2), ['c', 'd'], 'resumes after b — no skip, no dupe (offset would have skewed)')
})

test('paginate is lenient about an unknown/garbage cursor (restarts from the top)', () => {
  const all = ['a', 'b', 'c'].map(item)
  assert.deepEqual(ids(paginate(all, (i) => i.id, { limit: 2, cursor: 'not-base64-$$' })), ['a', 'b'])
  // base64 of an id that's no longer present → restart.
  assert.deepEqual(ids(paginate(all, (i) => i.id, { limit: 2, cursor: btoa('gone') })), ['a', 'b'])
})

test('paginate handles an empty list', () => {
  const p = paginate([], (i: { id: string }) => i.id, { limit: 10 })
  assert.deepEqual(p.items, [])
  assert.equal(p.nextCursor, null)
})

// ── pageParams ───────────────────────────────────────────────────────────────
test('pageParams: absent limit → null; valid → params; invalid → "invalid"', () => {
  const at = (q: string) => pageParams(new URL(`http://t/x${q}`))
  assert.equal(at(''), null, 'no limit ⇒ caller returns the full array')
  assert.deepEqual(at('?limit=5'), { limit: 5 })
  assert.deepEqual(at('?limit=5&cursor=abc'), { limit: 5, cursor: 'abc' })
  assert.equal(at('?limit=0'), 'invalid')
  assert.equal(at('?limit=-1'), 'invalid')
  assert.equal(at('?limit=2.5'), 'invalid')
  assert.equal(at('?limit=abc'), 'invalid')
  assert.equal(at(`?limit=${MAX_PAGE_LIMIT + 1}`), 'invalid')
})

// ── Wiring on GET /sessions (the seed has several sessions) ───────────────────
test('GET /sessions without limit returns the full array (back-compat)', async () => {
  const res = await call('GET', '/sessions')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.json), 'unchanged array shape')
})

test('GET /sessions?limit walks pages that reassemble into the full list', async () => {
  const full = (await call('GET', '/sessions')).json as Session[]
  assert.ok(full.length >= 3, 'seed has enough sessions to page')

  const collected: string[] = []
  let cursor: string | null = null
  let guard = 0
  do {
    const q = `/sessions?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const page = (await call('GET', q)).json as Page<Session>
    assert.ok(page.items.length <= 2, 'respects the limit')
    collected.push(...page.items.map((s) => s.id))
    cursor = page.nextCursor
  } while (cursor && ++guard < 100)

  assert.deepEqual(collected, full.map((s) => s.id), 'pages reassemble into the full list, in order, no dupes')
})

test('GET /sessions with an invalid limit is a 400', async () => {
  const res = await call('GET', '/sessions?limit=0')
  assert.equal(res.status, 400)
  assert.equal(res.json.error.code, 'bad_request')
})

test('GET /audit supports the same opt-in pagination', async () => {
  const arr = await call('GET', '/audit')
  assert.ok(Array.isArray(arr.json), 'array by default')
  const page = (await call('GET', '/audit?limit=1')).json as Page<unknown>
  assert.ok('items' in page && 'nextCursor' in page, 'envelope when paginated')
  assert.ok(page.items.length <= 1)
})

// ── The generalized list endpoints (same shared sendList helper) ──────────────
for (const path of ['/dispatch', '/artifacts']) {
  test(`GET ${path} is array-by-default and paginates opt-in`, async () => {
    const arr = await call('GET', path)
    assert.ok(Array.isArray(arr.json), `${path} unchanged array shape by default`)
    const page = (await call('GET', `${path}?limit=1`)).json as Page<{ id: string }>
    assert.ok('items' in page && 'nextCursor' in page, `${path} returns an envelope when paginated`)
    assert.ok(page.items.length <= 1, `${path} respects the limit`)
    assert.equal((await call('GET', `${path}?limit=0`)).status, 400, `${path} rejects an invalid limit`)
  })
}
