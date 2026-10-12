/** Strict persistence joins for human-resolved Project work. Derived resolution
 * fields are never stored; this validates only the durable link and receipt. */
import type { EffectEnvelope } from '../contract/contributions.ts'
import type { OpenSubGoal } from '../contract/directory.ts'
import { parseStoredContributionEffectAttempt, type StoredContributionEffectAttempt } from './contributionEffectState.ts'
import { computeProjectWorkResolution } from './projectWorkResolution.ts'
import { OPEN_WORK_FIELD_MAX } from '../contract/coordination.ts'

interface LinkedContribution {
  id: string
  projectId: string
  subGoal?: string
  workItemId?: string
  workItemResolution?: unknown
  status: string
  landedAt?: number
  landedBy?: string
  landedByTenant?: string
  events?: unknown
  envelope?: EffectEnvelope
  effectAttempts?: StoredContributionEffectAttempt[]
}

interface ResolutionItem extends Pick<OpenSubGoal, 'id' | 'projectId' | 'subGoal' | 'type' | 'target' | 'status' | 'resolvedAt'> {
  contributionResolution?: unknown
  resolvedBy?: unknown
  resolvedByLabel?: unknown
  resolvedByOwner?: unknown
}

const nonblankId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  value.length <= 200 && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value)

function validUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length || value.charCodeAt(index + 1) < 0xdc00 || value.charCodeAt(index + 1) > 0xdfff) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

const workText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  value.length <= OPEN_WORK_FIELD_MAX && value.trim() === value && validUnicode(value)
const displayName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 &&
  value.length <= OPEN_WORK_FIELD_MAX && validUnicode(value)

/** A same-Project MCP work row may be linked only when its text round-trips
 * through the strict persisted linked-work validator. Existing unlinked legacy
 * rows remain unaffected; this is an admission guard for new links. */
export function isLinkableProjectWorkItem(value: unknown): value is OpenSubGoal {
  if (!plainRecord(value)) return false
  return nonblankId(value.id) && nonblankId(value.projectId) &&
    value.type === 'mcp.mutate' && workText(value.target) && workText(value.subGoal) &&
    (value.status === 'open' || value.status === 'done' || value.status === 'retracted')
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).every((key) => typeof key === 'string')
}

function exactResolution(value: unknown): value is { contributionId: string; effectId: string; by: string } {
  if (!plainRecord(value)) return false
  const keys = Reflect.ownKeys(value)
  return keys.length === 3 && keys.includes('contributionId') && keys.includes('effectId') && keys.includes('by') &&
    nonblankId(value.contributionId) && nonblankId(value.effectId) && displayName(value.by)
}

function validUserLanding(contribution: LinkedContribution, by: string): boolean {
  if (!nonblankId(contribution.landedByTenant) || contribution.status !== 'landed' ||
      !displayName(contribution.landedBy) || contribution.landedBy !== by ||
      !Number.isSafeInteger(contribution.landedAt) || (contribution.landedAt ?? -1) < 0 ||
      !Array.isArray(contribution.events)) return false
  const landed = contribution.events.filter((event) => plainRecord(event) && event.kind === 'landed')
  return landed.length === 1 && plainRecord(landed[0]) && landed[0].actor === by &&
    plainRecord(landed[0].principal) && landed[0].principal.kind === 'user' && nonblankId(landed[0].principal.id) &&
    landed[0].at === contribution.landedAt
}

/**
 * Validate stored Contribution ↔ open-work item links and their optional human
 * resolution receipts. No records are normalized or mutated. Legacy absence is
 * valid; a present malformed link or derived projection fails closed.
 */
