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
import { matchesHttpMcpPermission, mcpPermissionAllowsCall, mcpPermissionJsonText, sameMcpPermissionJson, snapshotMcpToolPermissions } from './mcpPermission.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'

export interface RoutineMcpScope { tenantId: string; routineId: string }
/** Private provenance, never part of the public Routine permission. Revocation
 * retains it; replacing the approval derives a new stamp from actual selections. */
export interface StoredRoutineMcpOAuthAuthority { ownerUserId: string; connectionIds: string[] }
export interface StoredRoutineMcpLocalAuthority { ownerUserId: string; connectionIds: string[] }
export interface StoredRoutineMcpPolicy extends RoutineMcpScope {
  policy: RoutineMcpPolicy
  oauthAuthority?: StoredRoutineMcpOAuthAuthority
  localAuthority?: StoredRoutineMcpLocalAuthority
}
/** Trusted callback must filter OAuth and local connections by this person's live
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

/** Arguments passed here must already be detached bounded JSON. */
export const routineMcpJsonText = mcpPermissionJsonText
export const sameRoutineMcpJson = sameMcpPermissionJson

function detached(value: unknown): Record<string, McpJsonValue> {
  try {
    const copy = snapshotMcpJson(value, { maxBytes: 262_144, maxDepth: 40, maxNodes: 20_000 })
    return record(copy) ? copy : fail()
  } catch { return fail() }
}

function toolsFrom(value: McpJsonValue): RoutineMcpToolPermission[] {
  return snapshotMcpToolPermissions(value, ROUTINE_MCP_MAX_TOOLS) ?? fail()
}

function approvalFrom(value: McpJsonValue): RoutineMcpApproval {
  if (!record(value) || !fields(value, ['definitionRevision', 'reviewHash', 'approvedAt', 'expiresAt', 'maxCallsPerRun', 'tools',
      ...(Object.hasOwn(value, 'localPrograms') ? ['localPrograms'] : [])]) ||
      (Object.hasOwn(value, 'localPrograms') && value.localPrograms !== true) ||
      !routineMcpInteger(value.definitionRevision) || !routineMcpInteger(value.approvedAt) || !routineMcpInteger(value.expiresAt) ||
      typeof value.reviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.reviewHash) ||
      value.expiresAt <= value.approvedAt || value.expiresAt - value.approvedAt > ROUTINE_MCP_MAX_LIFETIME_MS ||
      !routineMcpInteger(value.maxCallsPerRun) || value.maxCallsPerRun < 1 || value.maxCallsPerRun > ROUTINE_MCP_MAX_CALLS) return fail()
  return { definitionRevision: value.definitionRevision, reviewHash: value.reviewHash, approvedAt: value.approvedAt, expiresAt: value.expiresAt,
    maxCallsPerRun: value.maxCallsPerRun, tools: toolsFrom(value.tools), ...(value.localPrograms === true ? { localPrograms: true } : {}) }
}

export function parseRoutineMcpOAuthAuthority(value: unknown): StoredRoutineMcpOAuthAuthority {
  const copy = detached(value)
  if (!fields(copy, ['ownerUserId', 'connectionIds']) || !routineMcpOwnerUserId(copy.ownerUserId) ||
      !Array.isArray(copy.connectionIds) || !copy.connectionIds.length || copy.connectionIds.length > ROUTINE_MCP_MAX_TOOLS ||
      copy.connectionIds.some((id, index, ids) => typeof id !== 'string' || !/^mcp-connection-[a-f0-9]{32}$/.test(id) ||
        (index > 0 && (ids[index - 1] as string) >= id))) return fail()
  return { ownerUserId: copy.ownerUserId, connectionIds: copy.connectionIds as string[] }
}

export function parseRoutineMcpLocalAuthority(value: unknown): StoredRoutineMcpLocalAuthority {
  return parseRoutineMcpOAuthAuthority(value)
}

/** Only parsed state establishes the common person identity of both stamps. */
export function routineMcpPermissionOwner(value: StoredRoutineMcpPolicy | undefined): string | undefined {
  return value?.localAuthority?.ownerUserId ?? value?.oauthAuthority?.ownerUserId
}

/** Strict present-state admission; legacy absence is the outer store's concern. */
export function parseRoutineMcpPolicy(value: unknown): StoredRoutineMcpPolicy {
  const copy = detached(value)
  const hasOAuthAuthority = Object.hasOwn(copy, 'oauthAuthority')
  const hasLocalAuthority = Object.hasOwn(copy, 'localAuthority')
  if (!fields(copy, ['tenantId', 'routineId', 'policy', ...(hasOAuthAuthority ? ['oauthAuthority'] : []),
      ...(hasLocalAuthority ? ['localAuthority'] : [])]) || !identity(copy.tenantId) || !identity(copy.routineId) ||
      !record(copy.policy) || !fields(copy.policy, ['version', 'revision', 'approval']) || copy.policy.version !== 1 ||
      !routineMcpInteger(copy.policy.revision) || copy.policy.revision < 1) return fail()
  const approval = copy.policy.approval === null ? null : approvalFrom(copy.policy.approval)
  const oauthAuthority = hasOAuthAuthority ? parseRoutineMcpOAuthAuthority(copy.oauthAuthority) : undefined
  const localAuthority = hasLocalAuthority ? parseRoutineMcpLocalAuthority(copy.localAuthority) : undefined
  const oauthIds = oauthAuthority?.connectionIds ?? []
  const localIds = localAuthority?.connectionIds ?? []
  if (oauthIds.length + localIds.length > ROUTINE_MCP_MAX_TOOLS ||
      (oauthAuthority && localAuthority && oauthAuthority.ownerUserId !== localAuthority.ownerUserId) ||
      localIds.some(id => oauthIds.includes(id)) ||
      (approval && ((approval.localPrograms === true) !== !!localAuthority ||
        [...oauthIds, ...localIds].some(id => !approval.tools.some(tool => tool.connectionId === id))))) return fail()
  return { tenantId: copy.tenantId, routineId: copy.routineId, policy: { version: 1, revision: copy.policy.revision,
    approval }, ...(oauthAuthority ? { oauthAuthority } : {}), ...(localAuthority ? { localAuthority } : {}) }
}

