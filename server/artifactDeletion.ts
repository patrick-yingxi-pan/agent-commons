export interface ArtifactRetirement {
  artifactId: string
  tenantId: string
  /** Hash of the canonical tenant + immutable save origin; names/source stay private. */
  saveOriginHash?: string
  /** A standing output binding is retired with its Artifact and may not remint it. */
  sourceScheduleId?: string
  /** Opaque IDs only: preserve enough identity to reject dangling social refs. */
  discussionIds?: string[]
  proposalIds?: string[]
}

export interface StoredArtifactDeletionReceipt {
  tenantId: string
  userId: string
  artifactId: string
  keyHash: string
  expectedLifecycleRevision: number
  reviewTokenHash: string
}

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exact(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
}

export function parseArtifactRetirements(value: unknown): ArtifactRetirement[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError('Artifact retirements must be an array.')
  const ids = new Set<string>()
  return value.map((raw) => {
    if (!record(raw) || !exact(raw, ['artifactId', 'tenantId'], ['saveOriginHash', 'sourceScheduleId', 'discussionIds', 'proposalIds']) ||
      typeof raw.artifactId !== 'string' || !raw.artifactId || raw.artifactId.trim() !== raw.artifactId || ids.has(raw.artifactId) ||
      typeof raw.tenantId !== 'string' || !raw.tenantId || raw.tenantId.trim() !== raw.tenantId) {
      throw new TypeError('Artifact retirement is malformed or duplicated.')
    }
    ids.add(raw.artifactId)
    let saveOriginHash: string | undefined
    if (Object.hasOwn(raw, 'saveOriginHash')) {
      if (typeof raw.saveOriginHash !== 'string' || !/^[0-9a-f]{64}$/.test(raw.saveOriginHash)) throw new TypeError('Artifact retirement save origin is malformed.')
      saveOriginHash = raw.saveOriginHash
    }
    let sourceScheduleId: string | undefined
    if (Object.hasOwn(raw, 'sourceScheduleId')) {
      if (typeof raw.sourceScheduleId !== 'string' || !raw.sourceScheduleId || raw.sourceScheduleId.trim() !== raw.sourceScheduleId) {
        throw new TypeError('Artifact retirement routine binding is malformed.')
      }
      sourceScheduleId = raw.sourceScheduleId
    }
    const parseIds = (key: 'discussionIds' | 'proposalIds'): string[] | undefined => {
      if (!Object.hasOwn(raw, key)) return undefined
      const values = raw[key]
      if (!Array.isArray(values) || values.some((id) =>
        typeof id !== 'string' || !id || id.trim() !== id || id.length > 240)) {
        throw new TypeError(`Artifact retirement ${key} are malformed.`)
      }
      for (let index = 1; index < values.length; index += 1) {
        if (values[index - 1] >= values[index]) throw new TypeError(`Artifact retirement ${key} must be unique and sorted.`)
      }
      return values as string[]
    }
    const discussionIds = parseIds('discussionIds')
    const proposalIds = parseIds('proposalIds')
    return {
      artifactId: raw.artifactId,
      tenantId: raw.tenantId,
      ...(saveOriginHash ? { saveOriginHash } : {}),
      ...(sourceScheduleId ? { sourceScheduleId } : {}),
      ...(discussionIds === undefined ? {} : { discussionIds }),
      ...(proposalIds === undefined ? {} : { proposalIds }),
    }
  })
}

export function parseArtifactDeletionReceipts(value: unknown): Array<[string, StoredArtifactDeletionReceipt]> {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError('Artifact deletion receipts must be an entry array.')
  const keys = new Set<string>()
  return value.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !entry[0] || keys.has(entry[0]) || !record(entry[1])) {
      throw new TypeError('Artifact deletion receipt entry is malformed or duplicated.')
    }
    const [storageKey, raw] = entry as [string, Record<string, unknown>]
    if (!exact(raw, ['tenantId', 'userId', 'artifactId', 'keyHash', 'expectedLifecycleRevision', 'reviewTokenHash']) ||
      typeof raw.tenantId !== 'string' || !raw.tenantId || typeof raw.userId !== 'string' || !raw.userId ||
      typeof raw.artifactId !== 'string' || !raw.artifactId ||
      typeof raw.keyHash !== 'string' || !/^[0-9a-f]{64}$/.test(raw.keyHash) ||
      !Number.isSafeInteger(raw.expectedLifecycleRevision) || (raw.expectedLifecycleRevision as number) < 0 ||
      typeof raw.reviewTokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(raw.reviewTokenHash)) {
      throw new TypeError('Artifact deletion receipt is malformed.')
    }
    const receipt: StoredArtifactDeletionReceipt = {
      tenantId: raw.tenantId,
      userId: raw.userId,
      artifactId: raw.artifactId,
      keyHash: raw.keyHash,
      expectedLifecycleRevision: raw.expectedLifecycleRevision as number,
      reviewTokenHash: raw.reviewTokenHash,
    }
    if (storageKey !== JSON.stringify([receipt.tenantId, receipt.userId, receipt.keyHash])) {
      throw new TypeError('Artifact deletion receipt principal key is inconsistent.')
    }
    keys.add(storageKey)
    return [storageKey, receipt]
  })
}
