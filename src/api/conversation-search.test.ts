import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { keys, paths } from './keys.ts'
import { evictPrefix, peek, setData } from './cache.ts'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'

test('conversation search keys isolate exact session, query and page and encode opaque path input', () => {
  const first = keys.conversationSearch('session', 'a:b', 0)
  for (const other of [keys.conversationSearch('session2', 'a:b', 0), keys.conversationSearch('session', 'a', 0), keys.conversationSearch('session', 'a:b', 20)]) assert.notEqual(first, other)
  assert.ok(first.startsWith(keys.conversationSearch('session')))
  assert.ok(!keys.conversationSearch('session2', 'a:b').startsWith(keys.conversationSearch('session')))
  assert.equal(paths.conversationSearch('a/b', 'x&y', 20), '/sessions/a%2Fb/search?q=x%26y&offset=20')
})

test('live message and access changes heal cached Find results and removal evicts their text', () => {
  const events = stripComments(read(join(ROOT, 'src/api/events.ts')))
  const block = (name: string) => events.split(`case '${name}':`)[1]?.split('break')[0] ?? ''
  assert.ok(block('session.updated').includes('invalidatePrefix(keys.conversationSearch(e.session.id))'))
  assert.ok(block('session.removed').includes('evictPrefix(keys.conversationSearch(e.session.id))'))
  assert.ok(block('grant.changed').includes("if (e.subject.kind === 'session') evictPrefix(keys.conversationSearch(e.subject.id))"))
  const hook = stripComments(read(join(ROOT, 'src/api/conversationSearch.ts')))
  assert.match(hook, /useQuery\([\s\S]*keys\.conversationSearch\(id, query, offset\)[\s\S]*paths\.conversationSearch\(id, query, offset\)[\s\S]*query\.length > 0,[\s\S]*true/)
})

test('cache family prefixes actually reach every page without crossing session identity', () => {
  const first = keys.conversationSearch('cache-session', 'needle', 0)
  const second = keys.conversationSearch('cache-session', 'another', 20)
  const neighbour = keys.conversationSearch('cache-session-other', 'needle', 0)
  for (const key of [first, second, neighbour]) setData(key, 'private snippet')
  evictPrefix(keys.conversationSearch('cache-session'))
  assert.equal(peek(first), undefined, 'the actual cache prefix matcher evicts the first query')
  assert.equal(peek(second), undefined, 'all pages and queries of this session are evicted')
  assert.equal(peek(neighbour), 'private snippet', 'a similarly named session stays independent')
  evictPrefix(keys.conversationSearch())
  assert.equal(peek(neighbour), undefined, 'whole-family reset reaches remaining session variants')
})
