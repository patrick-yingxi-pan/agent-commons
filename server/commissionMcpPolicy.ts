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

export interface CommissionMcpScope {
  tenantId: string
  ownerUserId: string
  projectId: string
  commissionId: string
  agentId: string
}
export interface StoredCommissionMcpPolicy extends CommissionMcpScope { policy: CommissionMcpPolicy }
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
  if (!record(value) || !fields(value, ['configurationRevision', 'reviewHash', 'execution', 'approvedAt', 'expiresAt', 'maxWorkItems', 'tools']) ||
      !commissionMcpInteger(value.configurationRevision) || !hash(value.reviewHash) ||
      !commissionMcpInteger(value.approvedAt) || !commissionMcpInteger(value.expiresAt) ||
      value.expiresAt <= value.approvedAt || value.expiresAt - value.approvedAt > COMMISSION_MCP_MAX_LIFETIME_MS ||
      !commissionMcpInteger(value.maxWorkItems) || value.maxWorkItems < 1 || value.maxWorkItems > COMMISSION_MCP_MAX_WORK_ITEMS ||
      !record(value.execution) || !fields(value.execution, ['agentId', 'providerId', 'modelId']) ||
      value.execution.agentId !== scope.agentId || !identity(value.execution.providerId) || !identity(value.execution.modelId)) return fail()
  const tools = snapshotMcpToolPermissions(value.tools, COMMISSION_MCP_MAX_TOOLS) ?? fail()
  return { configurationRevision: value.configurationRevision, reviewHash: value.reviewHash,
    execution: { agentId: scope.agentId, providerId: value.execution.providerId, modelId: value.execution.modelId },
    approvedAt: value.approvedAt, expiresAt: value.expiresAt, maxWorkItems: value.maxWorkItems, tools }
}

/** Present malformed data fails closed. Absence is handled only as no grant by
 * the registry; it is never reconstructed from a Commission flag. */
export function parseCommissionMcpPolicy(value: unknown): StoredCommissionMcpPolicy {
  const copy = detached(value)
  if (!fields(copy, [...SCOPE_FIELDS, 'policy']) || !record(copy.policy) ||
      !fields(copy.policy, ['version', 'revision', 'approval']) || copy.policy.version !== 1 ||
      !commissionMcpInteger(copy.policy.revision) || copy.policy.revision < 1) return fail()
  const scope = scopeFrom(copy)
  return { ...scope, policy: { version: 1, revision: copy.policy.revision,
    approval: copy.policy.approval === null ? null : approvalFrom(copy.policy.approval, scope) } }
}

export function approveCommissionMcpPolicy(
  scope: CommissionMcpScope, current: StoredCommissionMcpPolicy | undefined,
  liveReview: CommissionMcpLiveReview, intent: CommissionMcpApprovalIntent,
  now: number, connection: CommissionMcpConnectionReader,
): StoredCommissionMcpPolicy {
  const scoped = detached(scope)
  if (!fields(scoped, SCOPE_FIELDS)) return fail()
  const exactScope = scopeFrom(scoped)
  const live = detached(liveReview)
  const review = detached(intent)
  if (!fields(live, ['configurationRevision', 'reviewHash']) || !commissionMcpInteger(live.configurationRevision) || !hash(live.reviewHash) ||
      !fields(review, ['expectedRevision', 'expectedConfigurationRevision', 'reviewHash', 'execution', 'expiresAt', 'maxWorkItems', 'tools']) ||
      !commissionMcpInteger(review.expectedRevision) || !commissionMcpInteger(review.expectedConfigurationRevision) ||
      !hash(review.reviewHash) || !commissionMcpInteger(now)) return fail()
  const old = current === undefined ? undefined : parseCommissionMcpPolicy(current)
  if ((old && SCOPE_FIELDS.some(key => old[key] !== exactScope[key])) ||
      review.expectedRevision !== (old?.policy.revision ?? 0) || review.expectedConfigurationRevision !== live.configurationRevision ||
      review.reviewHash !== live.reviewHash) return fail('stale')
  if (review.expectedRevision === Number.MAX_SAFE_INTEGER) return fail('limit')
  const approval = approvalFrom({ configurationRevision: live.configurationRevision, reviewHash: live.reviewHash,
    execution: review.execution, approvedAt: now, expiresAt: review.expiresAt, maxWorkItems: review.maxWorkItems, tools: review.tools }, exactScope)
  for (const tool of approval.tools) {
    const view = connection(tool.connectionId, exactScope.tenantId, exactScope.ownerUserId)
    if (!view || !['none', 'device-bearer', 'device-oauth'].includes(view.authentication ?? '') || !matchesHttpMcpPermission(tool, view)) return fail('unavailable')
  }
  return parseCommissionMcpPolicy({ ...exactScope, policy: { version: 1, revision: review.expectedRevision + 1, approval } })
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
  now: number, connection: CommissionMcpConnectionReader,
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
    return !!view && ['none', 'device-bearer', 'device-oauth'].includes(view.authentication ?? '') && matchesHttpMcpPermission(tool, view)
  } catch { return false }
}
