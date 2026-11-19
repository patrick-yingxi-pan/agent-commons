import type {
  PartnerApplication,
  PartnerApplicationRequest,
  PartnerAuditEntry,
  PartnerCatalogEntry,
  PartnerConformanceRun,
  PartnerDomainChallenge,
  PartnerDomainPurpose,
  PartnerEnvironment,
  PartnerPublicKey,
  PartnerCapability,
} from '../../contract/taskPartners.ts'
import type { PartnerTaskTerms, PartnerTaskView, TaskHandoff } from '../../contract/taskPartnerWork.ts'
import { apiGet as httpGet, apiPost } from './client.ts'
import { invalidatePrefix, useQuery } from './cache.ts'
import { partnerPaths as paths } from './partnerPaths.ts'
import { invalidate, peek } from './cache.ts'
import type { Identity } from '../../contract/identity.ts'
import { keys } from './keys.ts'

function apiGet<T>(path: string) {
  const actor = peek<Identity>(keys.me)
  return httpGet<T>(path, { expectedSessionUserId: actor?.via === 'session' ? actor.user.id : null })
}

function usePartnerQuery<T>(resource: string, read: () => Promise<T>, enabled = true) {
  const actor = peek<Identity>(keys.me)
  const scope = JSON.stringify([actor?.tenant.id, actor?.user.id])
  const readForActor = async () => {
    const active = peek<Identity>(keys.me)
    if (active?.via !== 'session' || active.user.id !== actor?.user.id || active.tenant.id !== actor?.tenant.id)
      throw new Error('Sign in to view this record.')
    return read()
  }
  return useQuery(resource + ':' + scope, readForActor, enabled && actor?.via === 'session', true)
}

function mutationOptions(idempotencyKey: string) {
  const actor = peek<Identity>(keys.me)
  return { idempotencyKey, expectedSessionUserId: actor?.via === 'session' ? actor.user.id : null }
}

export const refreshHandoffStatus = (id: string) =>
  invalidatePrefix('partner-registry:' + paths.partnerHandoff('production', id), true)
export function usePartnerBalance() {
  return usePartnerQuery(
    'partner-registry:' + paths.partnerBalance,
    () => apiGet<{ assetId: string; unit: string; available: string; held: string }>(paths.partnerBalance),
    true,
  )
}
export const grantPartnerCredits = (
  body: { userId: string; tenantId: string; quantity: string; reference: string; reason: string },
  key: string,
) => apiPost<unknown>(paths.partnerCreditGrants, body, mutationOptions(key)).then(changed)
export const fundPartnerTask = (task: PartnerTaskView, key: string) =>
  apiPost<PartnerTaskView>(
    paths.partnerFund(task.projectId, task.taskId),
    { termsVersion: task.termsVersion, termsDigest: task.termsDigest },
    mutationOptions(key),
  ).then((r) => {
    refreshPartnerWork(task.projectId)
    return r
  })

