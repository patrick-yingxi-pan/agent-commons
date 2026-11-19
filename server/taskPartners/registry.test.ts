import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PartnerRegistry, PartnerRegistryError } from './registry.ts'
import { collision, comparisonKeys, partnerWebsite } from './identity.ts'
import { day, iso, sha256 } from './protocol.ts'

const owner = {userId:'u1',tenantId:'tenant1',operator:false,organizationAdmin:true,freshAuth:true}
const other = {userId:'u2',tenantId:'tenant2',operator:false,organizationAdmin:true,freshAuth:true}
const maintainer = {...other,operator:true}
const audience = (env:string) => 'https://' + env + '.commons.example.com/v1/task-partners'
function keys(kid:string) {
  const k = generateKeyPairSync('ed25519')
  const {kty,crv,x} = k.publicKey.export({format:'jwk'})
  return { privateKey:k.privateKey, publicKey:{kty,crv,x,kid} }
}
function signed(key:KeyObject,kid:string,typ:string,claims:unknown) {
  const encoded=(o:unknown)=>Buffer.from(JSON.stringify(o)).toString('base64url')
  const data=encoded({alg:'Ed25519',kid,typ})+'.'+encoded(claims)
  return data+'.'+sign(null,Buffer.from(data),key).toString('base64url')
}
function world() {
  let time=Date.UTC(2026,0,1)
  const txt=new Map<string,string[]>(), now=()=>time
  const opts={now,audience,resolveTxt:async (host:string)=>(txt.get(host)??[]).map(value=>[value]),
    verifierSamples:()=>[{mediaType:'text/plain',base64:'Mg==',verdict:'passed' as const},
      {mediaType:'text/plain',base64:'Mw==',verdict:'rejected' as const}]}
  const registry=new PartnerRegistry(opts)
  const request=(key:ReturnType<typeof keys>,site='orchard.example.com')=>({
    displayName:'Orchard Works',organization:'Orchard Ltd',contact:'hello@'+site,organizationUrl:'https://'+site,
    handoffUrl:'https://auth.'+site+'/confirm',recoveryContact:'recover@'+site,capabilities:['custodian'],
    catalog:{models:[],assets:[{assetId:'voucher',unit:'each'}],rules:[]},publicKey:key.publicKey,
  })
  async function enroll(env:'sandbox'|'production', key:ReturnType<typeof keys>,site?:string,sandboxReportId?:string, changes={}) {
    const a=registry.apply(owner,env,{...request(key,site),...changes,...(sandboxReportId?{sandboxReportId}:{})}), c=a.challenge!
    const claims={iss:a.partnerId,aud:c.audience,jti:'key-proof',iat:now()/1000,exp:now()/1000+299,
      applicationId:a.applicationId,environment:env,kid:c.kid,nonce:c.nonce}
    const proof={signedProof:signed(key.privateKey,c.kid,'partner-key-proof+jwt',claims)}
    registry.proveKey(owner,env,a.applicationId,proof)
    assert.throws(()=>registry.proveKey(owner,env,a.applicationId,proof))
    for(const purpose of ['website','handoff']){
      const app=registry.application(owner,env,a.applicationId)
      const challenge=registry.issueDomain(owner,env,a.applicationId,{purpose,expectedRevision:app.revision})
      assert.equal((await registry.checkDomain(owner,env,a.applicationId,challenge.challengeId)).state,'pending')
      txt.set(challenge.recordName+'.',[challenge.recordValue])
      assert.equal((await registry.checkDomain(owner,env,a.applicationId,challenge.challengeId)).state,'verified')
    }
    return registry.application(owner,env,a.applicationId)
  }
  return {registry,opts,txt,now,request,enroll,advance:(ms:number)=>time+=ms}
}
function failure(status:number) {
  return (error:unknown)=>error instanceof PartnerRegistryError && error.status===status
}

