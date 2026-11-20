import type { PartnerEnrollmentRow } from './registry.ts'
import { enrollment } from './enrollment.ts'
import { partnerWebsite } from './identity.ts'
import { catalogDigest, identifier, publicKey, sha256, thumbprint } from './protocol.ts'
import { partnerCapabilities } from '../../contract/taskPartners.ts'

const invalid = (): never => { throw new Error('Invalid persisted task-partner enrollment.') }
const utc = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value
const revision = (value: number) => Number.isSafeInteger(value) && value >= 1 && value <= 2_147_483_647
const knownId = (value: unknown): value is string => typeof value === 'string' && identifier.test(value)
export function validateEnrollmentRow(row: PartnerEnrollmentRow) {
  const a=row.app
  if (a?.demo !== undefined && a.demo !== true) invalid()
  if (!a || !knownId(a.applicationId) || !knownId(a.partnerId) || !knownId(row.owner?.userId) || !knownId(row.owner?.tenantId) ||
      !['sandbox','production'].includes(a.environment) ||
      !['awaiting_proof','sandbox_testing','in_review','active','suspended','revoked','rejected'].includes(a.state) ||
      !revision(a.revision) || !revision(row.identityRevision) || typeof row.published !== 'boolean' ||
      !Array.isArray(a.keys) || !Array.isArray(row.keyMaterial) || !row.keyMaterial.length || row.keyMaterial.length > 16 ||
      a.keys.length !== row.keyMaterial.length || new Set(a.keys.map(k=>k.kid)).size !== a.keys.length ||
      !Array.isArray(a.acceptedCapabilities) || new Set(a.acceptedCapabilities).size !== a.acceptedCapabilities.length ||
      !a.acceptedCapabilities.every(role=>partnerCapabilities.includes(role) && a.requestedCapabilities.includes(role)) ||
      a.acceptedCapabilities.includes('verifier') && !a.acceptedCapabilities.includes('custodian') ||
      a.keys.filter(k=>k.state === 'active').length > 1 || !Array.isArray(row.history) || !row.history.length ||
      !Array.isArray(row.domains) || !row.bindings || !a.domainChallengeIds || !Array.isArray(row.reports) ||
      row.reports.length > 32 || !row.published && a.acceptedCapabilities.length > 0 ||
      row.published && (a.environment !== 'production' || !a.acceptedCapabilities.length ||
        !['active','in_review','suspended','revoked'].includes(a.state)) || a.state === 'active' && !row.published ||
      a.environment === 'production' && (a.state === 'sandbox_testing' || !knownId(row.sandboxReportId)) ||
      a.environment === 'sandbox' && (a.state === 'in_review' || a.acceptedCapabilities.length)) invalid()
  enrollment({displayName:a.displayName,organization:a.organization,organizationUrl:a.organizationUrl,contact:a.contact,
    recoveryContact:a.recoveryContact,handoffUrl:a.handoffUrl,capabilities:a.requestedCapabilities,catalog:a.catalog,
    publicKey:row.keyMaterial[0], ...(row.sandboxReportId ? {sandboxReportId:row.sandboxReportId} : {})})
  for (const candidate of row.keyMaterial) {
    const key=publicKey(candidate), descriptor=a.keys.find(k=>k.kid === key.kid) ?? invalid()
    if (!['candidate','active','retiring','revoked'].includes(descriptor.state) || descriptor.thumbprint !== thumbprint(key) ||
        !utc(descriptor.validFrom) || descriptor.validUntil !== undefined && (!utc(descriptor.validUntil) ||
          Date.parse(descriptor.validUntil)<Date.parse(descriptor.validFrom)) ||
        descriptor.state === 'retiring' && !descriptor.validUntil) invalid()
  }
  if (a.challenge && (a.challenge.applicationId !== a.applicationId || !knownId(a.challenge.nonce) ||
      !utc(a.challenge.expiresAt) || !a.keys.some(k=>k.kid === a.challenge!.kid && k.state === 'candidate'))) invalid()
  const seen=new Set<string>()
  for (const d of row.domains) {
    const c=d.challenge
    if (!c || !knownId(c.challengeId) || seen.has(c.challengeId) || c.applicationId !== a.applicationId ||
        c.environment !== a.environment || !['website','handoff'].includes(c.purpose) ||
        !['pending','verified','superseded','expired','conflict'].includes(c.state) ||
        partnerWebsite(d.url,c.purpose).hostname !== c.domainAscii || c.recordName !== '_agentcommons.'+c.domainAscii ||
        !/^agentcommons-v1=[A-Za-z0-9_-]{43}$/.test(c.recordValue) || !utc(c.expiresAt) ||
        d.contradicted!==undefined && typeof d.contradicted!=='boolean' ||
        (d.verifiedAt !== undefined && (!Number.isSafeInteger(d.verifiedAt) || d.verifiedAt<0 || d.verifiedAt>=Date.parse(c.expiresAt))) ||
        (d.observedAt !== undefined && (!Number.isSafeInteger(d.observedAt) || d.verifiedAt === undefined || d.observedAt<d.verifiedAt))) invalid()
    seen.add(c.challengeId)
  }
  for (const purpose of ['website','handoff'] as const) {
    const binding=row.bindings[purpose], current=a.domainChallengeIds[purpose]
    if (current && !row.domains.some(d=>d.challenge.challengeId===current && d.challenge.purpose===purpose)) invalid()
    if (row.published && !binding) invalid()
    if (binding && !row.domains.some(d=>d.challenge.challengeId===binding && d.challenge.purpose===purpose &&
      (d.challenge.state==='verified' || d.challenge.state==='expired') &&
      d.verifiedAt !== undefined && d.observedAt !== undefined &&
      d.url === (purpose === 'website' ? a.organizationUrl : a.handoffUrl))) invalid()
  }
  let last=0
  for (const event of row.history) {
    if (!knownId(event.eventId) || !knownId(event.actorRef) || !knownId(event.action) || !utc(event.recordedAt) ||
        !revision(event.revision) || event.revision < last || event.revision > a.revision) invalid()
    last=event.revision
  }
  if (last !== a.revision || row.published && !row.history.some(e=>e.action==='decision_approve')) invalid()
  for (const report of row.reports) {
    if (a.environment !== 'sandbox' || report.public.applicationId !== a.applicationId || !knownId(report.public.reportId) ||
        !Number.isSafeInteger(report.startedAt) || typeof report.primaryHost!=='string' ||
        partnerWebsite('https://'+report.primaryHost,'website').hostname!==report.primaryHost || report.public.suiteVersion !== 'partner-v1' ||
        report.public.catalogDigest !== catalogDigest(a.catalog) || !Array.isArray(report.public.checks) || !report.public.checks.length ||
        !['running','passed','failed'].includes(report.public.state) || !Array.isArray(report.commands) || !report.commands.length ||
        !report.receipts || typeof report.receipts !== 'object' || typeof report.duplicateObserved !== 'boolean') invalid()
    for (const f of report.commands) {
      const cmd=f.command
      if (!cmd || cmd.partnerId!==a.partnerId || cmd.environment!=='sandbox' || !knownId(cmd.commandId) ||
          !knownId(cmd.taskId) || !/^[a-f0-9]{64}$/.test(cmd.termsDigest) || cmd.termsVersion!==1 ||
          !utc(cmd.issuedAt) || !utc(cmd.deadline) || !['requested','uncertain','failed','succeeded'].includes(cmd.state) ||
          !cmd.action || !['reserve','release','return','run','verify'].includes(cmd.action.kind)) invalid()
      if (Date.parse(cmd.deadline)<=Date.parse(cmd.issuedAt) || cmd.state==='requested' && cmd.receiptId!==undefined ||
        cmd.state!=='requested' && (!knownId(cmd.receiptId) ||
          report.receipts['receipt:'+cmd.receiptId]?.acknowledgement.commandId!==cmd.commandId ||
          report.receipts['receipt:'+cmd.receiptId]?.acknowledgement.state!==cmd.state)) invalid()
      const checkBytes=(artifact:NonNullable<typeof f.output>, encoded:unknown)=>{
        if (!knownId(artifact.artifactId) || !['text/plain','application/json','application/octet-stream'].includes(artifact.mediaType) ||
            typeof encoded!=='string' || encoded.length>Math.ceil(8*1024*1024/3)*4) invalid()
        const bytes=Buffer.from(encoded as string,'base64')
        if (bytes.toString('base64')!==encoded || sha256(bytes)!==artifact.digest) invalid()
      }
      if (f.input) checkBytes(f.input,f.input.bytes)
      if (f.output) checkBytes(f.output,f.outputBytes)
      else if (f.outputBytes!==undefined) invalid()
    }
    const commands=new Set(report.commands.map(f=>f.command.commandId))
    if (commands.size!==report.commands.length || report.finishedAt!==undefined &&
      (!Number.isSafeInteger(report.finishedAt) || report.finishedAt<report.startedAt)) invalid()
    for (const [key,receipt] of Object.entries(report.receipts)) {
      const ack=receipt.acknowledgement
      if (!/^[a-f0-9]{64}$/.test(receipt.digest) || !knownId(ack.receiptId) || key!=='receipt:'+ack.receiptId ||
          !commands.has(ack.commandId) || !['succeeded','failed','uncertain'].includes(ack.state)) invalid()
    }
    if (report.public.state === 'passed' && (!report.duplicateObserved || !Number.isSafeInteger(report.finishedAt) ||
        !report.public.checks.every(c=>c.status==='passed') || !report.commands.every(f=>f.command.state==='succeeded'))) invalid()
  }
  if (a.conformanceReportId && !row.reports.some(r=>r.public.reportId===a.conformanceReportId)) invalid()
}