export interface PartnerPage<T> {
  items: T[]
  nextCursor?: string | null
}
export interface PartnerApplicationsPage extends PartnerPage<PartnerApplication> {
  canManage: boolean
  canReview: boolean
  recoveryRole: 'incident' | 'settlement' | null
  webOrigin: string | null
  badgeOrigin: string | null
}
const pageQuery = (cursor?: string | null) => (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')
export function usePartnerApplications(env: PartnerEnvironment, cursor?: string | null) {
  return usePartnerQuery(
    'partner-registry:' + paths.partnerApplications(env) + pageQuery(cursor),
    () => apiGet<PartnerApplicationsPage>(paths.partnerApplications(env) + pageQuery(cursor)),
    true,
  )
}
export function usePartnerApplication(env: PartnerEnvironment, id: string) {
  return usePartnerQuery(
    'partner-registry:' + paths.partnerApplication(env, id),
    () => apiGet<PartnerApplication>(paths.partnerApplication(env, id)),
    !!id,
  )
}
export function usePartnerAudit(env: PartnerEnvironment, id: string, cursor?: string | null) {
  return usePartnerQuery(
    'partner-registry:' + paths.partnerApplicationAudit(env, id) + pageQuery(cursor),
    () => apiGet<PartnerPage<PartnerAuditEntry>>(paths.partnerApplicationAudit(env, id) + pageQuery(cursor)),
    !!id,
  )
}
export function usePartnerCatalog(
  options: {
    name?: string
    domainAscii?: string
    partnerId?: string
    capability?: PartnerCapability
    cursor?: string | null
  } = {},
) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(options)) if (value) search.set(key, value)
  const query = search.size ? '?' + search : ''
  return usePartnerQuery(
    'partner-registry:' + paths.partnerCatalog('production') + query,
    () =>
      apiGet<PartnerPage<PartnerCatalogEntry> & { webOrigin: string | null }>(
        paths.partnerCatalog('production') + query,
      ),
    true,
  )
}
export function usePartnerConformance(env: PartnerEnvironment, id: string, report?: string) {
  return usePartnerQuery(
    'partner-registry:' + paths.partnerReport(env, id, report ?? ''),
    () => apiGet<PartnerConformanceRun>(paths.partnerReport(env, id, report ?? '')),
    !!report,
  )
}
export function readPartnerDomainChallenge(env: PartnerEnvironment, id: string, challenge: string) {
  return apiGet<PartnerDomainChallenge>(paths.partnerDomain(env, id, challenge))
}
export function usePartnerDomainChallenge(env: PartnerEnvironment, id: string, challenge?: string) {
  return usePartnerQuery(
    'partner-registry:' + paths.partnerDomain(env, id, challenge ?? ''),
    () => readPartnerDomainChallenge(env, id, challenge ?? ''),
    !!challenge,
  )
}
export function refreshPartnerRegistry() {
  invalidatePrefix('partner-registry', true)
}
function changed<T>(result: T) {
  refreshPartnerRegistry()
  return result
}
export const registerPartner = (env: PartnerEnvironment, body: PartnerApplicationRequest, key: string) =>
  apiPost<PartnerApplication>(paths.partnerApplications(env), body, mutationOptions(key)).then(changed)
export const issuePartnerDomain = (
  env: PartnerEnvironment,
  app: PartnerApplication,
  purpose: PartnerDomainPurpose,
  key: string,
  replacementUrl?: string,
) =>
  apiPost<PartnerDomainChallenge>(
    paths.partnerDomains(env, app.applicationId),
    { purpose, expectedRevision: app.revision, ...(replacementUrl ? { replacementUrl } : {}) },
    mutationOptions(key),
  ).then(changed)
export const provePartnerSigningKey = (env: PartnerEnvironment, id: string, signedProof: string, key: string) =>
  apiPost<PartnerApplication>(paths.partnerProof(env, id), { signedProof }, mutationOptions(key)).then(changed)
export const changePartnerKey = (
  env: PartnerEnvironment,
  app: PartnerApplication,
  change:
    | { action: 'register'; publicKey: PartnerPublicKey }
    | { action: 'revoke'; kid: string; reason: string },
  key: string,
) =>
  apiPost<PartnerApplication>(
    paths.partnerSigningKeys(env, app.applicationId),
    { ...change, expectedRevision: app.revision },
    mutationOptions(key),
  ).then(changed)
export const startPartnerConformance = (env: PartnerEnvironment, app: PartnerApplication, key: string) =>
  apiPost<PartnerConformanceRun>(
    paths.partnerSuite(env, app.applicationId),
    { expectedRevision: app.revision },
    mutationOptions(key),
  ).then(changed)
export const reviewPartner = (
  env: PartnerEnvironment,
  app: PartnerApplication,
  decision: { action: string; reason: string; acceptedCapabilities?: PartnerCapability[] },
  key: string,
) =>
  apiPost<PartnerApplication>(
    paths.partnerDecision(env, app.applicationId),
    { ...decision, expectedRevision: app.revision },
    mutationOptions(key),
  ).then(changed)

