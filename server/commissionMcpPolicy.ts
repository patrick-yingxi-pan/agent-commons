/** Pure preparation for a fresh Commission execution grant. Not a route,
 * registry, scheduler, budget reservation or permission to dispatch. The host
 * must prove the scope's current ownership and commit returned state atomically.
 * Legacy standing flags and Routine grants are deliberately not inputs. */
import {
  COMMISSION_MCP_MAX_LIFETIME_MS, COMMISSION_MCP_MAX_TOOLS, COMMISSION_MCP_MAX_WORK_ITEMS,
  type CommissionMcpApproval, type CommissionMcpApprovalIntent, type CommissionMcpPolicy,
} from '../contract/commissionMcp.ts'
import type { McpBoundToolCall, McpJsonValue } from '../contract/mcpExecution.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { snapshotMcpBoundToolCall } from './mcpBoundCall.ts'
import { matchesHttpMcpPermission, mcpPermissionAllowsCall, sameMcpPermissionJson, snapshotMcpToolPermissions } from './mcpPermission.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'

export interface CommissionMcpScope {
  tenantId: string
  ownerUserId: string
  projectId: string
  commissionId: string
  agentId: string
}
export interface StoredCommissionMcpPolicy extends CommissionMcpScope {
  policy: CommissionMcpPolicy
  /** Private transport provenance, derived from person-filtered live stdio views. */
  localConnectionIds?: string[]
}
export interface CommissionMcpLiveReview { configurationRevision: number; reviewHash: string }
/** Must apply exact live owner/membership/tenant walls for every authentication
 * mode. A public connection view does not itself prove those prerequisites. */
export type CommissionMcpConnectionReader = (id: string, tenantId: string, ownerUserId: string) => McpConnectionView | undefined

export class CommissionMcpPolicyError extends Error {
  readonly code: 'invalid' | 'stale' | 'unavailable' | 'denied' | 'limit'
  constructor(code: CommissionMcpPolicyError['code'] = 'invalid') {
    super(`Commission MCP permission ${code}.`)
    this.name = 'CommissionMcpPolicyError'
    this.code = code
  }
}
const fail = (code: CommissionMcpPolicyError['code'] = 'invalid'): never => { throw new CommissionMcpPolicyError(code) }
const record = (value: unknown): value is Record<string, McpJsonValue> => value !== null && typeof value === 'object' && !Array.isArray(value)
export const commissionMcpInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  value.length <= 200 && value.trim() === value &&
  !Array.from(value).some(char => /^[\u0000-\u001f\u007f-\u009f\ud800-\udfff]$/.test(char))
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const fields = (value: Record<string, McpJsonValue>, names: readonly string[]): boolean =>
  Object.keys(value).length === names.length && names.every(key => Object.hasOwn(value, key))
const SCOPE_FIELDS = ['tenantId', 'ownerUserId', 'projectId', 'commissionId', 'agentId'] as const

function detached(value: unknown): Record<string, McpJsonValue> {
  try {
    const copy = snapshotMcpJson(value, { maxBytes: 262_144, maxDepth: 40, maxNodes: 20_000 })
    return record(copy) ? copy : fail()
  } catch { return fail() }
}

function scopeFrom(value: Record<string, McpJsonValue>): CommissionMcpScope {
  if (!SCOPE_FIELDS.every(key => identity(value[key]))) return fail()
  return Object.fromEntries(SCOPE_FIELDS.map(key => [key, value[key]])) as unknown as CommissionMcpScope
}

function approvalFrom(value: McpJsonValue, scope: CommissionMcpScope): CommissionMcpApproval {
  const hasLocalPrograms = record(value) && Object.hasOwn(value, 'localPrograms')
  if (!record(value) || !fields(value, ['configurationRevision', 'reviewHash', 'execution', 'approvedAt', 'expiresAt', 'maxWorkItems', 'tools',
      ...(hasLocalPrograms ? ['localPrograms'] : [])]) || (hasLocalPrograms && value.localPrograms !== true) ||
      !commissionMcpInteger(value.configurationRevision) || !hash(value.reviewHash) ||
      !commissionMcpInteger(value.approvedAt) || !commissionMcpInteger(value.expiresAt) ||
      value.expiresAt <= value.approvedAt || value.expiresAt - value.approvedAt > COMMISSION_MCP_MAX_LIFETIME_MS ||
      !commissionMcpInteger(value.maxWorkItems) || value.maxWorkItems < 1 || value.maxWorkItems > COMMISSION_MCP_MAX_WORK_ITEMS ||
      !record(value.execution) || !fields(value.execution, ['agentId', 'providerId', 'modelId']) ||
      value.execution.agentId !== scope.agentId || !identity(value.execution.providerId) || !identity(value.execution.modelId)) return fail()
  const tools = snapshotMcpToolPermissions(value.tools, COMMISSION_MCP_MAX_TOOLS) ?? fail()
  return { configurationRevision: value.configurationRevision, reviewHash: value.reviewHash,
    execution: { agentId: scope.agentId, providerId: value.execution.providerId, modelId: value.execution.modelId },
    approvedAt: value.approvedAt, expiresAt: value.expiresAt, maxWorkItems: value.maxWorkItems, tools,
    ...(hasLocalPrograms ? { localPrograms: true as const } : {}) }
}

function localConnectionIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > COMMISSION_MCP_MAX_TOOLS ||
      value.some((id, index) => !identity(id) || !/^mcp-connection-[a-f0-9]{32}$/.test(id) ||
        (index > 0 && typeof value[index - 1] === 'string' && value[index - 1] >= id))) return fail()
  return value as string[]
}

/** Present malformed data fails closed. Absence is handled only as no grant by
 * the registry; it is never reconstructed from a Commission flag. */
export function parseCommissionMcpPolicy(value: unknown): StoredCommissionMcpPolicy {
  const copy = detached(value)
  const hasLocalIds = Object.hasOwn(copy, 'localConnectionIds')
  if (!fields(copy, [...SCOPE_FIELDS, 'policy', ...(hasLocalIds ? ['localConnectionIds'] : [])]) || !record(copy.policy) ||
      !fields(copy.policy, ['version', 'revision', 'approval']) || copy.policy.version !== 1 ||
      !commissionMcpInteger(copy.policy.revision) || copy.policy.revision < 1) return fail()
  const scope = scopeFrom(copy)
  const ids = hasLocalIds ? localConnectionIds(copy.localConnectionIds) : undefined
  const approval = copy.policy.approval === null ? null : approvalFrom(copy.policy.approval, scope)
  if (approval && ((approval.localPrograms === true) !== !!ids ||
      (ids ?? []).some(id => !approval.tools.some(tool => tool.connectionId === id)))) return fail()
  return { ...scope, ...(ids ? { localConnectionIds: ids } : {}), policy: { version: 1, revision: copy.policy.revision, approval } }
}

/** Exact transport/schema check. The connection reader must already have
 * applied tenant and person ownership; this predicate never infers ownership
 * from a public view. */
export function commissionMcpToolPermitted(
  permission: StoredCommissionMcpPolicy, tool: CommissionMcpApproval['tools'][number],
  view: McpConnectionView | undefined, allowLocalPrograms = false,
): boolean {
  try {
    if (!permission.policy.approval || !permission.policy.approval.tools.some(candidate => sameMcpPermissionJson(candidate, tool)) ||
        !view || view.id !== tool.connectionId || view.revision !== tool.connectionRevision || view.status !== 'connected' ||
        view.execution !== 'approval-required' || !view.executableTools?.includes(tool.toolName)) return false
    if (view.transport !== 'stdio') {
      return !permission.localConnectionIds?.includes(tool.connectionId) &&
        ['none', 'device-bearer', 'device-oauth'].includes(view.authentication) && matchesHttpMcpPermission(tool, view)
    }
    if (allowLocalPrograms !== true || permission.policy.approval.localPrograms !== true ||
        !permission.localConnectionIds?.includes(tool.connectionId) || Object.hasOwn(view, 'authentication') ||
        !commissionMcpInteger(view.inspectedAt)) return false
    const matches = view.tools.filter(candidate => candidate.name === tool.toolName)
    return matches.length === 1 && mcpToolSchemaHash(matches[0]) === tool.schemaHash
  } catch { return false }
}