test('syntax, registrable domains and complete Unicode dataset cover tricky partner identities',()=>{
  const vectors=JSON.parse(readFileSync(new URL('../../docs/design/task-partner-api.openapi.json',import.meta.url),'utf8'))['x-partner-name-vectors']
  for(const v of vectors) assert.deepEqual(collision(comparisonKeys(v.leftName,v.leftDomain),comparisonKeys(v.rightName,v.rightDomain)),v.expectedSignals)
  assert.equal(comparisonKeys('Straße','').normalized,comparisonKeys('STRASSE','').normalized)
  assert.equal(comparisonKeys('A1<שׂ','').skeleton,comparisonKeys('Αשֺ>1','').skeleton)
  for(const site of ['https://co.uk','https://github.io','https://foo.ck','https://127.0.0.1',
    'https://user@orchard.com','https://orchard.local','https://orchard.com:7443'])
    assert.throws(()=>partnerWebsite(site,'website'),failure(400),site)
  assert.equal(partnerWebsite('https://orchard.github.io','website').hostname,'orchard.github.io')
  assert.equal(partnerWebsite('https://www.ck','website').hostname,'www.ck')
})
test('applicant ownership, key binding, DNS challenge freshness and catalog visibility are enforced',async()=>{
  const w=world(), key=keys('sandbox-key'), registry=w.registry
  const invalidKey={...key.publicKey,x:Buffer.alloc(32).toString('base64url')}
  assert.throws(()=>registry.apply(owner,'sandbox',{...w.request(key),publicKey:invalidKey}),failure(400))
  assert.throws(()=>registry.apply({...owner,organizationAdmin:false},'sandbox',w.request(key)),failure(403))
  const a=registry.apply(owner,'sandbox',w.request(key))
  assert.throws(()=>registry.issueDomain({...owner,freshAuth:false},'sandbox',a.applicationId,{purpose:'website',expectedRevision:a.revision}),failure(403))
  assert.throws(()=>registry.application(other,'sandbox',a.applicationId),failure(404))
  assert.equal(registry.application({...owner,userId:'new-admin'},'sandbox',a.applicationId).viewer?.canManage,true)
  assert.equal(registry.application(maintainer,'sandbox',a.applicationId).viewer?.canReview,true)
  assert.throws(()=>registry.publicProfile(a.partnerId),failure(404))
  const c=registry.issueDomain(owner,'sandbox',a.applicationId,{purpose:'website',expectedRevision:a.revision})
  w.advance(day)
  w.txt.set(c.recordName+'.',[c.recordValue])
  assert.equal((await registry.checkDomain(owner,'sandbox',a.applicationId,c.challengeId)).state,'expired')
  assert.deepEqual(registry.catalog(),[])
  assert.throws(()=>registry.conformance(owner,'sandbox',a.applicationId,{expectedRevision:registry.application(owner,'sandbox',a.applicationId).revision}),failure(409))
})
test('signed sandbox custody commands precede independent approval, published profile, scoped tokens and immediate suspension',async()=>{
  const w=world(), r=w.registry, sandbox=keys('s'),prod=keys('p')
  const a=await w.enroll('sandbox',sandbox)
  const report=r.conformance(owner,'sandbox',a.applicationId,{expectedRevision:a.revision})
  let count=0
  function run() {
    const commands=r.sandboxCommands(a.partnerId)
    for(const command of commands){
      const input=command.action
      const outcome=input.kind==='reserve'?{...input,reservationId:'reservation-'+count}:{...input,transferRef:'transfer-'+count}
      const claims={iss:a.partnerId,aud:audience('sandbox'),jti:'r'+count++,iat:w.now()/1000,environment:'sandbox',
        commandId:command.commandId,taskId:command.taskId,termsVersion:command.termsVersion,termsDigest:command.termsDigest,outcome}
      const body={signedReceipt:signed(sandbox.privateKey,'s','partner-receipt+jwt',claims)}
      const worker={userId:a.partnerId,tenantId:'partner-worker',operator:false,organizationAdmin:false}
      const submit=()=>r.mutate(worker,'sandbox','receipts:write',command.commandId,'same-logical-receipt',body,
        ()=>r.sandboxReceipt(a.partnerId,command.commandId,body),ack=>r.sandboxReplay(a.partnerId,command.commandId,ack.receiptId))
      const receipt=submit()
      assert.deepEqual(submit(),receipt)
      const auditCount=r.history(owner,'sandbox',a.applicationId).length
      assert.deepEqual(submit(),receipt)
      assert.equal(r.history(owner,'sandbox',a.applicationId).length,auditCount)
    }
  }
  run();run()
  assert.equal(count,4)
  assert.equal(r.report(owner,'sandbox',a.applicationId,report.reportId).state,'passed')
  assert.throws(()=>r.apply(owner,'production',{...w.request(sandbox),sandboxReportId:report.reportId}),failure(409))
  const production=await w.enroll('production',prod,undefined,report.reportId)
  const decision={expectedRevision:production.revision,action:'approve',acceptedCapabilities:['custodian'],reason:'Sandbox and recovery reviewed.'}
  assert.throws(()=>r.decide({...owner,operator:true},'production',production.applicationId,decision),failure(403))
  const accepted=r.decide(maintainer,'production',production.applicationId,decision)
  const p=r.publicProfile(accepted.partnerId)
  assert.equal(p.status,'active');assert.deepEqual(p.capabilities,['custodian'])
  assert.deepEqual(r.catalog({domainAscii:'orchard.example.com'}).map(p=>p.partnerId),[p.partnerId])
  assert.ok(!('contact' in p) && !('keys' in p))
  const claims={iss:p.partnerId,sub:p.partnerId,aud:audience('production')+'/oauth/token',jti:'token-nonce',iat:w.now()/1000,exp:w.now()/1000+200}
  const auth={grant_type:'client_credentials',client_id:p.partnerId,scope:'commands:read',
    client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion:signed(prod.privateKey,'p','partner-client-auth+jwt',claims)}
  const token=r.issueToken('production',auth)
  assert.equal(r.authorizeWorker('production',token.access_token,'commands:read').keyId,'p')
  assert.throws(()=>r.authorizeWorker('production',token.access_token,'receipts:write'),failure(403))
  assert.throws(()=>r.issueToken('production',auth),failure(401))
  const restored=new PartnerRegistry(w.opts);restored.restore(r.snapshot())
  assert.deepEqual(restored.publicProfile(p.partnerId),p)
  assert.equal(restored.authorizeWorker('production',token.access_token,'commands:read').partnerId,p.partnerId)
  const moved=new PartnerRegistry({...w.opts,audience:()=> 'https://replacement.example.org/v1/task-partners'})
  moved.restore(r.snapshot())
  assert.throws(()=>moved.authorizeWorker('production',token.access_token,'commands:read'),failure(401))
  const suspended=restored.decide(maintainer,'production',accepted.applicationId,{action:'suspend',reason:'Incident',expectedRevision:accepted.revision})
  assert.throws(()=>restored.authorizeWorker('production',token.access_token,'commands:read'),failure(401))
  assert.deepEqual(restored.publicProfile(p.partnerId).capabilities,[])
  restored.decide(maintainer,'production',accepted.applicationId,{action:'resume',reason:'Resolution verified',expectedRevision:suspended.revision})
  assert.throws(()=>restored.authorizeWorker('production',token.access_token,'commands:read'),failure(401))
  const tampered=r.snapshot()
  tampered.workers.tokens[0].partnerId='unregistered'
  assert.throws(()=>restored.restore(tampered),/Invalid partner token/)
  assert.equal(restored.publicProfile(p.partnerId).status,'active')
  w.advance(day+1)
  assert.equal(r.publicProfile(p.partnerId).status,'verification_lapsed')
  assert.deepEqual(r.catalog(),[])
})
test('business changes and replay receipts survive restore with stable JSON ordering',()=>{
  const w=world(), key=keys('one'), req=w.request(key)
  const a=w.registry.mutate(owner,'sandbox','apply','applications','same-key',req,()=>w.registry.apply(owner,'sandbox',req))
  const copy=new PartnerRegistry(w.opts);copy.restore(w.registry.snapshot())
  assert.deepEqual(copy.mutate(owner,'sandbox','apply','applications','same-key',Object.fromEntries(Object.entries(req).reverse()),
    ()=>assert.fail('application created twice')),a)
  assert.throws(()=>copy.mutate(owner,'sandbox','apply','applications','same-key',{...req,displayName:'Different'},()=>null),failure(409))
})