export function refreshPartnerWork(project: string) {
  invalidatePrefix('partner-project:' + project, true)
  invalidate(keys.openSubGoals(project))
  refreshPartnerRegistry()
}
export function usePartnerTasks(project: string, cursor?: string) {
  const q = '?state=draft' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
  return usePartnerQuery(
    'partner-project:' + project + ':' + paths.partnerDrafts(project) + q,
    () => apiGet<PartnerPage<PartnerTaskView>>(paths.partnerDrafts(project) + q),
    true,
  )
}
export function usePartnerTask(project: string, work: string) {
  return usePartnerQuery(
    'partner-project:' + project + ':' + paths.partnerTaskTerms(project, work),
    () => apiGet<PartnerTaskView>(paths.partnerTaskTerms(project, work)),
    true,
  )
}
export const createPartnerTask = (project: string, body: PartnerTaskTerms, key: string) =>
  apiPost<PartnerTaskView>(paths.partnerDrafts(project), body, mutationOptions(key)).then((r) => {
    refreshPartnerWork(project)
    return r
  })
export const savePartnerTask = (task: PartnerTaskView, terms: PartnerTaskTerms, key: string) =>
  apiPost<PartnerTaskView>(
    paths.partnerTaskTerms(task.projectId, task.taskId),
    { expectedVersion: task.termsVersion, terms },
    mutationOptions(key),
  ).then((r) => {
    refreshPartnerWork(task.projectId)
    return r
  })
export async function actOnPartnerTask(
  task: PartnerTaskView,
  operation: 'publish' | 'claim' | 'submissions' | 'cancel',
  key: string,
  text?: string,
  expectedIdentities?: Record<string, { domainAscii: string; identityRevision: number }>,
) {
  const body = {
    termsVersion: task.termsVersion,
    termsDigest: task.termsDigest,
    ...(text === undefined ? {} : { text }),
    ...(expectedIdentities ? { expectedIdentities } : {}),
  }
  const options = mutationOptions(key)
  const result =
    operation === 'submissions'
      ? await apiPost<PartnerTaskView>(paths.partnerTaskSubmissions(task.projectId, task.taskId), body, options)
      : operation === 'publish'
        ? await apiPost<PartnerTaskView>(paths.partnerTaskPublish(task.projectId, task.taskId), body, options)
        : operation === 'claim'
          ? await apiPost<PartnerTaskView>(paths.partnerTaskClaim(task.projectId, task.taskId), body, options)
          : await apiPost<PartnerTaskView>(paths.partnerTaskCancel(task.projectId, task.taskId), body, options)
  refreshPartnerWork(task.projectId)
  return result
}
export type HandoffStart = Pick<TaskHandoff, 'identity' | 'expiresAt' | 'handoffId' | 'handoffDomainAscii'> & {
  startUrl: string
  startCode: string
}
export const startTaskHandoff = (
  body: {
    taskId: string
    termsVersion: number
    termsDigest: string
    purpose: 'reserve' | 'run' | 'receive'
    partnerId: string
    expectedIdentity?: { domainAscii: string; identityRevision: number }
  },
  key: string,
) => apiPost<HandoffStart>(paths.partnerHandoffs('production'), body, mutationOptions(key))
export function useTaskHandoff(id: string | null) {
  return usePartnerQuery(
    'partner-registry:' + paths.partnerHandoff('production', id ?? ''),
    () => apiGet<TaskHandoff>(paths.partnerHandoff('production', id ?? '')),
    !!id,
  )
}
export const decideTaskHandoff = (
  task: PartnerTaskView,
  id: string,
  decision: 'confirm' | 'decline' | 'withdraw',
  key: string,
) =>
  apiPost<TaskHandoff>(
    paths.partnerHandoffDecision('production', id),
    { decision, termsDigest: task.termsDigest },
    mutationOptions(key),
  ).then((r) => {
    refreshPartnerWork(task.projectId)
    return r
  })

