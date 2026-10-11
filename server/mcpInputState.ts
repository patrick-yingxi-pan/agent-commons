/** Private durable state for the bounded continuation of an external MCP form.
 * Submitted answers never live here: receipts retain only opaque identity and a
 * digest of the exact command. */
import { createHash } from 'node:crypto'
import type { ToolActivity } from '../contract/entities.ts'
import type { McpFormInputRequired } from '../contract/mcpElicitation.ts'
import { isExternalMcpId } from '../contract/mcpConnections.ts'
import { parseMcpFormInputRequired } from './mcpElicitation.ts'
import { routineMcpJsonText } from './routineMcpPolicy.ts'

export const MCP_INPUT_MAX_ROUNDS = 4
export const MCP_INPUT_TTL_MS = 3_600_000
export const MCP_INPUT_MAX_FLOWS = 100_000
const MAX_RECEIPTS = MCP_INPUT_MAX_ROUNDS + 1
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HEX_256 = /^[0-9a-f]{64}$/

export interface McpInputSavedReceipt {
  responseId: string
  payloadHash: string
  round: number
  action: 'respond' | 'stop'
}

export interface McpInputFlow {
  sessionId: string
  activityId: string
  decisionId: string
  tenantId: string
  ownerUserId: string
  bindingHash: string
  createdAt: number
  expiresAt: number
  round: number
  pending?: McpFormInputRequired
  receipts: McpInputSavedReceipt[]
}

export function mcpInputFlowKey(sessionId: string, decisionId: string): string {
  return JSON.stringify([sessionId, decisionId])
}

/** Keep runtime admission in step with the persisted parser's fixed bound. */
export function hasMcpInputFlowCapacity(current: number, additional = 1): boolean {
  return Number.isSafeInteger(current) && current >= 0 && Number.isSafeInteger(additional) && additional >= 0 &&
    current + additional <= MCP_INPUT_MAX_FLOWS
}

function canonical(value: unknown): string {
  return routineMcpJsonText(value as never)
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

/** Binds continuation to the exact inspected connection, tool anchor, and
 * original model-authored arguments. */
export function mcpInputBindingHash(activity: ToolActivity): string {
  return digest({ connectorId: activity.connectorId, mcp: activity.mcp, input: activity.input ?? {} })
}

export function mcpInputCommandHash(value: unknown): string {
  return digest(value)
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
const exact = (value: Record<string, unknown>, required: string[], optional: string[] = []): boolean => {
  const allowed = new Set([...required, ...optional])
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.has(key))
}
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && typeof value === 'number'

function parseFlow(value: unknown): McpInputFlow {
  if (!record(value) || !exact(value,
    ['sessionId', 'activityId', 'decisionId', 'tenantId', 'ownerUserId', 'bindingHash', 'createdAt', 'expiresAt', 'round', 'receipts'], ['pending']) ||
    !text(value.sessionId) || !text(value.activityId) || !/^tool-activity-decision-[a-f0-9]{24}$/.test(String(value.decisionId)) ||
    !text(value.tenantId) || !text(value.ownerUserId) || typeof value.bindingHash !== 'string' || !HEX_256.test(value.bindingHash) ||
    !integer(value.createdAt) || value.createdAt < 0 || !integer(value.expiresAt) || value.expiresAt !== value.createdAt + MCP_INPUT_TTL_MS ||
    !integer(value.round) || value.round < 0 || value.round > MCP_INPUT_MAX_ROUNDS || !Array.isArray(value.receipts) || value.receipts.length > MAX_RECEIPTS) {
    throw new Error('Invalid private MCP input flow.')
  }
  const receipts: McpInputSavedReceipt[] = []
  const ids = new Set<string>()
  const rounds = new Set<number>()
  for (let index = 0; index < value.receipts.length; index += 1) {
    const item = value.receipts[index]
    if (!record(item) || !exact(item, ['responseId', 'payloadHash', 'round', 'action']) ||
      typeof item.responseId !== 'string' || !UUID_V4.test(item.responseId) || ids.has(item.responseId) ||
      typeof item.payloadHash !== 'string' || !HEX_256.test(item.payloadHash) || !integer(item.round) ||
      item.round !== index + 1 || item.round > value.round || rounds.has(item.round) ||
      (item.action !== 'respond' && item.action !== 'stop')) throw new Error('Invalid private MCP input receipt.')
    ids.add(item.responseId)
    rounds.add(item.round)
    receipts.push({ responseId: item.responseId, payloadHash: item.payloadHash, round: item.round, action: item.action })
  }
  let pending: McpFormInputRequired | undefined
  if (value.pending !== undefined) {
    try { pending = parseMcpFormInputRequired(value.pending) } catch { throw new Error('Invalid private MCP input form.') }
    if (value.round < 1 || receipts.length !== value.round - 1 || receipts.some(receipt => receipt.action !== 'respond')) throw new Error('Impossible private MCP input continuation.')
  }
  if (value.round === 0 && (pending !== undefined || receipts.length > 0)) throw new Error('Impossible initial MCP input flow.')
  if (pending === undefined && value.round > 0 && receipts.length !== value.round && receipts.length !== value.round - 1) throw new Error('Impossible private MCP input receipt sequence.')
  if (receipts.some(receipt => receipt.action === 'stop') &&
      (pending !== undefined || receipts.at(-1)?.action !== 'stop' || receipts.at(-1)?.round !== value.round)) {
    throw new Error('Impossible private MCP input stop receipt.')
  }
  return {
    sessionId: value.sessionId, activityId: value.activityId, decisionId: value.decisionId as string,
    tenantId: value.tenantId, ownerUserId: value.ownerUserId, bindingHash: value.bindingHash,
    createdAt: value.createdAt, expiresAt: value.expiresAt, round: value.round,
    ...(pending === undefined ? {} : { pending }), receipts,
  }
}

export function parseMcpInputFlows(value: unknown): McpInputFlow[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MCP_INPUT_MAX_FLOWS) throw new Error('Invalid private MCP input flows.')
  const flows = value.map(parseFlow)
  const keys = new Set<string>()
  for (const flow of flows) {
    const key = mcpInputFlowKey(flow.sessionId, flow.decisionId)
    if (keys.has(key)) throw new Error('Duplicate private MCP input flow.')
    keys.add(key)
  }
  return flows
}