test('published organizations with matching names stay distinguishable through renames and domain replacement',async()=>{
  const w=world(), registry=w.registry
  async function publish(displayName:string, host:string) {
    const signing=keys('sandbox')
    const options={displayName,capabilities:['model-provider'],catalog:{models:[{model:'fixture',efforts:[]}],assets:[],rules:[]}}
    const sandbox=await w.enroll('sandbox',signing,host,undefined,options)
    const report=registry.conformance(owner,'sandbox',sandbox.applicationId,{expectedRevision:sandbox.revision})
    const [command]=registry.sandboxCommands(sandbox.partnerId)
    const {action}=command, bytes=Buffer.from('ready')
    const output=registry.sandboxUpload(sandbox.partnerId,command.commandId,bytes,'text/plain',sha256(bytes))
    const input=action.input as {digest:string}
    const claims={iss:sandbox.partnerId,aud:audience('sandbox'),environment:'sandbox',jti:'example-run',
      iat:w.now()/1000,commandId:command.commandId,taskId:command.taskId,termsVersion:command.termsVersion,
      termsDigest:command.termsDigest,outcome:{kind:'run',providerRunId:'example',submissionId:action.submissionId,
        grantRef:action.grantRef,inputDigest:input.digest,actualModel:action.model,output}}
    const receipt={signedReceipt:signed(signing.privateKey,'sandbox','partner-receipt+jwt',claims)}
    registry.sandboxReceipt(sandbox.partnerId,command.commandId,receipt)
    registry.sandboxReceipt(sandbox.partnerId,command.commandId,receipt)
    const prod=await w.enroll('production',keys('production'),host,report.reportId,options)
    return registry.decide(maintainer,'production',prod.applicationId,{action:'approve',expectedRevision:prod.revision,
      acceptedCapabilities:['model-provider'],reason:'Confirmed independent domain and capability evidence.'})
  }
  const orchard=await publish('Orchard Works','orchard.example.com')
  const forge=await publish('Zinc Forge','forge.example.net')
  const before=registry.publicProfile(forge.partnerId).identity
  const peers=(partnerId:string)=>registry.publicProfile(partnerId).identity.relatedPartners
  assert.deepEqual(peers(orchard.partnerId),[])
  const change=(name:string)=>({displayName:name,expectedRevision:registry.application(owner,'production',forge.applicationId).revision})
  assert.throws(()=>registry.rename(other,'production',forge.applicationId,change('Different')),failure(404))
  registry.rename(owner,'production',forge.applicationId,change('Orchard Works'))
  assert.deepEqual(peers(orchard.partnerId),[forge.partnerId])
  assert.deepEqual(peers(forge.partnerId),[orchard.partnerId])
  assert.deepEqual(new Set(registry.catalog({name:'Orchard Works'}).map(p=>p.identity.domainAscii)),
    new Set(['orchard.example.com','forge.example.net']))
  const identity=registry.publicProfile(forge.partnerId).identity
  assert.equal(identity.identityRevision,before.identityRevision)
  assert.equal(identity.profilePath,before.profilePath)
  assert.equal(identity.domainAscii,before.domainAscii)
  registry.rename(owner,'production',forge.applicationId,change('Оrchard Works')) // Cyrillic letter O
  assert.deepEqual(peers(orchard.partnerId),[forge.partnerId])
  assert.ok(registry.publicProfile(forge.partnerId).identity.collisionSignals.includes('confusable_name'))
  registry.rename(owner,'production',forge.applicationId,change('Zinc Forge'))
  assert.deepEqual(peers(orchard.partnerId),[])
  const replacement=registry.issueDomain(owner,'production',forge.applicationId,{purpose:'website',
    expectedRevision:change('').expectedRevision,replacementUrl:'https://zinc.example.net'})
  w.txt.set(replacement.recordName+'.',[replacement.recordValue])
  await registry.checkDomain(owner,'production',forge.applicationId,replacement.challengeId)
  const after=registry.publicProfile(forge.partnerId)
  assert.equal(after.identity.identityRevision,before.identityRevision+1)
  assert.equal(after.identity.domainAscii,'zinc.example.net')
  assert.equal(registry.application(owner,'production',forge.applicationId).state,'in_review')
  assert.deepEqual(after.capabilities,[])
  assert.throws(()=>registry.machineEnrollment('production',forge.partnerId),failure(409))
  const saved=new PartnerRegistry(w.opts)
  saved.restore(registry.snapshot())
  assert.deepEqual(saved.publicProfile(forge.partnerId),after)
})