export interface PartnerObligation {
  obligationId: string
  revision: number
  taskId: string
  state: string
  commandId: string
  latestRecoveryId?: string
  asset?: { unit: string; quantity: string }
}
export interface PartnerRecovery {
  recoveryId: string
  revision: number
  state: string
  mode: string
  reason: string
  evidenceDigest?: string
  availableActions: Array<'authorize' | 'submit_evidence' | 'confirm_evidence'>
}
export function usePartnerObligations(partnerId: string, cursor?: string) {
  const q = new URLSearchParams({ partnerId })
  if (cursor) q.set('cursor', cursor)
  return usePartnerQuery(
    'partner-registry:' + paths.partnerObligations('production') + '?' + q,
    () => apiGet<PartnerPage<PartnerObligation>>(paths.partnerObligations('production') + '?' + q),
    true,
  )
}
export function usePartnerRecovery(id: string, caseId?: string) {
  return usePartnerQuery(
    'partner-registry:' + paths.partnerRecovery('production', id, caseId ?? ''),
    () => apiGet<PartnerRecovery>(paths.partnerRecovery('production', id, caseId ?? '')),
    !!caseId,
  )
}
export const reconcilePartner = (id: string, body: Record<string, unknown>, key: string) =>
  apiPost<PartnerRecovery>(paths.partnerRecoveries('production', id), body, mutationOptions(key)).then(changed)
export async function downloadPartnerOutput(project: string, work: string, submission: string) {
  type Part = {
    artifact: { artifactId: string; digest: string }
    byteLength: number
    offset: number
    dataBase64: string
    nextOffset?: number
  }
  let offset = 0,
    size: number | undefined,
    digest: string | undefined
  const parts: ArrayBuffer[] = []
  while (true) {
    const page = await apiGet<Part>(
      paths.partnerOutput(project, work, submission) + '?offset=' + offset + '&length=65536',
    )
    if (
      !page.artifact ||
      !Number.isSafeInteger(page.byteLength) ||
      page.byteLength < 0 ||
      page.offset !== offset ||
      (size !== undefined && size !== page.byteLength) ||
      (digest !== undefined && digest !== page.artifact.digest)
    )
      throw new Error('The submission changed during download. Please try again.')
    size = page.byteLength
    digest = page.artifact.digest
    const bytes = Uint8Array.from(atob(page.dataBase64), (c) => c.charCodeAt(0))
    if (bytes.length > 65536 || offset + bytes.length > size) throw new Error('Invalid submission chunk.')
    parts.push(bytes.buffer)
    offset += bytes.length
    if (page.nextOffset === undefined) {
      if (offset !== size) throw new Error('Incomplete submission download.')
      break
    }
    if (!bytes.length || page.nextOffset !== offset) throw new Error('Invalid submission offset.')
  }
  const blob = new Blob(parts, { type: 'application/octet-stream' })
  const checksum = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
  if (checksum !== digest) throw new Error('The downloaded bytes do not match the recorded submission.')
  return blob
}

export const renameTaskPartner = (
  env: PartnerEnvironment,
  app: PartnerApplication,
  displayName: string,
  key: string,
) =>
  apiPost<PartnerApplication>(
    paths.partnerRename(env, app.applicationId),
    { displayName, expectedRevision: app.revision },
    mutationOptions(key),
  ).then(changed)

export const revisePartnerTask = (task: PartnerTaskView, terms: PartnerTaskTerms, key: string) =>
  apiPost<PartnerTaskView>(
    paths.partnerRevision(task.projectId, task.taskId),
    { termsVersion: task.termsVersion, termsDigest: task.termsDigest, terms },
    mutationOptions(key),
  ).then((r) => {
    refreshPartnerWork(task.projectId)
    return r
  })
