import type { ChangesetVersion, EffectEnvelope } from '../contract/contributions.ts'
import type { EnvelopeHarness } from '../contract/contributions.ts'
import { CHANGE_ENTRY_KINDS } from '../contract/contributions.ts'
import type { ProjectEffectType } from '../contract/coordination.ts'
import type { DelegatedActKind, EscalationTrigger } from '../contract/delegations.ts'
import { MAX_JUDGMENT_SUMMARY_CHARS, type DelegatedJudgmentDecision } from '../contract/delegatedJudgment.ts'
import { DELEGATED_ACT_KINDS, ESCALATION_TRIGGERS, MAX_DELEGATION_POLICY_CHARS, MAX_DELEGATION_VERSIONS } from '../contract/delegations.ts'
import { PROJECT_EFFECT_TYPES } from '../contract/coordination.ts'
import { ENVELOPE_HARNESSES } from '../contract/contributions.ts'

export interface DelegatedJudgmentInput {
  policy: {
    actKind: DelegatedActKind
    mode: 'draft' | 'decide'
    policy: string
    escalation: EscalationTrigger[]
    revision: number
    expiresAt?: number
  }
  changeset: ChangesetVersion | null
  envelope: EffectEnvelope | null
  risk: {
    effectful: boolean
    unreviewed: boolean
    stranger: boolean
    readOnlyEnvelope: boolean
  }
}

export interface DelegatedJudgmentResult {
  decision: DelegatedJudgmentDecision
  summary: string
}

/** Completed-but-invalid judgment output is definitive failure, not authority. */
export class DelegatedJudgmentGenerationError extends Error {
  constructor(message = 'The delegated reviewer did not return a complete, valid judgment.', options?: ErrorOptions) {
    super(message, options)
    this.name = 'DelegatedJudgmentGenerationError'
  }
}

/** Provider I/O may have settled remotely even when this process saw no result. */
export class DelegatedJudgmentTransportError extends Error {
  constructor(options?: ErrorOptions) {
    super('The delegated reviewer could not be reached or its response timed out.', options)
    this.name = 'DelegatedJudgmentTransportError'
  }
}