function allActivities(session: Record<string, unknown>): unknown[] {
  const activities: unknown[] = []
  for (const field of ['messages', 'compactedMessages']) {
    const messages = session[field]
    if (messages === undefined) continue
    if (!Array.isArray(messages)) return []
    for (const message of messages) {
      if (!record(message)) continue
      const toolActivities = message.toolActivities
      if (toolActivities === undefined) continue
      if (!Array.isArray(toolActivities)) return []
      activities.push(...toolActivities)
    }
  }
  return activities
}

/** Confirms private flow rows are attached to the exact activity in active or
 * compacted history. Awaiting input always has a private form flow. */
export function validateMcpInputFlows(flows: McpInputFlow[], sessions: unknown): boolean {
  if (!Array.isArray(sessions)) return false
  const seen = new Set<string>()
  const pendingKeys = new Set<string>()
  const sessionsById = new Map<string, Record<string, unknown>>()
  const activitiesBySession = new Map<string, Map<string, { activity: Record<string, unknown>; count: number }>>()
  for (const session of sessions) {
    if (!record(session) || typeof session.id !== 'string') return false
    if (sessionsById.has(session.id)) return false
    sessionsById.set(session.id, session)
    const activityIndex = new Map<string, { activity: Record<string, unknown>; count: number }>()
    for (const activity of allActivities(session)) {
      if (!record(activity)) continue
      if (activity.status === 'awaiting-input') {
        if (typeof activity.decisionId !== 'string') return false
        pendingKeys.add(mcpInputFlowKey(session.id, activity.decisionId))
      }
      if (typeof activity.id === 'string' && typeof activity.decisionId === 'string') {
        const identity = JSON.stringify([activity.id, activity.decisionId])
        const indexed = activityIndex.get(identity)
        if (indexed) indexed.count += 1
        else activityIndex.set(identity, { activity, count: 1 })
      }
    }
    activitiesBySession.set(session.id, activityIndex)
  }
  for (const flow of flows) {
    const key = mcpInputFlowKey(flow.sessionId, flow.decisionId)
    if (seen.has(key)) return false
    seen.add(key)
    const session = sessionsById.get(flow.sessionId)
    if (!session || (session.tenantId !== undefined && session.tenantId !== flow.tenantId)) return false
    const indexed = activitiesBySession.get(flow.sessionId)?.get(JSON.stringify([flow.activityId, flow.decisionId]))
    if (!indexed || indexed.count !== 1) return false
    const activity = indexed.activity as unknown as ToolActivity
    let bindingHash: string
    try { bindingHash = mcpInputBindingHash(activity) } catch { return false }
    if (activity.kind !== 'action' || activity.mcp === undefined || typeof activity.connectorId !== 'string' || !isExternalMcpId(activity.connectorId) ||
      !['running', 'awaiting-input', 'done', 'failed', 'uncertain'].includes(String(activity.status)) ||
      bindingHash !== flow.bindingHash) return false
    const runningReceiptsInvalid = activity.status === 'running' && (
      flow.round === 0
        ? flow.receipts.length !== 0
        : flow.receipts.length !== flow.round || flow.receipts.some(receipt => receipt.action !== 'respond')
    )
    if ((activity.status === 'awaiting-input') !== (flow.pending !== undefined) ||
      (activity.status === 'awaiting-input' && flow.round < 1) || runningReceiptsInvalid) return false
    if (flow.receipts.some(receipt => receipt.action === 'stop') && activity.status !== 'uncertain') return false
  }
  return [...pendingKeys].every(key => seen.has(key))
}
