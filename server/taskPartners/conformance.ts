import type { PartnerApplication, PartnerConformanceRun } from '../../contract/taskPartners.ts'
import { randomInt } from 'node:crypto'
import { catalogDigest, day, fail, fields, id, iso, record, sha256, tokenId } from './protocol.ts'
import { samplesFor, type VerifierSamples } from './verifierSamples.ts'

type Artifact = { artifactId: string; digest: string; mediaType: string }
interface FixtureCommand {
  commandId: string; taskId: string; termsVersion: number; termsDigest: string; issuedAt: string; deadline: string
  environment: 'sandbox'; partnerId: string; state: 'requested' | 'succeeded' | 'failed' | 'uncertain'
  action: Record<string, unknown> & {kind:string}; receiptId?: string
}
interface Fixture {
  command: FixtureCommand; input?: Artifact & {bytes:string}; output?: Artifact; settlement?: 'release' | 'return'
  outputBytes?: string
  expectedVerdict?: 'passed' | 'rejected'
}
interface Acknowledgement { commandId: string; receiptId: string; state: 'succeeded' | 'failed' | 'uncertain' }
export interface SandboxReport {
  public: PartnerConformanceRun; primaryHost:string; startedAt: number; finishedAt?: number; commands: Fixture[]
  receipts: Record<string, {digest:string; acknowledgement:Acknowledgement}>; duplicateObserved: boolean
}
const bad = (message: string): never => fail(422, 'evidence_mismatch', message)
function artifact(text: string) {
  return {artifactId:id('fixture'), digest:sha256(text), mediaType:'text/plain', bytes:Buffer.from(text).toString('base64')}
}
function wire(a: Artifact): Artifact { return {artifactId:a.artifactId, digest:a.digest, mediaType:a.mediaType} }
function command(partnerId:string, taskId:string, action:FixtureCommand['action'], now:number): FixtureCommand {
  return {commandId:id('cmd'), partnerId, taskId, termsVersion:1, termsDigest:sha256(taskId), environment:'sandbox',
    issuedAt:iso(now), deadline:iso(now+day), state:'requested', action}
}
export function beginConformance(app: PartnerApplication, now: number, samples:VerifierSamples): SandboxReport {
  const reportId = id('report')
  const report: SandboxReport = {public:{reportId, applicationId:app.applicationId, state:'running', suiteVersion:'partner-v1',
    catalogDigest:catalogDigest(app.catalog), checks:[]}, primaryHost:new URL(app.organizationUrl).hostname,
    startedAt:now, commands:[], receipts:{}, duplicateObserved:false}
  const group = (name:string, detail:string) => report.public.checks.push({name,status:'pending',detail})
  if (app.catalog.models.length) group('run', 'Run each offered model and effort. Upload its output before signing the receipt.')
  for (const offer of app.catalog.models) for (const effort of offer.efforts.length ? offer.efforts : [undefined]) {
    const input = artifact('Return the word ready for the sandbox model conformance check.')
    report.commands.push({input, command:command(app.partnerId,id('fixture-task'),{kind:'run',model:offer.model,...(effort ? {effort}:{}),
      input:wire(input), submissionId:id('submission'),grantRef:id('fixture-grant'),maxInputTokens:256,maxOutputTokens:32}, now)})
  }
  if (app.catalog.assets.length) {
    group('reserve','Reserve separate test rewards for delivery and return. Use only sandbox balances.')
    group('release','Deliver the reserved sandbox reward to the bound recipient.')
    group('return','Return the second sandbox reservation to its original payer.')
  }
  for (const offered of app.catalog.assets) for (const settlement of ['release','return'] as const) {
    const asset = {...offered, quantity:'1'}
    report.commands.push({settlement, command:command(app.partnerId,id('fixture-task'),{kind:'reserve',asset,payerRef:id('fixture-payer'),
      grantRef:id('fixture-grant'),holdUntil:iso(now+2*day)},now)})
  }
  if (app.catalog.rules.length) group('verify','Run the sandbox passed and rejected vectors for each advertised checker.')
  for (const rule of app.catalog.rules) {
    const vectors=[...samplesFor(rule,samples)]
    for(let last=vectors.length-1;last>0;last--) {
      const index=randomInt(last+1)
      ;[vectors[last],vectors[index]]=[vectors[index],vectors[last]]
    }
    for(const sample of vectors) {
      const input={artifactId:id('fixture'),mediaType:sample.mediaType,bytes:sample.base64,digest:sha256(Buffer.from(sample.base64,'base64'))}
      report.commands.push({expectedVerdict:sample.verdict,input, command:command(app.partnerId,id('fixture-task'),{kind:'verify',rule:structuredClone(rule),
        submissionId:id('submission'),submission:wire(input),inputs:[]},now)})
    }
  }
  group('receipt-replay','Resend one identical signed receipt after its acknowledgement. Its receipt and command identities must stay unchanged.')
  return report
}
function same(input:unknown, expected:unknown): boolean {
  if (input === expected) return true
  if (!input || !expected || typeof input !== 'object' || typeof expected !== 'object' || Array.isArray(input) !== Array.isArray(expected)) return false
  const a = input as Record<string,unknown>, b=expected as Record<string,unknown>
  return Object.keys(a).length === Object.keys(b).length && Object.keys(b).every(k=>Object.hasOwn(a,k) && same(a[k],b[k]))
}
function summarize(report: SandboxReport, now:number) {
  for (const check of report.public.checks) {
    if (check.name === 'receipt-replay') { check.status = report.duplicateObserved ? 'passed' : 'pending'; continue }
    const entries = report.commands.filter(entry=>entry.command.action.kind === check.name)
    const settlementPending = ['release','return'].includes(check.name) && report.commands.some(entry =>
      entry.settlement === check.name && entry.command.state !== 'succeeded')
    check.status = entries.some(entry=>entry.command.state === 'failed') ? 'failed' :
      entries.length && !settlementPending && entries.every(entry=>entry.command.state === 'succeeded') ? 'passed' : 'pending'
  }
  if (report.public.checks.some(c=>c.status === 'failed')) report.public.state = 'failed'
  else if (report.public.checks.every(c=>c.status === 'passed')) { report.public.state='passed'; report.finishedAt=now }
}
export function applyFixtureReceipt(report:SandboxReport, entry:Fixture, claims:Record<string,unknown>, signed:string, audience:string, now:number) {
  const cmd=entry.command, action=cmd.action, grant=action.grantRef
  fields(claims,['iss','aud','jti','iat','environment','commandId','taskId','termsVersion','termsDigest','outcome'])
  const jti=tokenId(claims.jti), replayKey='receipt:'+jti
  if (claims.iss !== cmd.partnerId || claims.aud !== audience || claims.environment !== 'sandbox' || claims.commandId !== cmd.commandId ||
      claims.taskId !== cmd.taskId || claims.termsVersion !== cmd.termsVersion || claims.termsDigest !== cmd.termsDigest)
    bad('The receipt belongs to a different command or task.')
  const digest=sha256(signed), replay=report.receipts[replayKey]
  if (replay) {
    if (replay.digest !== digest) fail(409,'conflict','This receipt identifier is already bound.')
    observeReceiptReplay(report,entry,jti,now)
    return {...replay.acknowledgement}
  }
  if (report.public.state !== 'running' || now >= Date.parse(cmd.deadline) || !['requested','uncertain'].includes(cmd.state))
    fail(409,'conflict','The fixture command no longer accepts a new receipt.')
  if (typeof claims.iat !== 'number' || !Number.isSafeInteger(claims.iat) || claims.iat*1000 > now+60_000 ||
      claims.iat*1000 < Date.parse(cmd.issuedAt)-60_000) bad('The receipt time falls outside the command window.')
  const outcome=record(claims.outcome), kind=outcome.kind
  let state:Acknowledgement['state']='succeeded'
  if (kind === 'unknown' || kind === 'failed') {
    fields(outcome,['kind','actionKind','reasonCode'])
    tokenId(outcome.reasonCode)
    if (outcome.actionKind!==action.kind) bad('The reported action does not match.')
    state=kind === 'unknown'?'uncertain':'failed'
  } else if (kind !== action.kind) bad('The receipt does not answer the assigned action.')
  else if (kind === 'reserve') {
    fields(outcome,['kind','reservationId','asset','payerRef','grantRef','holdUntil'])
    const reservationId=tokenId(outcome.reservationId)
    if (!same(action.asset,outcome.asset) || outcome.payerRef!==action.payerRef || outcome.grantRef!==grant ||
        outcome.holdUntil!==action.holdUntil || report.commands.some(e=>e.command.action.reservationId===reservationId))
      bad('The reservation does not match the exact reward, payer, grant and deadline.')
    const next = entry.settlement === 'release' ?
      {kind:'release',asset:action.asset,reservationId,beneficiaryRef:id('fixture-recipient'),grantRef:id('receive'),submissionId:id('submission')} :
      {kind:'return',asset:action.asset,reservationId,payerRef:action.payerRef}
    report.commands.push({command:command(cmd.partnerId,cmd.taskId,next,now)})
  } else if (kind === 'release' || kind === 'return') {
    const expected = kind === 'release' ? ['asset','reservationId','beneficiaryRef','grantRef','submissionId'] : ['asset','reservationId','payerRef']
    fields(outcome,['kind',...expected,'transferRef'])
    tokenId(outcome.transferRef)
    if (!expected.every(k=>same(outcome[k],action[k]))) bad('The settlement is for a different reservation or account.')
  } else if (kind === 'run') {
    fields(outcome,['kind','providerRunId','grantRef','submissionId','inputDigest','actualModel','output'],['actualEffort'])
    tokenId(outcome.providerRunId)
    if (outcome.grantRef!==grant || outcome.submissionId!==action.submissionId || outcome.inputDigest!==entry.input?.digest ||
        outcome.actualModel!==action.model || outcome.actualEffort!==action.effort || !entry.output || !same(outcome.output,entry.output))
      bad('The execution receipt does not match the run, model, effort and uploaded output.')
  } else if (kind === 'verify') {
    fields(outcome,['kind','submissionId','submissionDigest','rule','verdict','detailCode'])
    tokenId(outcome.detailCode)
    if (outcome.submissionId!==action.submissionId || outcome.submissionDigest!==entry.input?.digest ||
        !same(outcome.rule,action.rule) || outcome.verdict!==entry.expectedVerdict) bad('The checker returned the wrong fixture verdict or input.')
  }
  const acknowledgement={receiptId:jti,commandId:cmd.commandId,state}
  cmd.state=state
  cmd.receiptId=jti
  report.receipts[replayKey]={digest,acknowledgement}
  summarize(report,now)
  return {...acknowledgement}
}
/** The HTTP retry cache and direct receipt replay are two doors onto the same
 * signed success. Seeing a matching acknowledged effect once suffices. */
export function observeReceiptReplay(report:SandboxReport, entry:Fixture, receiptId:string, now:number) {
  const ack=report.receipts['receipt:'+receiptId]?.acknowledgement
  if (!ack || ack.state !== 'succeeded' || ack.commandId !== entry.command.commandId ||
      entry.command.state !== 'succeeded' || entry.command.receiptId !== receiptId ||
      report.public.state !== 'running' || report.duplicateObserved || now >= Date.parse(entry.command.deadline)) return false
  report.duplicateObserved=true
  summarize(report,now)
  return true
}

export function expireConformance(report:SandboxReport, now:number) {
  if (now<report.startedAt+day) return false
  let changed=false
  if (report.public.state==='running') {
    report.public.state='failed'
    report.finishedAt=now
    for (const check of report.public.checks) if (check.status==='pending') {
      check.status='failed'
      check.detail='The sandbox deadline passed before this check completed.'
    }
    changed=true
  }
  for (const entry of report.commands) {
    if (!entry.output || entry.command.state==='succeeded') continue
    delete entry.output
    delete entry.outputBytes
    changed=true
  }
  return changed
}
