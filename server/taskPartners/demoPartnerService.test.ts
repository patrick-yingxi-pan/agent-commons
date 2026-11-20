import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { Readable } from 'node:stream'
import { createDemoPartnerService } from './demoPartnerService.ts'
import { DEMO_READY_RULE } from '../data/taskPartnerDemo.ts'
import { demoPartnerAudience } from './demoConfiguration.ts'
import { sha256, verifiedJws } from './protocol.ts'
import { DemoWorkerClient } from './demoPartnerWorker.ts'
import { DemoPartnerLedger } from './demoPartnerLedger.ts'

const origin = 'http://127.0.0.1:8787'
const host = 'orchard-labs.localhost:8787'
const handoffId = 'grant-' + 'b'.repeat(32)
const startCode = 'code-' + 'c'.repeat(43)
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const worker = { slug: 'orchard-labs', partnerId: 'org-orchard', kid: 'demo-key', privateKey,
  domain: 'orchard-labs.example.com', displayName: 'Orchard Works', catalog: { models: [{model:'orchard-demo', efforts:['standard']}], assets: [], rules: [] } }
const verifier = { ...worker, slug: 'orchard-coop', partnerId: 'org-coop', domain: 'orchard-coop.example.com',
  displayName: 'Orchard Work', catalog: { models: [], assets: [], rules: [DEMO_READY_RULE] } }
const key = { ...publicKey.export({ format:'jwk' }), kid: worker.kid }
const audience = demoPartnerAudience('production')
const offer = { taskId:'task-review', termsDigest:'d'.repeat(64), termsVersion:1, handoffId, partnerId:worker.partnerId,
  environment:'production', grant:{ kind:'run', model:'orchard-demo', effort:'standard', maxInputTokens:512, maxOutputTokens:8, inputDigest:sha256('task input') },
  workSummary:'Read <this> task', actorRef:'subject-1', nonce:'nonce-1', expiresAt:new Date(Date.now()+295_000).toISOString() }
const options = { workers:[worker,verifier], platformApiOrigin:origin,
  badgeUrl: w => 'http://partner-badges.localhost:8787/v1/task-partners/public/partners/' + w.partnerId + '/badge?domain=' + w.domain,
  profileUrl:w => 'http://partner-profiles.localhost:8787/partners/' + w.partnerId }
function verify(type, jwt) { return verifiedJws(jwt, type, kid => kid === key.kid ? key : undefined).claims }
function demoEnvironment(t) {
  const omit = ['DEPLOYMENT_PROFILE','INITIAL_WORLD','TASK_PARTNER_WEB_ORIGIN','TASK_PARTNER_SANDBOX_ORIGIN','TASK_PARTNER_BADGE_ORIGIN']
  const set = { TASK_PARTNER_DEMO:'1', PORT:'8787', HOST:'127.0.0.1', NODE_ENV:'development', BACKEND:'mock' }
  const saved = [...omit, ...Object.keys(set)].map(name => [name, process.env[name]])
  t.after(() => { for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value } })
  for (const name of omit) delete process.env[name]
  Object.assign(process.env, set)
}
async function visit(service, requestHost, pathname, fields?, source?) {
  const body = fields ? new URLSearchParams(fields).toString() : ''
  const req = Readable.from([Buffer.from(body)])
  Object.assign(req, { method:fields?'POST':'GET', complete:true, headers:{host:requestHost, origin:source, 'content-type':'application/x-www-form-urlencoded'} })
  const response = { status:0, body:'', headers:{}, writeHead(status, headers){this.status=status;this.headers=headers}, end(body){this.body=body} }
  const handled = await service.handle(req,response,new URL(pathname,origin))
  return { ...response, handled }
}

