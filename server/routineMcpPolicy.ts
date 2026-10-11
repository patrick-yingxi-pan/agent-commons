/** Pure policy preparation, not an authorization door. The store must verify
 * current Routine ownership, supply tenant-filtered connections, and commit
 * returned state atomically. Neither context attachments nor Commissions feed
 * this policy. Nothing here performs I/O or grants interactive standing consent. */
import {
  ROUTINE_MCP_MAX_CALLS, ROUTINE_MCP_MAX_LIFETIME_MS, ROUTINE_MCP_MAX_TOOLS,
  type RoutineMcpApproval, type RoutineMcpApprovalIntent, type RoutineMcpPolicy,
  type RoutineMcpToolPermission,
} from '../contract/routineMcp.ts'
import type { McpBoundToolCall, McpJsonValue } from '../contract/mcpExecution.ts'
import type { McpConnectionView } from '../contract/mcpConnections.ts'
import { snapshotMcpJson } from './mcpJson.ts'
import { snapshotMcpBoundToolCall } from './mcpBoundCall.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'

export interface RoutineMcpScope { tenantId: string; routineId: string }
/** Private provenance, never part of the public Routine permission. Revocation
 * retains it; replacing the approval derives a new stamp from actual selections. */
export interface StoredRoutineMcpOAuthAuthority { ownerUserId: string; connectionIds: string[] }
export interface StoredRoutineMcpPolicy extends RoutineMcpScope {
  policy: RoutineMcpPolicy
  oauthAuthority?: StoredRoutineMcpOAuthAuthority
}
/** Trusted callback must filter OAuth connections by this person's live
 * membership and exact ownership. A public view alone cannot prove ownership. */
export type RoutineMcpConnectionReader = (id: string, tenantId: string, actorUserId?: string) => McpConnectionView | undefined

export class RoutineMcpPolicyError extends Error {
  readonly code: 'invalid' | 'stale' | 'unavailable' | 'denied' | 'limit'
  constructor(code: RoutineMcpPolicyError['code'] = 'invalid') {
    super(`Routine MCP permission ${code}.`)
    this.name = 'RoutineMcpPolicyError'
    this.code = code
  }
}
const fail = (code: RoutineMcpPolicyError['code'] = 'invalid'): never => { throw new RoutineMcpPolicyError(code) }
const record = (value: unknown): value is Record<string, McpJsonValue> => value !== null && typeof value === 'object' && !Array.isArray(value)
export const routineMcpInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const identity = (value: unknown): value is string => typeof value === 'string' && value.trim() === value &&
  value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
export const routineMcpOwnerUserId = (value: unknown): value is string => typeof value === 'string' &&
  value.length > 0 && value.length <= 200 && value.trim().length > 0 && /^[\x20-\x7e]+$/.test(value)
const fields = (value: Record<string, McpJsonValue>, names: string[]): boolean =>
  Object.keys(value).length === names.length && names.every(key => Object.hasOwn(value, key))

function canonical(value: McpJsonValue): McpJsonValue {
  if (Array.isArray(value)) return value.map(canonical)
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
/** Arguments passed here must already be detached bounded JSON. */
export const routineMcpJsonText = (value: unknown): string => JSON.stringify(canonical(value as McpJsonValue))
export const sameRoutineMcpJson = (a: unknown, b: unknown): boolean =>
  routineMcpJsonText(a) === routineMcpJsonText(b)

function detached(value: unknown): Record<string, McpJsonValue> {
  try {
    const copy = snapshotMcpJson(value, { maxBytes: 262_144, maxDepth: 40, maxNodes: 20_000 })
    return record(copy) ? copy : fail()
  } catch { return fail() }
}

function toolsFrom(value: McpJsonValue): RoutineMcpToolPermission[] {
  if (!Array.isArray(value) || !value.length || value.length > ROUTINE_MCP_MAX_TOOLS) return fail()
  const seen = new Set<string>()
  return value.map((raw) => {
    if (!record(raw) || !fields(raw, ['connectionId', 'connectionRevision', 'toolName', 'schemaHash', 'fixedArguments'])) return fail()
    const binding = snapshotMcpBoundToolCall({ connectionId: raw.connectionId, connectionRevision: raw.connectionRevision,
      toolName: raw.toolName, schemaHash: raw.schemaHash, arguments: raw.fixedArguments })
    if (!binding) return fail()
    const key = JSON.stringify([binding.connectionId, binding.toolName])
    if (seen.has(key)) return fail()
    seen.add(key)
    const { arguments: fixedArguments, ...anchor } = binding
    return { ...anchor, fixedArguments }
  })
}

function approvalFrom(value: McpJsonValue): RoutineMcpApproval {
  if (!record(value) || !fields(value, ['definitionRevision', 'reviewHash', 'approvedAt', 'expiresAt', 'maxCallsPerRun', 'tools']) ||
      !routineMcpInteger(value.definitionRevision) || !routineMcpInteger(value.approvedAt) || !routineMcpInteger(value.expiresAt) ||
      typeof value.reviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.reviewHash) ||
      value.expiresAt <= value.approvedAt || value.expiresAt - value.approvedAt > ROUTINE_MCP_MAX_LIFETIME_MS ||
      !routineMcpInteger(value.maxCallsPerRun) || value.maxCallsPerRun < 1 || value.maxCallsPerRun > ROUTINE_MCP_MAX_CALLS) return fail()
  return { definitionRevision: value.definitionRevision, reviewHash: value.reviewHash, approvedAt: value.approvedAt, expiresAt: value.expiresAt,
    maxCallsPerRun: value.maxCallsPerRun, tools: toolsFrom(value.tools) }
}