/** Local launch authority never passes through the HTTP permission matcher. */
function matchesLocalMcpPermission(permission: RoutineMcpToolPermission, view: McpConnectionView): boolean {
  if (view.transport !== 'stdio' || Object.hasOwn(view, 'authentication') ||
      view.id !== permission.connectionId || view.revision !== permission.connectionRevision ||
      view.status !== 'connected' || !routineMcpInteger(view.inspectedAt) || view.execution !== 'approval-required' ||
      !view.executableTools?.includes(permission.toolName)) return false
  try {
    const matches = view.tools.filter(tool => tool.name === permission.toolName)
    return matches.length === 1 && mcpToolSchemaHash(matches[0]) === permission.schemaHash
  } catch { return false }
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
  allowLocalPrograms = false,
): StoredRoutineMcpPolicy {
  const review = detached(intent)
  if (!identity(scope.tenantId) || !identity(scope.routineId) ||
      !fields(review, ['expectedRevision', 'expectedDefinitionRevision', 'reviewHash', 'expiresAt', 'maxCallsPerRun', 'tools',
        ...(Object.hasOwn(review, 'localPrograms') ? ['localPrograms'] : [])]) ||
      (Object.hasOwn(review, 'localPrograms') && review.localPrograms !== true) ||
      !routineMcpInteger(review.expectedRevision) || !routineMcpInteger(review.expectedDefinitionRevision) ||
      !routineMcpInteger(definitionRevision) || !routineMcpInteger(now) || typeof review.reviewHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(review.reviewHash) || (actorUserId !== undefined && !routineMcpOwnerUserId(actorUserId))) return fail()
  if (review.localPrograms === true && allowLocalPrograms !== true) return fail('unavailable')
  const old = current === undefined ? undefined : parseRoutineMcpPolicy(current)
  if ((old && (old.tenantId !== scope.tenantId || old.routineId !== scope.routineId)) ||
      review.expectedRevision !== (old?.policy.revision ?? 0) || review.expectedDefinitionRevision !== definitionRevision) return fail('stale')
  const approval = approvalFrom({ definitionRevision, reviewHash: review.reviewHash, approvedAt: now, expiresAt: review.expiresAt,
    maxCallsPerRun: review.maxCallsPerRun, tools: review.tools, ...(review.localPrograms === true ? { localPrograms: true } : {}) })
  const oauthConnectionIds = new Set<string>()
  const localConnectionIds = new Set<string>()
  for (const tool of approval.tools) {
    const view = connection(tool.connectionId, scope.tenantId, actorUserId)
    if (!view) return fail('unavailable')
    if (view.transport === 'stdio') {
      if (allowLocalPrograms !== true || approval.localPrograms !== true || !matchesLocalMcpPermission(tool, view)) return fail('unavailable')
      if (!routineMcpOwnerUserId(actorUserId)) return fail('denied')
      localConnectionIds.add(tool.connectionId)
      continue
    }
    if (!matchesHttpMcpPermission(tool, view)) return fail('unavailable')
    if (view.authentication === 'device-oauth') {
      if (!routineMcpOwnerUserId(actorUserId)) return fail('denied')
      oauthConnectionIds.add(tool.connectionId)
    } else if (view.authentication !== 'none' && view.authentication !== 'device-bearer') return fail('unavailable')
  }
  if (approval.localPrograms === true && !localConnectionIds.size) return fail()
  return parseRoutineMcpPolicy({ tenantId: scope.tenantId, routineId: scope.routineId,
    policy: { version: 1, revision: (old?.policy.revision ?? 0) + 1, approval },
    ...(localConnectionIds.size ? { localAuthority: { ownerUserId: actorUserId!, connectionIds: [...localConnectionIds].sort() } } : {}),
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
  allowLocalPrograms = false,
): boolean {
  try {
    const queued = parseRoutineMcpPolicy(frozen)
    const current = parseRoutineMcpPolicy(live)
    const approval = queued.policy.approval
    const exact = snapshotMcpBoundToolCall(call)
    if (!approval || !exact || !sameRoutineMcpJson(queued, current) || !routineMcpInteger(now) ||
        liveReviewHash !== approval.reviewHash ||
        now < approval.approvedAt || now >= approval.expiresAt || definitionRevision !== approval.definitionRevision) return false
    const tool = approval.tools.find(tool => mcpPermissionAllowsCall(tool, exact))
    if (!tool) return false
    const view = connection(tool.connectionId, queued.tenantId, routineMcpPermissionOwner(queued))
    const stampedLocal = queued.localAuthority?.connectionIds.includes(tool.connectionId) ?? false
    if (stampedLocal) return allowLocalPrograms === true && approval.localPrograms === true && !!view && matchesLocalMcpPermission(tool, view)
    const stampedOAuth = queued.oauthAuthority?.connectionIds.includes(tool.connectionId) ?? false
    return !!view && (stampedOAuth ? view.authentication === 'device-oauth' :
      view.authentication === 'none' || view.authentication === 'device-bearer') && matchesHttpMcpPermission(tool, view)
  } catch { return false }
}