test('only the local fixtures can select an account, then the exact grant and scoped worker token are signed', async t => {
  demoEnvironment(t)
  const attestations = []
  t.mock.method(globalThis,'fetch',async (url,init) => {
    assert.equal(new URL(url).origin,origin)
    assert.equal(init.redirect,'error')
    const path = new URL(url).pathname
    if (path.endsWith('/oauth/token')) {
      const claim = verify('partner-client-auth+jwt',init.body.get('client_assertion'))
      assert.equal(claim.iss,worker.partnerId)
      assert.equal(claim.aud,audience+'/oauth/token')
      return Response.json({access_token:'fixture', expires_in:300})
    }
    assert.equal(init.headers.get('authorization'),'Bearer fixture')
    assert.equal(init.headers.has('cookie'),false)
    if (path.endsWith('/exchange')) {
      assert.deepEqual(JSON.parse(init.body),{ startCode })
      return Response.json(offer)
    }
    assert.ok(path.endsWith('/attestations'))
    attestations.push(verify('partner-handoff+jwt',JSON.parse(init.body).signedGrant))
    return Response.json({ state:'attested' })
  })
  const service = createDemoPartnerService(options)
  try {
    const start = { startUrl:'https://auth.'+worker.domain+'/confirm', handoffDomainAscii:'auth.'+worker.domain,
      identity:{domainAscii:worker.domain,profilePath:'/partners/'+worker.partnerId} }
    assert.equal(service.continuation(start),'http://'+host+'/confirm')
    assert.equal(service.continuation({...start,identity:{...start.identity,profilePath:'/partners/other'}}),null)
    assert.equal(service.continuation({...start,startUrl:start.startUrl+'?redirect=bad'}),null)
    assert.equal((await visit(service,'unrelated.localhost:8787','/')).handled,false)
    assert.match((await visit(service,host,'/')).body,/partner-badges\.localhost/)
    assert.equal((await visit(service,host,'/confirm',{handoffId,startCode},'https://outside.example')).status,409)
    const consent = await visit(service,host,'/confirm',{handoffId,startCode},'null')
    assert.equal(consent.status,200)
    assert.match(consent.body,/Read &lt;this&gt; task/)
    assert.doesNotMatch(consent.body,new RegExp(startCode))
    const ticket = /name="ticket" value="([^"]+)"/.exec(consent.body)[1]
    const fields = { ticket, account:'42' }
    assert.equal((await visit(service,host,'/select',fields,'https://outside.example')).status,409)
    assert.equal((await visit(service,'orchard-coop.localhost:8787','/select',fields,'http://orchard-coop.localhost:8787')).status,409)
    assert.equal(attestations.length,0)
    assert.equal((await visit(service,host,'/select',fields,'http://'+host)).status,200)
    assert.equal(attestations.length,1)
    assert.deepEqual(attestations[0].grant,offer.grant)
    assert.equal(attestations[0].accountLabel,'Demo account ending in 42')
    assert.equal(attestations[0].actorRef,offer.actorRef)
    assert.equal(attestations[0].aud,audience)
    assert.equal((await visit(service,host,'/select',fields,'http://'+host)).status,409)
  } finally { await service.close() }
  process.env.DEPLOYMENT_PROFILE = 'web'
  assert.throws(()=>createDemoPartnerService(options),/local demonstration profile/)
})

test('the verifier reads and hashes the assigned artifact and signs the exact-match verdict',async t=>{
  const ledger = new DemoPartnerLedger()
  const client = new DemoWorkerClient(verifier,origin,ledger)
  const outcomes = []
  const commands = ['ready','ready\n'].map((data,i)=>({
    taskId:offer.taskId,termsVersion:1,termsDigest:offer.termsDigest,commandId:'command-'+i,issuedAt:new Date().toISOString(),
    partnerId:verifier.partnerId,environment:'production',state:'requested',
    action:{ kind:'verify',submissionId:'submission-'+i,submission:{artifactId:'artifact-'+i,digest:sha256(data),mediaType:'text/plain'},rule:DEMO_READY_RULE,inputs:[] },
  }))
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    const path = new URL(url).pathname
    if(path.endsWith('/oauth/token')) {
      assert.ok(!init.body.get('scope').includes('artifacts:write'))
      return Response.json({access_token:'fixture',expires_in:300})
    }
    if(path.endsWith('/commands')) {
      return Response.json(new URL(url).searchParams.get('cursor') === 'next-demo' ?
        {items:commands.slice(1)} : {items:commands.slice(0,1),nextCursor:'next-demo'})
    }
    if(path.includes('/artifacts/')) return new Response(path.endsWith('artifact-0')?'ready':'ready\n')
    assert.ok(path.endsWith('/receipts'))
    const claims = verify('partner-receipt+jwt',JSON.parse(init.body).signedReceipt)
    assert.equal(claims.iss,verifier.partnerId)
    assert.equal(claims.aud,audience)
    assert.equal(claims.termsDigest,offer.termsDigest)
    outcomes.push(claims.outcome)
    return Response.json({receiptId:'ok'})
  })
  try { await client.poll() } finally { ledger.close() }
  assert.deepEqual(outcomes.map(o=>o.verdict),['passed','rejected'])
  assert.deepEqual(outcomes.map(o=>o.submissionDigest),commands.map(c=>c.action.submission.digest))
})
