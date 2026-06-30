/** Conditional GET / ETag (design F3) — cacheable reads send a weak `ETag` and honour
 *  `If-None-Match`: a matching validator returns 304 (empty body) so an unchanged
 *  resource isn't re-sent. Applied to /capabilities (stable per process) and /relations
 *  (changes only on a confirmed op). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call } from './helpers/http.ts'

for (const path of ['/capabilities', '/relations']) {
  test(`GET ${path} sets a weak ETag and 304s on a matching If-None-Match`, async () => {
    const first = await call('GET', path)
    assert.equal(first.status, 200)
    const etag = first.headers['etag']
    assert.ok(etag && etag.startsWith('W/"'), `${path} sets a weak ETag`)

    const second = await call('GET', path, undefined, { 'if-none-match': etag })
    assert.equal(second.status, 304, `${path} returns 304 for a matching validator`)
    assert.equal(second.json, undefined, '304 carries no body')
    assert.equal(second.headers['etag'], etag, '304 echoes the validator')
  })

  test(`GET ${path} sends the full body for a stale If-None-Match`, async () => {
    const res = await call('GET', path, undefined, { 'if-none-match': 'W/"stale-0"' })
    assert.equal(res.status, 200)
    assert.ok(res.json, 'a non-matching validator gets the fresh body')
    assert.ok(res.headers['etag'], 'and the current ETag')
  })
}
