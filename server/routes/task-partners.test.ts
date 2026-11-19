import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { call } from '../testkit/http.ts'
import { catalogOf, toolNameFor } from '../apiSurface.ts'
import { buildRouter } from './index.ts'
import { deriveApiTools, runApiTool } from '../model/apiTools.ts'
import { store } from '../store/index.ts'
import { signSession, verifySession } from '../auth.ts'

async function login() {
  const result = await call('POST', '/auth/login', { email: 'ada@acme.example', password: 'ada-demo-password', transport: 'bearer' })
  assert.equal(result.status, 200)
  return { authorization: 'Bearer ' + result.json.token }
}
let seq = 0
async function mcp(method: string, path: string, args: unknown, headers: Record<string, string>) {
  const rpc = await call('POST', '/mcp', { jsonrpc: '2.0', id: ++seq, method: 'tools/call',
    params: { name: toolNameFor(method, path), arguments: args } }, headers)
  assert.equal(rpc.status, 200)
  assert.equal(rpc.json.error, undefined, JSON.stringify(rpc.json.error))
  return JSON.parse(rpc.json.result.content[0].text) as { status: number; body: any }
}

test('an authenticated person can draft via MCP, replay through HTTP and publish volunteer work through either door', async () => {
  const headers = await login()
  const path = '/projects/p-insights/task-drafts', pattern = '/projects/:id/task-drafts'
  const key = randomUUID(), body = { description: 'Review the volunteer guide.' }
  assert.equal((await call('POST', path, body, { 'idempotency-key': key })).status, 401)
  assert.equal((await call('POST', path, body, { 'idempotency-key': key, 'x-user-id':'user-ada', 'x-tenant-id':'tenant-acme' })).status, 401)
  const created = await mcp('POST', pattern, { id: 'p-insights', body, idempotencyKey: key }, headers)
  assert.equal(created.status, 201, JSON.stringify(created.body))
  assert.equal(created.body.status, 'draft')
  const replay = await call('POST', path, body, { ...headers, 'idempotency-key': key })
  assert.equal(replay.status, 201)
  assert.equal(replay.json.taskId, created.body.taskId)
  const differentIntent = await call('POST', path, { description: 'Different offer' }, { ...headers, 'idempotency-key': key })
  assert.equal(differentIntent.status, 409)
  const list = await mcp('GET', pattern, { id: 'p-insights' }, headers)
  assert.equal(list.body.items.filter((r: any) => r.taskId === created.body.taskId).length, 1)
  const { taskId: workId, termsVersion, termsDigest } = created.body
  const published = await mcp('POST', '/projects/:id/work/:workId/publish', { id: 'p-insights', workId, body: { termsVersion, termsDigest }, idempotencyKey: randomUUID() }, headers)
  assert.equal(published.status, 200, JSON.stringify(published.body))
  assert.equal(published.body.funding, 'volunteer')
  assert.equal(published.body.status, 'published')
  const drafts = await mcp('GET', pattern, { id: 'p-insights', query: { state: 'draft' } }, headers)
  assert.equal(drafts.status, 200)
  assert.ok(drafts.body.items.every((task: {status:string}) => task.status === 'draft'))
  const open = await call('GET', path + '?state=published', undefined, headers)
  assert.ok(open.json.items.some((task: { taskId:string }) => task.taskId === workId))
  assert.equal((await call('GET', path + '?state=unknown', undefined, headers)).status, 400)
  const posted = await call('POST', '/projects/p-insights/work/' + workId + '/submissions',
    { termsVersion, termsDigest, text: 'The examples helped.' }, { ...headers, 'idempotency-key': randomUUID() })
  assert.equal(posted.status, 201, JSON.stringify(posted.json))
  assert.equal(posted.json.submissions.at(-1).verdict, 'open')
})