/** A settled response without trustworthy token accounting cannot be accepted. */
export class DelegatedJudgmentUsageError extends Error {
  constructor() {
    super('The delegated reviewer returned invalid usage accounting.')
    this.name = 'DelegatedJudgmentUsageError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const isSafeCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const isTimestamp = (value: unknown): value is number => isSafeCount(value) && (value as number) <= 8_640_000_000_000_000
const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= max

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

/** Parse only the bounded exact JSON result accepted as a delegated judgment. */
export function parseDelegatedJudgmentResult(text: string): DelegatedJudgmentResult {
  if (text.length > 8_000) throw new DelegatedJudgmentGenerationError('The delegated reviewer returned an oversized judgment.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new DelegatedJudgmentGenerationError(undefined, { cause })
  }
  if (!isRecord(value) || !exactKeys(value, ['decision', 'summary']) ||
      !['approve', 'decline', 'escalate'].includes(value.decision as string) ||
      !isText(value.summary, MAX_JUDGMENT_SUMMARY_CHARS)) throw new DelegatedJudgmentGenerationError()
  return { decision: value.decision as DelegatedJudgmentDecision, summary: value.summary.trim() }
}

/** Validate and detach only facts intentionally admitted to the judgment model. */
export function delegatedJudgmentSnapshot(input: DelegatedJudgmentInput): DelegatedJudgmentInput {
  if (!isRecord(input) || !exactKeys(input, ['policy', 'changeset', 'envelope', 'risk']) ||
      !isRecord(input.policy) || !isRecord(input.risk)) {
    throw new DelegatedJudgmentGenerationError('The frozen delegated judgment input is invalid.')
  }
  const policy = input.policy as unknown as Record<string, unknown>
  if (Object.keys(policy).some((key) => !['actKind', 'mode', 'policy', 'escalation', 'revision', 'expiresAt'].includes(key)) ||
      !DELEGATED_ACT_KINDS.includes(policy.actKind as DelegatedActKind) ||
      (policy.mode !== 'draft' && policy.mode !== 'decide') ||
      !isText(policy.policy, MAX_DELEGATION_POLICY_CHARS) ||
      policy.policy.trim().length > MAX_DELEGATION_POLICY_CHARS ||
      !isSafeCount(policy.revision) || policy.revision >= MAX_DELEGATION_VERSIONS ||
      (Object.hasOwn(policy, 'expiresAt') && !isTimestamp(policy.expiresAt)) ||
      !Array.isArray(policy.escalation) || policy.escalation.length > ESCALATION_TRIGGERS.length ||
      policy.escalation.some((trigger) => !ESCALATION_TRIGGERS.includes(trigger as EscalationTrigger)) ||
      !policy.escalation.includes('effectful') || new Set(policy.escalation).size !== policy.escalation.length) {
    throw new DelegatedJudgmentGenerationError('The frozen delegated policy is invalid.')
  }
  if (!exactKeys(input.risk as Record<string, unknown>, ['effectful', 'unreviewed', 'stranger', 'readOnlyEnvelope']) ||
      Object.values(input.risk).some((value) => typeof value !== 'boolean')) {
    throw new DelegatedJudgmentGenerationError('The frozen delegated risk facts are invalid.')
  }

  let changeset: DelegatedJudgmentInput['changeset'] = null
  if (input.changeset !== null) {
    if (!isRecord(input.changeset) || !isSafeCount(input.changeset.version) || input.changeset.version < 1 ||
        !Array.isArray(input.changeset.entries) || !input.changeset.entries.length || input.changeset.entries.length > 20) {
      throw new DelegatedJudgmentGenerationError('The frozen changeset is invalid for delegated judgment.')
    }
    const seen = new Set<string>()
    const entries = input.changeset.entries.map((raw) => {
      if (!isRecord(raw) || Object.keys(raw).some((key) => !['id', 'kind', 'target', 'before', 'after'].includes(key)) ||
          !isText(raw.id, 200) || seen.has(raw.id) || !CHANGE_ENTRY_KINDS.includes(raw.kind as never) ||
          !isText(raw.target, 2_000) || typeof raw.after !== 'string' || raw.after.length > 2_000 ||
          (Object.hasOwn(raw, 'before') && (typeof raw.before !== 'string' || raw.before.length > 2_000))) {
        throw new DelegatedJudgmentGenerationError('The frozen changeset is invalid for delegated judgment.')
      }
      seen.add(raw.id)
      return {
        id: raw.id,
        kind: raw.kind,
        target: raw.target,
        ...(raw.before !== undefined ? { before: raw.before } : {}),
        after: raw.after,
      }
    })
    // Author identity and timestamps are intentionally excluded from model input.
    changeset = { version: input.changeset.version, at: 0, by: '', entries } as ChangesetVersion
  }

  let envelope: DelegatedJudgmentInput['envelope'] = null
  if (input.envelope !== null) {
    const raw = input.envelope as unknown as Record<string, unknown>
    if (!isRecord(raw) || !isSafeCount(raw.version) || raw.version < 1 ||
        (raw.status !== 'proposed' && raw.status !== 'approved') || !Array.isArray(raw.lines) || !raw.lines.length || raw.lines.length > 10 ||
        (raw.approvedVersion !== undefined && (!isSafeCount(raw.approvedVersion) || raw.approvedVersion > raw.version)) ||
        (raw.status === 'approved' && raw.approvedVersion !== raw.version)) {
      throw new DelegatedJudgmentGenerationError('The frozen envelope is invalid for delegated judgment.')
    }
    const lineIds = new Set<string>()
    const lines = raw.lines.map((line) => {
      if (!isRecord(line) || Object.keys(line).some((key) => !['id', 'type', 'target', 'cardinality', 'harness', 'note', 'used'].includes(key)) ||
          !isText(line.id, 200) || lineIds.has(line.id) || !PROJECT_EFFECT_TYPES.includes(line.type as never) || !isText(line.target, 2_000) ||
          !isSafeCount(line.cardinality) || line.cardinality < 1 || line.cardinality > 20 ||
          !ENVELOPE_HARNESSES.includes(line.harness as never) || typeof line.note !== 'string' || line.note.length > 2_000 ||
          !isSafeCount(line.used) || line.used > line.cardinality) {
        throw new DelegatedJudgmentGenerationError('The frozen envelope is invalid for delegated judgment.')
      }
      lineIds.add(line.id)
      return { id: line.id, type: line.type as ProjectEffectType, target: line.target, cardinality: line.cardinality,
        harness: line.harness as EnvelopeHarness, note: line.note, used: line.used }
    })
    envelope = {
      version: raw.version,
      status: raw.status,
      lines,
      proposedBy: '',
      proposedAt: 0,
      ...(raw.approvedVersion === undefined ? {} : { approvedVersion: raw.approvedVersion as number }),
    }
  }

  const detached: DelegatedJudgmentInput = {
    policy: {
      actKind: policy.actKind as DelegatedActKind,
      mode: policy.mode as 'draft' | 'decide',
      policy: (policy.policy as string).trim(),
      escalation: [...(policy.escalation as EscalationTrigger[])],
      revision: policy.revision as number,
      ...(policy.expiresAt === undefined ? {} : { expiresAt: policy.expiresAt as number }),
    },
    changeset,
    envelope,
    risk: { ...input.risk } as DelegatedJudgmentInput['risk'],
  }
  if (JSON.stringify(detached).length > 128_000) {
    throw new DelegatedJudgmentGenerationError('The frozen delegated judgment input exceeds its size limit.')
  }
  return detached
}