export function parseRoutineMcpOAuthAuthority(value: unknown): StoredRoutineMcpOAuthAuthority {
  const copy = detached(value)
  if (!fields(copy, ['ownerUserId', 'connectionIds']) || !routineMcpOwnerUserId(copy.ownerUserId) ||
      !Array.isArray(copy.connectionIds) || !copy.connectionIds.length || copy.connectionIds.length > ROUTINE_MCP_MAX_TOOLS ||
      copy.connectionIds.some((id, index, ids) => typeof id !== 'string' || !/^mcp-connection-[a-f0-9]{32}$/.test(id) ||
        (index > 0 && (ids[index - 1] as string) >= id))) return fail()
  return { ownerUserId: copy.ownerUserId, connectionIds: copy.connectionIds as string[] }
}

/** Strict present-state admission; legacy absence is the outer store's concern. */
export function parseRoutineMcpPolicy(value: unknown): StoredRoutineMcpPolicy {
  const copy = detached(value)
  const hasAuthority = Object.hasOwn(copy, 'oauthAuthority')
  if (!fields(copy, ['tenantId', 'routineId', 'policy', ...(hasAuthority ? ['oauthAuthority'] : [])]) || !identity(copy.tenantId) || !identity(copy.routineId) ||
      !record(copy.policy) || !fields(copy.policy, ['version', 'revision', 'approval']) || copy.policy.version !== 1 ||
      !routineMcpInteger(copy.policy.revision) || copy.policy.revision < 1) return fail()
  const approval = copy.policy.approval === null ? null : approvalFrom(copy.policy.approval)
  const oauthAuthority = hasAuthority ? parseRoutineMcpOAuthAuthority(copy.oauthAuthority) : undefined
  if (oauthAuthority && approval && oauthAuthority.connectionIds.some(id => !approval.tools.some(tool => tool.connectionId === id))) return fail()
  return { tenantId: copy.tenantId, routineId: copy.routineId, policy: { version: 1, revision: copy.policy.revision,
    approval }, ...(oauthAuthority ? { oauthAuthority } : {}) }
}

function matchesConnection(permission: RoutineMcpToolPermission, view: McpConnectionView | undefined): boolean {
  if (!view || view.transport === 'stdio' || view.id !== permission.connectionId || view.revision !== permission.connectionRevision ||
      view.status !== 'connected' || view.execution !== 'approval-required' || !view.executableTools?.includes(permission.toolName)) return false
  const matches = view.tools.filter(tool => tool.name === permission.toolName)
  try { return matches.length === 1 && mcpToolSchemaHash(matches[0]) === permission.schemaHash } catch { return false }
}

/** Caller rechecks ownership and all review preconditions when committing.
 * Constraints only narrow a tool; exact full input validation still belongs to
 * the bounded schema worker immediately before the eventual transport call. */
