import { createHash } from 'node:crypto'
import type { PartnerTaskTerms, TaskAcceptance, TaskArtifact } from '../../contract/taskPartnerWork.ts'
import { SITE_CUSTODIAN_ID, SITE_WORK_CREDIT } from '../../contract/taskPartnerWork.ts'
import type {
  PartnerCapability,
  PartnerCatalog,
  PartnerEnvironment,
  PartnerPublicProfile,
} from '../../contract/taskPartners.ts'
import { asset, digest } from './dispatcher.ts'
import { fail, fields, positive, record, tokenId } from './protocol.ts'

export interface TaskPartnerDirectory {
  publicProfile(partnerId: string): PartnerPublicProfile
  machineEnrollment(
    environment: PartnerEnvironment,
    partnerId: string,
  ): {
    handoffUrl: string
    capabilities: PartnerCapability[]
    catalog: PartnerCatalog
    identityRevision: number
    domainAscii: string
  }
  verifyPartnerJws(
    environment: PartnerEnvironment,
    partnerId: string,
    jws: string,
    typ: string,
  ): { kid: string; claims: Record<string, unknown> }
}
export interface WorkActor {
  tenantId: string
  userId: string
  operator?: boolean
  freshAuth?: boolean
  recoveryRole?: 'incident' | 'settlement'
}
export const actorRef = (actor: WorkActor) => 'actor-' + hash(JSON.stringify([actor.tenantId, actor.userId]))
export const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export const missing = (): never => fail(404, 'not_found', 'This item is unavailable.')
export const conflict = (message: string): never => fail(409, 'conflict', message)
export function textField(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Bidi_Control}\p{Cs}]/u.test(value)
  )
    return fail(400, 'bad_request', 'Enter text within the field limit.')
  return value
}
export function time(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return fail(400, 'bad_request', 'Supply a UTC timestamp.')
  return new Date(value).toISOString()
}
export function parseTerms(raw: unknown, now: number): PartnerTaskTerms {
  const t = fields(raw, ['description'], ['acceptance', 'provenance', 'reward', 'deadline', 'participation'])
  const terms: PartnerTaskTerms = { description: textField(t.description, 2_000) }
  if (t.participation !== undefined && t.participation !== 'first-valid' && t.participation !== 'single-claim')
    return fail(400, 'bad_request', 'Choose a supported participation policy.')
  terms.participation = t.participation ?? 'first-valid'
  if (t.deadline !== undefined) {
    terms.deadline = time(t.deadline)
    if (Date.parse(terms.deadline) <= now) return fail(422, 'deadline_elapsed', 'Choose a future submission deadline.')
  }
  if (t.acceptance !== undefined) terms.acceptance = parseRule(t.acceptance)
  if (t.provenance !== undefined) {
    const row = fields(t.provenance, ['partnerId', 'model', 'maxInputTokens', 'maxOutputTokens'], ['effort'])
    terms.provenance = {
      partnerId: tokenId(row.partnerId),
      model: tokenId(row.model),
      maxInputTokens: positive(row.maxInputTokens),
      maxOutputTokens: positive(row.maxOutputTokens),
      ...(row.effort === undefined ? {} : { effort: tokenId(row.effort) }),
    }
  }
  if (t.reward !== undefined) {
    const row = fields(t.reward, ['partnerId', 'asset', 'holdUntil'])
    terms.reward = { partnerId: tokenId(row.partnerId), asset: asset(row.asset), holdUntil: time(row.holdUntil) }
    if (!terms.deadline || Date.parse(terms.reward.holdUntil) <= Date.parse(terms.deadline))
      return fail(
        422,
        'coverage_window',
        'The reward hold must extend beyond the submission deadline to cover settlement.',
      )
  }
  return terms
}
function parseRule(raw: unknown): TaskAcceptance {
  const row = record(raw)
  if (row.kind === 'sha256-prefix') {
    fields(row, ['kind', 'prefix', 'difficultyBits'])
    if (
      typeof row.prefix !== 'string' ||
      row.prefix.length > 256 ||
      typeof row.difficultyBits !== 'number' ||
      !Number.isInteger(row.difficultyBits) ||
      row.difficultyBits < 1 ||
      row.difficultyBits > 256
    )
      return fail(400, 'bad_request', 'Choose a prefix up to 256 characters and 1–256 leading zero bits.')
    return { kind: row.kind, prefix: row.prefix, difficultyBits: row.difficultyBits }
  }
  if (row.kind !== 'partner') return fail(400, 'bad_request', 'Choose an available acceptance rule.')
  fields(row, ['kind', 'partnerId', 'rule'])
  const rule = fields(row.rule, ['ruleId', 'version', 'digest'])
  return {
    kind: 'partner',
    partnerId: tokenId(row.partnerId),
    rule: { ruleId: tokenId(rule.ruleId), version: positive(rule.version), digest: digest(rule.digest) },
  }
}
export function assertTermsAvailable(directory: TaskPartnerDirectory, terms: PartnerTaskTerms) {
  if (terms.reward && !terms.acceptance)
    return fail(
      422,
      'acceptance_required',
      'Choose an executable acceptance rule before reserving or publishing a reward.',
    )
  if (terms.acceptance?.kind === 'partner') {
    const { partnerId, rule } = terms.acceptance
    const enrollment = directory.machineEnrollment('production', partnerId)
    if (
      !enrollment.capabilities.includes('custodian') ||
      !enrollment.capabilities.includes('verifier') ||
      !enrollment.catalog.rules.some(
        (r) => r.ruleId === rule.ruleId && r.version === rule.version && r.digest === rule.digest,
      )
    )
      return fail(422, 'unavailable_rule', 'The selected custodian cannot execute this rule version.')
  }
  if (terms.reward?.partnerId === SITE_CUSTODIAN_ID) {
    if (terms.reward.asset.assetId !== SITE_WORK_CREDIT.assetId || terms.reward.asset.unit !== SITE_WORK_CREDIT.unit)
      return fail(422, 'unavailable_asset', 'Agent Commons can reserve its own issued work credits.')
  } else if (terms.reward) {
    const { partnerId, asset } = terms.reward
    const enrollment = directory.machineEnrollment('production', partnerId)
    if (
      !enrollment.capabilities.includes('custodian') ||
      !enrollment.catalog.assets.some((a) => a.assetId === asset.assetId && a.unit === asset.unit)
    )
      return fail(422, 'unavailable_asset', 'This holder has no approval for the specified asset and unit.')
  }
  if (terms.provenance) {
    const { partnerId, model, effort } = terms.provenance
    const enrollment = directory.machineEnrollment('production', partnerId)
    if (
      !enrollment.capabilities.includes('model-provider') ||
      !enrollment.catalog.models.some((m) => m.model === model && (effort === undefined || m.efforts.includes(effort)))
    )
      return fail(422, 'unavailable_model', 'The provider cannot attest this model and effort.')
  }
}
export function checkNonce(prefix: string, bytes: Uint8Array, bits: number) {
  const result = Buffer.from(hash(Buffer.concat([Buffer.from(prefix), bytes])), 'hex')
  const whole = Math.floor(bits / 8),
    remainder = bits % 8
  return result.subarray(0, whole).every((b) => b === 0) && (!remainder || result[whole] >>> (8 - remainder) === 0)
}
export interface StoredArtifact {
  ref: TaskArtifact
  bytes: string
  uploadedFor?: string
  created: number
}