function validateProjectWorkPersistence(
  contributionsValue: unknown,
  itemsValue: unknown,
): boolean {
  if (contributionsValue === undefined && itemsValue === undefined) return true
  if (contributionsValue !== undefined && !Array.isArray(contributionsValue)) return false
  if (itemsValue !== undefined && !Array.isArray(itemsValue)) return false

  const contributions = (contributionsValue ?? []) as LinkedContribution[]
  const items = (itemsValue ?? []) as ResolutionItem[]
  const byItemId = new Map<string, ResolutionItem[]>()
  for (const raw of items) {
    if (!plainRecord(raw) || typeof raw.id !== 'string') continue
    const rows = byItemId.get(raw.id) ?? []
    rows.push(raw as unknown as ResolutionItem)
    byItemId.set(raw.id, rows)
  }

  const linkedByItem = new Map<string, LinkedContribution[]>()
  for (const raw of contributions) {
    if (!plainRecord(raw)) return false
    const contribution = raw as unknown as LinkedContribution
    if (Object.hasOwn(raw, 'workItemResolution')) return false
    if (!Object.hasOwn(raw, 'workItemId')) continue
    if (!nonblankId(raw.workItemId) || !nonblankId(raw.id) || !nonblankId(raw.projectId)) return false
    if (Object.hasOwn(raw, 'effects')) return false
    // Every Contribution write includes its opening event, and the public
    // projection maps this array unconditionally. Missing storage must not be
    // admitted for a linked row and then fail on an ordinary read.
    if (!Array.isArray(contribution.events) || !contribution.events.every((event) => plainRecord(event))) return false
    for (const event of contribution.events) {
      if (Object.hasOwn(event, 'envelopeVersion') &&
          (!Number.isSafeInteger(event.envelopeVersion) || (event.envelopeVersion as number) < 1)) return false
    }
    if (contribution.envelope !== undefined &&
        (!plainRecord(contribution.envelope) || !Array.isArray(contribution.envelope.lines) ||
          !contribution.envelope.lines.every((line) => plainRecord(line)))) return false
    if (contribution.effectAttempts !== undefined) {
      if (!Array.isArray(contribution.effectAttempts)) return false
      for (const attempt of contribution.effectAttempts) {
        try { parseStoredContributionEffectAttempt(attempt) } catch { return false }
      }
    }
    const matches = byItemId.get(raw.workItemId)
    if (!matches || matches.length !== 1) return false
    const item = matches[0]
    if (!nonblankId(item.id) || !nonblankId(item.projectId) || !workText(item.target) || !workText(item.subGoal) ||
        item.projectId !== raw.projectId || item.type !== 'mcp.mutate' || raw.subGoal !== item.subGoal ||
        !['open', 'done', 'retracted'].includes(item.status) ||
        (contribution.status !== 'open' && contribution.status !== 'landed')) return false
    const linked = linkedByItem.get(raw.workItemId) ?? []
    linked.push(contribution)
    linkedByItem.set(raw.workItemId, linked)
  }
  for (const [itemId, linked] of linkedByItem) {
    const item = byItemId.get(itemId)?.[0]
    for (const contribution of linked) {
      if (contribution.status !== 'landed') continue
      if (!item || !exactResolution(item.contributionResolution) ||
          item.contributionResolution.contributionId !== contribution.id) return false
    }
  }

  for (const raw of items) {
    if (!plainRecord(raw) || !Object.hasOwn(raw, 'contributionResolution')) continue
    if (!exactResolution(raw.contributionResolution) || raw.status !== 'done' ||
        !Number.isSafeInteger(raw.resolvedAt) || (raw.resolvedAt as number) < 0 ||
        Object.hasOwn(raw, 'resolvedBy') || Object.hasOwn(raw, 'resolvedByLabel') || Object.hasOwn(raw, 'resolvedByOwner')) return false
    const resolution = raw.contributionResolution
    const linked = linkedByItem.get(raw.id as string)
    if (!linked) return false
    const matching = contributions.filter((candidate) => candidate.id === resolution.contributionId)
    if (matching.length !== 1 || !linked.includes(matching[0])) return false
    const contribution = matching[0]
    if (contribution.id !== resolution.contributionId || contribution.projectId !== raw.projectId ||
        contribution.landedAt !== raw.resolvedAt || !validUserLanding(contribution, resolution.by)) return false
    const proof = computeProjectWorkResolution({
      id: raw.id as string,
      projectId: raw.projectId as string,
      type: raw.type as OpenSubGoal['type'],
      target: raw.target as string,
      status: 'open',
    }, contribution)
    if (proof.status !== 'ready' || proof.effectId !== resolution.effectId) return false
  }
  return true
}

/** Persisted-state entry point. Nested schemas normally run through the core
 * format validators first; direct callers still fail closed on malformed data. */
export function validProjectWorkPersistence(contributionsValue: unknown, itemsValue: unknown): boolean {
  try { return validateProjectWorkPersistence(contributionsValue, itemsValue) }
  catch { return false }
}
