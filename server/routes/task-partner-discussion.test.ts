import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { call } from '../testkit/http.ts'
import { store } from '../store/index.ts'

test('published task work enters one native backlog, search result, personal listing and comment thread without legacy dispatch or retraction', async () => {
  const auth = await call('POST', '/auth/login', {
    email: 'ada@acme.example',
    password: 'ada-demo-password',
    transport: 'bearer',
  })
  const headers = { authorization: 'Bearer ' + auth.json.token },
    project = 'p-insights',
    base = '/projects/' + project
  const post = (path: string, body: object, key = randomUUID()) =>
    call('POST', path, body, { ...headers, 'idempotency-key': key })
  const read = (path: string) => call('GET', path, undefined, headers)
  const description = 'Invite feedback ' + randomUUID()
  const draft = await post(base + '/task-drafts', { description })
  assert.equal(draft.status, 201)
  const t = draft.json,
    terms = { termsVersion: t.termsVersion, termsDigest: t.termsDigest }
  const nativePath = base + '/open-subgoals',
    url = base + '/work/' + t.taskId
  assert.equal(
    (await read(nativePath)).json.some((o) => o.id === t.taskId),
    false,
  )
  assert.equal((await post(nativePath + '/' + t.taskId + '/comments', { body: 'Draft leak' })).status, 404)
  assert.equal((await post(url + '/publish', {})).status, 400)
  assert.equal((await post(url + '/publish', { ...terms, termsVersion: t.termsVersion + 1 })).status, 409)
  assert.equal(
    (await read(nativePath)).json.some((o) => o.id === t.taskId),
    false,
  )
  const key = randomUUID()
  assert.equal((await post(url + '/publish', terms, key)).status, 200)
  assert.equal((await post(url + '/publish', terms, key)).status, 200)
  const rows = (await read(nativePath)).json.filter((o) => o.id === t.taskId)
  assert.equal(rows.length, 1)
  assert.deepEqual([rows[0].type, rows[0].target, rows[0].status], ['task', 'Volunteer', 'open'])
  assert.equal(store.dispatchOpenSubGoal(rows[0]), false)
  assert.equal(store.retractOpenSubGoal(project, t.taskId, 'tenant-acme', { kind: 'user', id: 'user-ada' }), undefined)
  const mine = await read('/me/work')
  assert.equal(mine.json.posted.filter((o) => o.id === t.taskId).length, 1)
  const search = await read('/search?q=' + encodeURIComponent(description))
  assert.equal(
    search.json.groups.flatMap((g) => g.hits).filter((h) => h.type === 'openWork' && h.id === t.taskId).length,
    1,
  )
  const commentKey = randomUUID(),
    body = { body: 'Clarify the scope please' }
  const comment = await post(nativePath + '/' + t.taskId + '/comments', body, commentKey)
  assert.equal(comment.status, 200, JSON.stringify(comment.json))
  const again = await post(nativePath + '/' + t.taskId + '/comments', body, commentKey)
  assert.deepEqual(comment.json.comments, again.json.comments)
  assert.equal((await post(url + '/cancel', terms)).status, 200)
  const after = (await read(nativePath)).json.find((o) => o.id === t.taskId)
  assert.deepEqual([after.status, after.comments.length, after.comments[0].body], ['retracted', 1, body.body])
  assert.equal(JSON.stringify(after).includes('postedByTenant'), false)
})