export function approveCommissionMcpPolicy(
  scope: CommissionMcpScope, current: StoredCommissionMcpPolicy | undefined,
  liveReview: CommissionMcpLiveReview, intent: CommissionMcpApprovalIntent,
  now: number, connection: CommissionMcpConnectionReader, allowLocalPrograms = false,
): StoredCommissionMcpPolicy {
  const scoped = detached(scope)
  if (!fields(scoped, SCOPE_FIELDS)) return fail()
  const exactScope = scopeFrom(scoped)
  const live = detached(liveReview)
  const review = detached(intent)
  if (!fields(live, ['configurationRevision', 'reviewHash']) || !commissionMcpInteger(live.configurationRevision) || !hash(live.reviewHash) ||
      !fields(review, ['expectedRevision', 'expectedConfigurationRevision', 'reviewHash', 'execution', 'expiresAt', 'maxWorkItems', 'tools',
        ...(Object.hasOwn(review, 'localPrograms') ? ['localPrograms'] : [])]) ||
      (Object.hasOwn(review, 'localPrograms') && review.localPrograms !== true) ||
      !commissionMcpInteger(review.expectedRevision) || !commissionMcpInteger(review.expectedConfigurationRevision) ||
      !hash(review.reviewHash) || !commissionMcpInteger(now)) return fail()
  const old = current === undefined ? undefined : parseCommissionMcpPolicy(current)
  if ((old && SCOPE_FIELDS.some(key => old[key] !== exactScope[key])) ||
      review.expectedRevision !== (old?.policy.revision ?? 0) || review.expectedConfigurationRevision !== live.configurationRevision ||
      review.reviewHash !== live.reviewHash) return fail('stale')
  if (review.expectedRevision === Number.MAX_SAFE_INTEGER) return fail('limit')
  const tools = snapshotMcpToolPermissions(review.tools, COMMISSION_MCP_MAX_TOOLS) ?? fail()
  const localIds = new Set<string>()
  const views = new Map<string, McpConnectionView>()
  for (const tool of tools) {
    const view = connection(tool.connectionId, exactScope.tenantId, exactScope.ownerUserId)
    if (!view) return fail('unavailable')
    views.set(tool.connectionId, view)
    if (view.transport === 'stdio') localIds.add(tool.connectionId)
  }
  if (localIds.size && review.localPrograms !== true) return fail('unavailable')
  if (review.localPrograms === true && !localIds.size) return fail()
  if (localIds.size && allowLocalPrograms !== true) return fail('unavailable')
  const ids = [...localIds].sort()
  const approval = approvalFrom({ configurationRevision: live.configurationRevision, reviewHash: live.reviewHash,
    execution: review.execution, approvedAt: now, expiresAt: review.expiresAt, maxWorkItems: review.maxWorkItems,
    tools: tools as unknown as McpJsonValue[],
    ...(ids.length ? { localPrograms: true } : {}) }, exactScope)
  for (const tool of approval.tools) {
    const view = views.get(tool.connectionId)
    if (!commissionMcpToolPermitted({ ...exactScope, policy: { version: 1, revision: review.expectedRevision + 1, approval },
      ...(ids.length ? { localConnectionIds: ids } : {}) }, tool, view, allowLocalPrograms)) return fail('unavailable')
  }
  return parseCommissionMcpPolicy({ ...exactScope, ...(ids.length ? { localConnectionIds: ids } : {}),
    policy: { version: 1, revision: review.expectedRevision + 1, approval } })
}

export function revokeCommissionMcpPolicy(value: StoredCommissionMcpPolicy, expectedRevision: number): StoredCommissionMcpPolicy {
  const current = parseCommissionMcpPolicy(value)
  if (!commissionMcpInteger(expectedRevision) || current.policy.revision !== expectedRevision) return fail('stale')
  if (current.policy.approval === null) return current
  if (expectedRevision === Number.MAX_SAFE_INTEGER) return fail('limit')
  return { ...current, policy: { version: 1, revision: expectedRevision + 1, approval: null } }
}

/** Exact frozen/live intersection, not durable admission. The future worker
 * additionally owns role/reach/budget, work identity, schema validation and the
 * consumed-work ledger. Revocation or replacement never repairs queued work. */
export function commissionMcpCallPermitted(
  frozen: StoredCommissionMcpPolicy, live: StoredCommissionMcpPolicy | undefined,
  liveReview: CommissionMcpLiveReview, call: McpBoundToolCall,
  now: number, connection: CommissionMcpConnectionReader, allowLocalPrograms = false,
): boolean {
  try {
    const queued = parseCommissionMcpPolicy(frozen)
    const current = parseCommissionMcpPolicy(live)
    const review = detached(liveReview)
    const exact = snapshotMcpBoundToolCall(call)
    const approval = queued.policy.approval
    if (!approval || !exact || !fields(review, ['configurationRevision', 'reviewHash']) ||
        !sameMcpPermissionJson(queued, current) || !commissionMcpInteger(now) ||
        review.configurationRevision !== approval.configurationRevision || review.reviewHash !== approval.reviewHash ||
        now < approval.approvedAt || now >= approval.expiresAt) return false
    const tool = approval.tools.find(tool => mcpPermissionAllowsCall(tool, exact))
    if (!tool) return false
    const view = connection(tool.connectionId, queued.tenantId, queued.ownerUserId)
    return commissionMcpToolPermitted(queued, tool, view, allowLocalPrograms)
  } catch { return false }
}
