import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sandbox='sandbox.agent-commons.example.com'
const api='/v1/task-partners'
const audience='https://'+sandbox+api
const key=generateKeyPairSync('ed25519')
function jwt(typ:string,claims:object) {
  const encode=(v:object)=>Buffer.from(JSON.stringify(v)).toString('base64url')
  const message=encode({alg:'Ed25519',kid:'service',typ})+'.'+encode(claims)
  return message+'.'+sign(null,Buffer.from(message),key.privateKey).toString('base64url')
}
const sha256=(s:Buffer)=>createHash('sha256').update(s).digest()

test('sandbox enrollment crosses the public HTTP mount, signed proofs, OAuth form, artifact bytes and replayed signed receipts',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'partner-enrollment-')), dnsFile=join(dir,'dns.json')
  writeFileSync(dnsFile,'{}')
  // The server runs its normal entry point. Only DNS answers are fixtures.
  // Report the OS-assigned listen address without reserving a port in advance.
  const bootstrap=[
    "import {Server} from 'node:http'",
    "import {Resolver} from 'node:dns/promises'",
    "import {readFileSync} from 'node:fs'",
    "Resolver.prototype.resolveTxt=async name=>(JSON.parse(readFileSync(process.env.TEST_PARTNER_DNS,'utf8'))[name]??[]).map(s=>[s])",
    "const listen=Server.prototype.listen",
    "Server.prototype.listen=function(...args){this.once('listening',()=>process.send({port:this.address().port}));return listen.apply(this,args)}",
  ].join('\n')
  const child=fork(fileURLToPath(new URL('../index.ts',import.meta.url)),[],{
    execArgv:['--import','data:text/javascript;base64,'+Buffer.from(bootstrap).toString('base64')],
    silent:true,env:{...process.env,PORT:'0',HOST:'127.0.0.1',AUTH_GATE:'require',IDENTITY_HEADERS:'deny',
      AUTH_SECRET:randomBytes(32).toString('hex'),AUTH_COOKIE_SECURE:'off',CORS_ORIGIN:'https://commons.example.com',
      MODEL_INLINE:'0',INITIAL_WORLD:'demo',PERSIST_BACKEND:'json',DATA_FILE:join(dir,'state.json'),
      TASK_PARTNER_WEB_ORIGIN:'https://commons.example.com',TASK_PARTNER_SANDBOX_ORIGIN:'https://'+sandbox,
      TASK_PARTNER_BADGE_ORIGIN:'https://badge.commons.example.com',TEST_PARTNER_DNS:dnsFile},
  })
  let errors=''
  child.stderr?.on('data',chunk=>{errors=(errors+chunk).slice(-2000)})
  child.stdout?.resume()
  const exited=once(child,'exit')
  t.after(async()=>{
    if(child.exitCode===null && !child.signalCode) child.kill('SIGTERM')
    await exited
    rmSync(dir,{recursive:true,force:true})
  })
  const [{port}]=await Promise.race([once(child,'message',{signal:t.signal}),exited.then(()=>{throw Error('Partner server exited during startup. '+errors)})])
  async function wire(method:string,path:string,body?:Buffer,headers:Record<string,string>={}) {
    return new Promise<{status:number; bytes:Buffer; headers:Record<string,unknown>}>((resolve,reject)=>{
      const req=request({host:'127.0.0.1',port,method,path,headers:{host:sandbox,...headers}},res=>{
        const chunks:Buffer[]=[]
        res.on('data',b=>chunks.push(b))
        res.on('end',()=>resolve({status:res.statusCode!,bytes:Buffer.concat(chunks),headers:res.headers}))
        res.on('error',reject)
      })
      req.on('error',reject)
      req.end(body)
    })
  }
  async function json(status:number,method:string,path:string,body?:unknown,headers:Record<string,string>={}) {
    const res=await wire(method,path,body===undefined?undefined:Buffer.from(JSON.stringify(body)),
      {'content-type':'application/json',...(method==='POST'?{'idempotency-key':randomUUID()}:{}),...headers})
    assert.equal(res.status,status,path+' '+res.bytes.toString().slice(0,400))
    return JSON.parse(res.bytes.toString())
  }
  await json(404,'GET','/api/v1/task-partners/production/catalog')
  await json(404,'GET','/mcp')
  const login=await json(200,'POST','/api/v1/auth/login',{email:'ada@acme.example',password:'ada-demo-password',transport:'bearer'},{host:'commons.example.com'})
  const admin={authorization:'Bearer '+login.token}
  const a=await json(201,'POST',api+'/applications',{organization:'Orchard Works',displayName:'Orchard',contact:'admin@orchard.com',
    recoveryContact:'Recovery team',organizationUrl:'https://orchard.com',handoffUrl:'https://login.orchard.com/confirm',
    publicKey:{...key.publicKey.export({format:'jwk'}),kid:'service'},capabilities:['model-provider'],
    catalog:{models:[{model:'orchard-v1',efforts:['high']}],assets:[],rules:[]}},admin)
  const app=api+'/applications/'+a.applicationId
  let now=Math.floor(Date.now()/1000)
  const proof={iss:a.partnerId,aud:a.challenge.audience,jti:randomUUID(),iat:now,exp:now+240,
    environment:'sandbox',applicationId:a.applicationId,kid:'service',nonce:a.challenge.nonce}
  await json(401,'POST',app+'/proofs',{signedProof:jwt('partner-key-proof+jwt',{...proof,aud:'other'})},admin)
  let active=await json(200,'POST',app+'/proofs',{signedProof:jwt('partner-key-proof+jwt',proof)},admin)
  const dns:Record<string,string[]>={}
  for(const purpose of ['website','handoff']) {
    const challenge=await json(201,'POST',app+'/domain-challenges',{purpose,expectedRevision:active.revision},admin)
    dns[challenge.recordName+'.']=[challenge.recordValue]
    writeFileSync(dnsFile,JSON.stringify(dns))
    const checked=await json(200,'GET',app+'/domain-challenges/'+challenge.challengeId,undefined,admin)
    assert.equal(checked.state,'verified')
    active=await json(200,'GET',app,undefined,admin)
  }
  assert.equal(active.state,'sandbox_testing')
  const suite=await json(202,'POST',app+'/conformance',{expectedRevision:active.revision},admin)
  now=Math.floor(Date.now()/1000)
  const assertion=jwt('partner-client-auth+jwt',{iss:a.partnerId,sub:a.partnerId,aud:audience+'/oauth/token',jti:randomUUID(),iat:now,exp:now+240})
  const form=Buffer.from(new URLSearchParams({grant_type:'client_credentials',client_id:a.partnerId,
    client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',client_assertion:assertion,
    scope:'commands:read artifacts:read artifacts:write receipts:write'}).toString())
  const formHeaders={'content-type':'application/x-www-form-urlencoded'}
  const token=await wire('POST',api+'/oauth/token',form,formHeaders)
  assert.equal(token.status,200)
  assert.equal((await wire('POST',api+'/oauth/token',form,formHeaders)).status,401)
  const worker={authorization:'Bearer '+JSON.parse(token.bytes.toString()).access_token}
  const feed=await json(200,'GET',api+'/commands',undefined,worker)
  const [cmd]=feed.items
  const command=api+'/commands/'+cmd.commandId
  const input=await wire('GET',command+'/artifacts/'+cmd.action.input.artifactId,undefined,worker)
  assert.equal(input.status,200)
  assert.equal(sha256(input.bytes).toString('hex'),cmd.action.input.digest)
  const output=Buffer.from('ready'), digest=sha256(output)
  const uploaded=await wire('POST',command+'/artifacts',output,{...worker,'idempotency-key':randomUUID(),
    'content-type':'application/octet-stream','x-artifact-media-type':'text/plain','content-digest':'sha-256=:'+digest.toString('base64')+':'})
  assert.equal(uploaded.status,201,uploaded.bytes.toString())
  const artifact=JSON.parse(uploaded.bytes.toString())
  assert.equal(artifact.digest,digest.toString('hex'))
  const receipt={signedReceipt:jwt('partner-receipt+jwt',{iss:a.partnerId,aud:audience,jti:randomUUID(),iat:Math.floor(Date.now()/1000),
    environment:'sandbox',commandId:cmd.commandId,taskId:cmd.taskId,termsVersion:cmd.termsVersion,termsDigest:cmd.termsDigest,
    outcome:{kind:'run',providerRunId:'fixture-run',submissionId:cmd.action.submissionId,grantRef:cmd.action.grantRef,
      inputDigest:cmd.action.input.digest,actualModel:cmd.action.model,actualEffort:cmd.action.effort,output:artifact}})}
  const retry={...worker,'idempotency-key':randomUUID()}
  const ack=await json(200,'POST',command+'/receipts',receipt,retry)
  assert.deepEqual(await json(200,'POST',command+'/receipts',receipt,retry),ack)
  const report=await json(200,'GET',app+'/conformance/'+suite.reportId,undefined,admin)
  assert.equal(report.state,'passed')
  await json(401,'GET',api+'/commands',undefined,{authorization:'Bearer acp_'+'x'.repeat(43)})
})