test('assigned model and checker commands inspect actual bytes, bind evidence, and reconcile an uncertain run by original ID',async()=>{
  const w=world(), r=w.registry, provider=keys('sandbox'), stranger=keys('elsewhere')
  const catalog={models:[{model:'example-model',efforts:['high','low']}],assets:[{assetId:'voucher',unit:'each'}],
    rules:[{ruleId:'check-v1',version:1,digest:sha256('exact checker manifest')}]}
  const app=await w.enroll('sandbox',provider,undefined,undefined,{capabilities:['model-provider','custodian','verifier'],catalog})
  const otherApp=await w.enroll('sandbox',stranger,'separate.example.com')
  const suite=r.conformance(owner,'sandbox',app.applicationId,{expectedRevision:app.revision})
  const initial=r.sandboxCommands(app.partnerId)
  const run=initial.find(c=>c.action.kind==='run')!
  const data=run.action.input as {artifactId:string;digest:string}
  assert.equal(sha256(r.sandboxArtifact(app.partnerId,run.commandId,data.artifactId).bytes),data.digest)
  assert.throws(()=>r.sandboxArtifact(otherApp.partnerId,run.commandId,data.artifactId),failure(404))
  const bytes=Buffer.from('ready'), digest=sha256(bytes)
  assert.throws(()=>r.sandboxUpload(app.partnerId,run.commandId,bytes,'text/plain',sha256('other')),failure(400))
  const output=r.sandboxUpload(app.partnerId,run.commandId,bytes,'text/plain',digest)
  assert.equal(r.sandboxArtifact(app.partnerId,run.commandId,output.artifactId).bytes.toString(),'ready')
  type Cmd = typeof run
  function answer(cmd:Cmd,jti:string,outcome:unknown, signing=provider, additions={}) {
    const claims={iss:app.partnerId,aud:audience('sandbox'),environment:'sandbox',jti,iat:w.now()/1000,commandId:cmd.commandId,
      taskId:cmd.taskId,termsVersion:cmd.termsVersion,termsDigest:cmd.termsDigest,outcome,...additions}
    return r.sandboxReceipt(app.partnerId,cmd.commandId,{signedReceipt:signed(signing.privateKey,'sandbox','partner-receipt+jwt',claims)})
  }
  const result={kind:'run',providerRunId:'run-1',submissionId:run.action.submissionId,grantRef:run.action.grantRef,
    inputDigest:data.digest,actualModel:run.action.model,actualEffort:'high',output}
  assert.throws(()=>answer(run,'wrong-key',result,stranger),failure(401))
  assert.throws(()=>answer(run,'different-task',result,provider,{termsVersion:2}),failure(422))
  assert.equal(answer(run,'unknown',{kind:'unknown',actionKind:'run',reasonCode:'ack_lost'}).state,'uncertain')
  assert.equal(r.sandboxCommand(app.partnerId,run.commandId).state,'uncertain')
  assert.ok(!r.sandboxCommands(app.partnerId).some(c=>c.commandId===run.commandId))
  const receipt=answer(run,'confirmed',result)
  assert.deepEqual(answer(run,'confirmed',result),receipt)
  for (const cmd of initial.filter(c=>c.action.kind==='verify')) {
    const input=cmd.action.submission as {artifactId:string;digest:string}
    const n=Number(r.sandboxArtifact(app.partnerId,cmd.commandId,input.artifactId).bytes.toString())
    const expectedVerdict=n%2===0?'passed':'rejected'
    assert.equal(answer(cmd,'receipt-'+expectedVerdict,{kind:'verify',submissionId:cmd.action.submissionId,
      submissionDigest:input.digest,rule:cmd.action.rule,verdict:expectedVerdict,detailCode:'fixture_result'}).state,'succeeded')
  }
  assert.equal(r.report(owner,'sandbox',app.applicationId,suite.reportId).state,'running','pending custody checks prevent approval')
  const pending=initial.find(c=>c.action.kind==='run' && c.action.effort==='low')!
  const unused=r.sandboxUpload(app.partnerId,pending.commandId,bytes,'text/plain',digest)
  const corrupted=r.snapshot(), savedRun=corrupted.rows[0].reports[0].commands.find(f=>f.command.commandId===run.commandId)!
  savedRun.outputBytes=Buffer.from('altered').toString('base64')
  assert.throws(()=>r.restore(corrupted),/Invalid persisted task-partner enrollment/)
  w.advance(day+1)
  await r.recheckDue()
  assert.equal(r.report(owner,'sandbox',app.applicationId,suite.reportId).state,'failed')
  assert.throws(()=>r.sandboxArtifact(app.partnerId,pending.commandId,unused.artifactId),failure(404))
  assert.equal(sha256(r.sandboxArtifact(app.partnerId,run.commandId,output.artifactId).bytes),digest)
})
test('restore rejects inconsistent grants, keys and domain bindings before changing live state',async()=>{
  const w=world(), app=await w.enroll('sandbox',keys('s')), before=w.registry.snapshot()
  for (const edit of [
    (s:typeof before)=>{s.rows[0].app.keys[0].thumbprint='bogus'},
    (s:typeof before)=>{s.rows[0].app.state='active';s.rows[0].published=true},
    (s:typeof before)=>{s.rows[0].bindings.website=s.rows[0].bindings.handoff},
    (s:typeof before)=>{s.rows[0].history[0].revision=999},
  ]) {
    const changed=structuredClone(before);edit(changed)
    assert.throws(()=>w.registry.restore(changed),undefined,edit.toString())
    assert.equal(w.registry.application(owner,'sandbox',app.applicationId).revision,app.revision)
  }
})
test('an expired domain can be renewed by a scoped worker only at its previously proven host',async()=>{
  const w=world(), key=keys('proof'), app=await w.enroll('sandbox',key), r=w.registry
  w.advance(day+1)
  assert.throws(()=>r.machineEnrollment('sandbox',app.partnerId),failure(409))
  const claims={iss:app.partnerId,sub:app.partnerId,aud:audience('sandbox')+'/oauth/token',jti:'renew',
    iat:Math.floor(w.now()/1000),exp:Math.floor(w.now()/1000)+200}
  const auth={grant_type:'client_credentials',client_id:app.partnerId,scope:'domains:renew',
    client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion:signed(key.privateKey,'proof','partner-client-auth+jwt',claims)}
  const token=r.issueToken('sandbox',auth).access_token
  assert.throws(()=>r.authorizeWorker('sandbox',token,'commands:read'),failure(403))
  assert.throws(()=>r.workerDomainIssue('sandbox',token,'foreign',{purpose:'website',expectedRevision:app.revision}),failure(404))
  assert.throws(()=>r.workerDomainIssue('sandbox',token,app.applicationId,{purpose:'website',expectedRevision:app.revision,
    replacementUrl:'https://someone.example.com'}),failure(400))
  const renewal=r.workerDomainIssue('sandbox',token,app.applicationId,{purpose:'website',expectedRevision:app.revision})
  w.txt.set(renewal.recordName+'.',[renewal.recordValue])
  assert.equal((await r.workerDomainCheck('sandbox',token,app.applicationId,renewal.challengeId)).state,'verified')
  await r.recheckDue()
  assert.equal(r.machineEnrollment('sandbox',app.partnerId).identityRevision,1)
  w.advance(day/2)
  w.txt.clear()
  await r.recheckDue()
  assert.throws(()=>r.machineEnrollment('sandbox',app.partnerId),failure(409))
})

