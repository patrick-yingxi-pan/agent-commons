import test from 'node:test'
import assert from 'node:assert/strict'
import { SEARCH_HIT_TYPES, parseSearchPage } from './search.ts'

test('search page parser distinguishes overview, valid pages, and invalid request pairs', () => {
  assert.equal(parseSearchPage(), undefined)
  assert.deepEqual(parseSearchPage('agent'), { type: 'agent', offset: 0 })
  assert.deepEqual(parseSearchPage('openWork', '9007199254740991'), { type: 'openWork', offset: Number.MAX_SAFE_INTEGER })

  for (const type of SEARCH_HIT_TYPES) {
    assert.deepEqual(parseSearchPage(type, '0'), { type, offset: 0 })
  }

  for (const [type, offset] of [
    [undefined, '0'], ['', undefined], ['missing', undefined], ['agent', ''], ['agent', '-1'],
    ['agent', '-0'], ['agent', '+1'], ['agent', '01'], ['agent', '1.0'], ['agent', '1e2'],
    ['agent', '9007199254740992'],
  ] as const) {
    assert.equal(parseSearchPage(type, offset), null, `${String(type)} / ${String(offset)} is invalid`)
  }
})