test('a conversation can propose a private task and the signed-in requester can confirm it once', async () => {
  const headers = await login()
  const session = await call('POST', '/sessions', { title: 'Review a Project task' }, headers)
  assert.equal(session.status, 200, JSON.stringify(session.json))
  const pattern = '/projects/:id/task-drafts'
  const catalog = catalogOf(buildRouter())
  const name = 'api__' + toolNameFor('POST', pattern)
  const definition = deriveApiTools(catalog).definitions.find(tool => tool.name === name)
  assert.ok(definition)
  assert.deepEqual(definition.input_schema.required, ['id', 'body'])
  const schema = definition.input_schema.properties.body as { required: string[]; properties: Record<string, unknown> }
  assert.deepEqual(schema.required, ['description'])
  assert.ok(schema.properties.reward && schema.properties.provenance && schema.properties.acceptance)
  assert.ok(!JSON.stringify(schema).includes('"$ref"'), 'An MCP client can use the schema without opening a local file')

  const description = 'Read the community guide ' + randomUUID()
  const proposal = await runApiTool(name, { id: 'p-insights', body: { description } }, randomUUID(), {
    catalog, dispatch: async () => { throw Error('A proposal must wait for the requester to confirm') },
  })
  assert.ok(proposal?.activity)
  assert.equal(proposal.activity.status, 'proposed')
  assert.ok(store.appendMessage(session.json.id, {
    id: store.mintMessageId('assistant'), role: 'assistant', content: 'Review this task before creating the draft.',
    toolActivities: [proposal.activity],
  }, { actorUserId: 'user-ada' }))
  async function countDrafts() {
    const list = await call('GET', '/projects/p-insights/task-drafts', undefined, headers)
    return list.json.items.filter((item: {terms: {description:string}}) => item.terms.description === description).length
  }
  assert.equal(await countDrafts(), 0)
  const path = '/sessions/' + session.json.id + '/tool-activities/' + proposal.activity.id
  const first = await call('POST', path, { decision: 'confirm' }, headers)
  assert.equal(first.status, 200, JSON.stringify(first.json))
  assert.equal(first.json.status, 'done')
  assert.equal(await countDrafts(), 1)
  const replay = await call('POST', path, { decision: 'confirm' }, headers)
  assert.equal(replay.json.status, 'done')
  assert.equal(await countDrafts(), 1)
})

test('a signed-in organization can resume onboarding via MCP while private applications and worker APIs retain their access checks', async t => {
  const before = process.env.TASK_PARTNER_SANDBOX_ORIGIN
  process.env.TASK_PARTNER_SANDBOX_ORIGIN = 'https://sandbox.commons.example'
  t.after(() => { if (before === undefined) delete process.env.TASK_PARTNER_SANDBOX_ORIGIN; else process.env.TASK_PARTNER_SANDBOX_ORIGIN = before })
  const headers = await login(), key = randomUUID()
  const { kty, crv, x } = generateKeyPairSync('ed25519').publicKey.export({format:'jwk'})
  const input = { displayName:'Orchard Services', organization:'Orchard', organizationUrl:'https://orchard.example.com',
    handoffUrl:'https://orchard.example.com/authorize', contact:'ops@orchard.example.com', recoveryContact:'recover@orchard.example.com',
    capabilities:['custodian'], catalog:{models:[],rules:[],assets:[{assetId:'voucher',unit:'each'}]}, publicKey:{ kid:'test-k1', kty,crv,x } }
  const result = await call('POST','/task-partners/sandbox/applications',input,{...headers,'idempotency-key':key})
  assert.equal(result.status,201,JSON.stringify(result.json))
  const { applicationId } = result.json
  assert.equal(typeof applicationId, 'string')
  const challengePath = '/task-partners/sandbox/applications/' + applicationId + '/domain-challenges'
  const proofKey = randomUUID(), request = { purpose: 'website', expectedRevision: result.json.revision }
  const initial = await call('POST', challengePath, request, { ...headers, 'idempotency-key': proofKey })
  assert.equal(initial.status, 201, JSON.stringify(initial.json))
  const claims = verifySession(headers.authorization.slice('Bearer '.length))
  assert.ok(claims)
  const stale = signSession({ ...claims, authenticatedAt: Date.now() - 3600000 })
  const denied = await call('POST', challengePath, request, { authorization: 'Bearer ' + stale, 'idempotency-key': proofKey })
  assert.equal(denied.status, 403, 'An old session cannot retrieve a challenge through its earlier replay key')
  const args = { environment:'sandbox', applicationId }
  const privateRead = await mcp('GET','/task-partners/:environment/applications/:applicationId', args,headers)
  assert.equal(privateRead.status,200)
  assert.equal(privateRead.body.applicationId, applicationId)
  assert.equal(privateRead.body.viewer.canManage,true)
  const unsignedRead=await call('GET','/task-partners/sandbox/applications/'+applicationId)
  assert.equal(unsignedRead.status,401)
  const commands = await call('GET','/task-partners/sandbox/commands',undefined,headers)
  assert.ok([401,403].includes(commands.status))
  const decision = await call('POST','/task-partners/production/applications/'+applicationId+'/decisions',{action:'approve'},
    {...headers,'idempotency-key':randomUUID()})
  assert.equal(decision.status,404)
})
