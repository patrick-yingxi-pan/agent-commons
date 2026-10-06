/** One authority-policy parser for HTTP, store mutation and durable admission. */
import {
  DELEGATED_ACT_KINDS, ESCALATION_TRIGGERS,
  MAX_DELEGATION_POLICY_CHARS, MAX_DELEGATION_VERSIONS,
  type DelegationPolicyVersion, type PatchDelegationRequest,
} from '../contract/delegations.ts'
import type { StoredDelegation } from './persistence/format.ts'
import { ValidationError } from './conflict.ts'
import { isDelegationRevocationId } from './delegationRevocationIdentity.ts'

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const timestamp = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 8_640_000_000_000_000

export function validDelegationExpiry(value: unknown): value is number {
  return timestamp(value)
}

export function delegationPolicyPatch(value: unknown): PatchDelegationRequest {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'escalation,expectedRevision,expiresAt,mode,policy') {
    throw new ValidationError('Supply only expectedRevision, policy, escalation, mode and expiresAt (null means no expiry).')
  }
  if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0 ||
      (value.expectedRevision as number) >= Number.MAX_SAFE_INTEGER ||
      typeof value.policy !== 'string' || !value.policy.trim() || value.policy.trim().length > MAX_DELEGATION_POLICY_CHARS ||
      !Array.isArray(value.escalation) || value.escalation.length > ESCALATION_TRIGGERS.length ||
      value.escalation.some((trigger) => !ESCALATION_TRIGGERS.includes(trigger)) ||
      (value.mode !== 'draft' && value.mode !== 'decide') ||
      (value.expiresAt !== null && !timestamp(value.expiresAt))) {
    throw new ValidationError('Use a valid policy (1–2000 characters), revision, autonomy, escalation triggers and UTC expiry.')
  }
  return {
    expectedRevision: value.expectedRevision as number,
    policy: value.policy.trim(),
    escalation: ESCALATION_TRIGGERS.filter((trigger) => trigger === 'effectful' || (value.escalation as unknown[]).includes(trigger)),
    mode: value.mode,
    expiresAt: value.expiresAt as number | null,
  }
}

export function sameDelegationPolicy(
  version: Pick<DelegationPolicyVersion, 'policy' | 'mode' | 'escalation' | 'expiresAt'>,
  request: PatchDelegationRequest,
): boolean {
  return version.policy === request.policy && version.mode === request.mode &&
    (version.expiresAt ?? null) === request.expiresAt &&
    version.escalation.length === request.escalation.length &&
    request.escalation.every((trigger) => version.escalation.includes(trigger))
}

/** No invented older policies: a legacy row supplies only its actual original. */
export function delegationVersions(row: StoredDelegation): DelegationPolicyVersion[] {
  return structuredClone(row.versions ?? [{
    revision: 0, policy: row.policy!, escalation: row.escalation, mode: row.mode,
    updatedAt: row.createdAt, ...(row.expiresAt === undefined ? {} : { expiresAt: row.expiresAt }),
  }])
}

/** A malformed present history cannot discard an expiry or silently regain
 * authority after restart. Legacy immutable grants remain revision zero. */
export function validStoredDelegations(value: unknown): value is StoredDelegation[] {
  if (!Array.isArray(value)) return false
  const ids = new Set<string>()
  return value.every((row) => {
    if (!record(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id) ||
        Object.keys(row).some((key) => !['id', 'projectId', 'agentId', 'agentLabel', 'actKind', 'policy', 'escalation', 'mode', 'createdAt', 'delegatorTenant', 'revision', 'expiresAt', 'versions'].includes(key)) ||
        typeof row.projectId !== 'string' || !row.projectId ||
        typeof row.delegatorTenant !== 'string' || !row.delegatorTenant ||
        typeof row.agentId !== 'string' || !row.agentId || typeof row.agentLabel !== 'string' ||
        !DELEGATED_ACT_KINDS.includes(row.actKind as never) || !timestamp(row.createdAt) ||
        Object.hasOwn(row, 'mine') || Object.hasOwn(row, 'expired')) return false
    ids.add(row.id)
    let current: PatchDelegationRequest
    try {
      current = delegationPolicyPatch({
        expectedRevision: row.revision ?? 0, policy: row.policy, mode: row.mode,
        escalation: row.escalation, expiresAt: row.expiresAt ?? null,
      })
    } catch { return false }
    if (row.policy !== current.policy || !Array.isArray(row.escalation) ||
        !row.escalation.includes('effectful') || new Set(row.escalation).size !== row.escalation.length ||
        (Object.hasOwn(row, 'expiresAt') && !timestamp(row.expiresAt))) return false
    if (row.versions === undefined) return (row.revision === undefined || row.revision === 0) && row.expiresAt === undefined
    if (!Array.isArray(row.versions) || !row.versions.length || row.versions.length > MAX_DELEGATION_VERSIONS ||
        row.revision !== row.versions.length - 1) return false
    let previousAt = row.createdAt
    for (let index = 0; index < row.versions.length; index += 1) {
      const version = row.versions[index]
      if (!record(version) || version.revision !== index || !timestamp(version.updatedAt) || version.updatedAt < previousAt ||
          (index === 0 && version.updatedAt !== row.createdAt) ||
          Object.keys(version).some((key) => !['revision', 'policy', 'escalation', 'mode', 'expiresAt', 'updatedAt'].includes(key))) return false
      try {
        const parsed = delegationPolicyPatch({ expectedRevision: index, policy: version.policy, escalation: version.escalation, mode: version.mode, expiresAt: version.expiresAt ?? null })
        if (version.policy !== parsed.policy || !Array.isArray(version.escalation) || !version.escalation.includes('effectful') ||
            new Set(version.escalation).size !== version.escalation.length ||
            (Object.hasOwn(version, 'expiresAt') && !timestamp(version.expiresAt))) return false
      } catch { return false }
      previousAt = version.updatedAt
    }
    return sameDelegationPolicy(row.versions.at(-1) as DelegationPolicyVersion, current)
  })
}

/** A retirement proves absence. Never admit a receipt alongside its live grant,
 * duplicate identities, or a partial authority stamp that could counterfeit it. */
export function validDelegationRetirements(value: unknown, active: readonly StoredDelegation[] = []): boolean {
  if (!Array.isArray(value)) return false
  const ids = new Set(active.map((row) => row.id))
  const receipts = new Set<string>()
  return value.every((row) => {
    if (!record(row) || Object.keys(row).some((key) => !['delegationId', 'projectId', 'createdAt', 'revocationId', 'revokedByTenant', 'expectedCreatedAt', 'expectedRevision'].includes(key)) ||
        typeof row.delegationId !== 'string' || !row.delegationId || ids.has(row.delegationId) ||
        typeof row.projectId !== 'string' || !row.projectId || !timestamp(row.createdAt)) return false
    ids.add(row.delegationId)
    if (row.revocationId === undefined) {
      return !['revokedByTenant', 'expectedCreatedAt', 'expectedRevision'].some((key) => Object.hasOwn(row, key))
    }
    if (typeof row.revocationId !== 'string' || !isDelegationRevocationId(row.revocationId) || receipts.has(row.revocationId) ||
        typeof row.revokedByTenant !== 'string' || !row.revokedByTenant ||
        (Object.hasOwn(row, 'expectedCreatedAt') && (!timestamp(row.expectedCreatedAt) || row.expectedCreatedAt !== row.createdAt)) ||
        (Object.hasOwn(row, 'expectedRevision') && (!Number.isSafeInteger(row.expectedRevision) || (row.expectedRevision as number) < 0))) return false
    receipts.add(row.revocationId)
    return true
  })
}