test('rotation requires a new private-key proof and retiring-key revocation invalidates only its own tokens',async()=>{
  const w=world(), r=w.registry, first=keys('original'), next=keys('replacement')
  const app=await w.enroll('sandbox',first)
  const issue=(key:ReturnType<typeof keys>,kid:string,jti:string)=>r.issueToken('sandbox',{
    grant_type:'client_credentials',client_id:app.partnerId,scope:'commands:read',
    client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion:signed(key.privateKey,kid,'partner-client-auth+jwt',{iss:app.partnerId,sub:app.partnerId,
      aud:audience('sandbox')+'/oauth/token',jti,iat:w.now()/1000,exp:w.now()/1000+180}),
  }).access_token
  const old=issue(first,'original','before')
  const registered=r.keyChange(owner,'sandbox',app.applicationId,{action:'register',expectedRevision:app.revision,publicKey:next.publicKey})
  assert.throws(()=>issue(next,'replacement','unproven'),failure(401))
  const c=registered.challenge!
  const claims={iss:app.partnerId,aud:c.audience,jti:'key-rotation',iat:w.now()/1000,exp:w.now()/1000+180,
    applicationId:app.applicationId,environment:'sandbox',kid:'replacement',nonce:c.nonce}
  const proof={signedProof:signed(next.privateKey,'replacement','partner-key-proof+jwt',claims)}
  const moved=new PartnerRegistry({...w.opts,audience:()=> 'https://another.example.org/v1/task-partners'})
  moved.restore(r.snapshot())
  assert.throws(()=>moved.proveKey(owner,'sandbox',app.applicationId,proof),failure(401))
  const active=r.proveKey(owner,'sandbox',app.applicationId,proof)
  const current=issue(next,'replacement','after')
  assert.equal(r.authorizeWorker('sandbox',old,'commands:read').keyId,'original')
  r.keyChange(owner,'sandbox',app.applicationId,{action:'revoke',expectedRevision:active.revision,kid:'original',reason:'Rotation completed.'})
  assert.throws(()=>r.authorizeWorker('sandbox',old,'commands:read'),failure(401))
  assert.equal(r.authorizeWorker('sandbox',current,'commands:read').keyId,'replacement')
  w.advance(-1000)
  assert.throws(()=>r.machineEnrollment('sandbox',app.partnerId),failure(409))
})