export function approveRoutineMcpPolicy(
  scope: RoutineMcpScope,
  current: StoredRoutineMcpPolicy | undefined,
  definitionRevision: number,
  intent: RoutineMcpApprovalIntent,
  now: number,
  connection: RoutineMcpConnectionReader,
  actorUserId?: string,
): StoredRoutineMcpPolicy {
  const review = detached(intent)
  if (!identity(scope.tenantId) || !identity(scope.routineId) ||
      !fields(review, ['expectedRevision', 'expectedDefinitionRevision', 'reviewHash', 'expiresAt', 'maxCallsPerRun', 'tools']) ||
      !routineMcpInteger(review.expectedRevision) || !routineMcpInteger(review.expectedDefinitionRevision) ||
      !routineMcpInteger(definitionRevision) || !routineMcpInteger(now) || typeof review.reviewHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(review.reviewHash) || (actorUserId !== undefined && !routineMcpOwnerUserId(actorUserId))) return fail()
  const old = current === undefined ? undefined : parseRoutineMcpPolicy(current)
  if ((old && (old.tenantId !== scope.tenantId || old.routineId !== scope.routineId)) ||
      review.expectedRevision !== (old?.policy.revision ?? 0) || review.expectedDefinitionRevision !== definitionRevision) return fail('stale')
  const approval = approvalFrom({ definitionRevision, reviewHash: review.reviewHash, approvedAt: now, expiresAt: review.expiresAt,
    maxCallsPerRun: review.maxCallsPerRun, tools: review.tools })
  const oauthConnectionIds = new Set<string>()
  for (const tool of approval.tools) {
    const view = connection(tool.connectionId, scope.tenantId, actorUserId)
    if (!view || !matchesConnection(tool, view)) return fail('unavailable')
    if (view.authentication === 'device-oauth') {
      if (!routineMcpOwnerUserId(actorUserId)) return fail('denied')
      oauthConnectionIds.add(tool.connectionId)
    } else if (view.authentication !== 'none' && view.authentication !== 'device-bearer') return fail('unavailable')
  }
  return parseRoutineMcpPolicy({ tenantId: scope.tenantId, routineId: scope.routineId,
    policy: { version: 1, revision: (old?.policy.revision ?? 0) + 1, approval },
    ...(oauthConnectionIds.size ? { oauthAuthority: { ownerUserId: actorUserId!, connectionIds: [...oauthConnectionIds].sort() } } : {}) })
}

export function revokeRoutineMcpPolicy(value: StoredRoutineMcpPolicy, expectedRevision: number): StoredRoutineMcpPolicy {
  const current = parseRoutineMcpPolicy(value)
  if (!routineMcpInteger(expectedRevision) || current.policy.revision !== expectedRevision) return fail('stale')
  if (current.policy.approval === null) return current
  return parseRoutineMcpPolicy({ ...current, policy: { version: 1, revision: current.policy.revision + 1, approval: null } })
}

/** Exact frozen/live intersection. A new approval, even a broader one, never
 * repairs an old queued run. Returning true is not durable call admission. */
export function routineMcpCallPermitted(
  frozen: StoredRoutineMcpPolicy,
  live: StoredRoutineMcpPolicy | undefined,
  definitionRevision: number,
  call: McpBoundToolCall,
  now: number,
  connection: RoutineMcpConnectionReader,
  liveReviewHash: string,
): boolean {
  try {
    const queued = parseRoutineMcpPolicy(frozen)
    const current = parseRoutineMcpPolicy(live)
    const approval = queued.policy.approval
    const exact = snapshotMcpBoundToolCall(call)
    if (!approval || !exact || !sameRoutineMcpJson(queued, current) || !routineMcpInteger(now) ||
        liveReviewHash !== approval.reviewHash ||
        now < approval.approvedAt || now >= approval.expiresAt || definitionRevision !== approval.definitionRevision) return false
    const tool = approval.tools.find(tool => tool.connectionId === exact.connectionId && tool.connectionRevision === exact.connectionRevision &&
      tool.toolName === exact.toolName && tool.schemaHash === exact.schemaHash)
    if (!tool || !Object.keys(tool.fixedArguments).every(key => Object.hasOwn(exact.arguments, key) &&
      sameRoutineMcpJson(tool.fixedArguments[key], exact.arguments[key]))) return false
    const view = connection(tool.connectionId, queued.tenantId, queued.oauthAuthority?.ownerUserId)
    const stampedOAuth = queued.oauthAuthority?.connectionIds.includes(tool.connectionId) ?? false
    return !!view && (stampedOAuth ? view.authentication === 'device-oauth' :
      view.authentication === 'none' || view.authentication === 'device-bearer') && matchesConnection(tool, view)
  } catch { return false }
}
