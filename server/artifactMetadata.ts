import { normalizeArtifactName, type ArtifactMetadata } from '../contract/artifactMetadata.ts'

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Validate the additive persisted id → metadata entries without accepting malformed state. */
export function parseArtifactMetadataEntries(value: unknown): Array<[string, ArtifactMetadata]> {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError('artifact metadata must be an entry array')
  const seen = new Set<string>()
  const result: Array<[string, ArtifactMetadata]> = []
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new TypeError('artifact metadata entry must be a pair')
    const [key, raw] = entry
    if (typeof key !== 'string' || key.length === 0 || key.trim() !== key || seen.has(key)) {
      throw new TypeError('artifact metadata key is invalid or duplicated')
    }
    if (!isRecord(raw)) throw new TypeError('artifact metadata value must be an object')
    const keys = Object.keys(raw).sort()
    if (keys.length !== 3 || keys[0] !== 'editedAt' || keys[1] !== 'name' || keys[2] !== 'revision') {
      throw new TypeError('artifact metadata value has unexpected keys')
    }
    if (!hasOwn(raw, 'name') || !hasOwn(raw, 'revision') || !hasOwn(raw, 'editedAt')) {
      throw new TypeError('artifact metadata value is incomplete')
    }
    const name = normalizeArtifactName(raw.name)
    if (name === undefined || name !== raw.name) throw new TypeError('artifact metadata name is invalid')
    const revision = raw.revision
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
      throw new TypeError('artifact metadata revision is invalid')
    }
    const editedAt = raw.editedAt
    if (typeof editedAt !== 'number' || !Number.isSafeInteger(editedAt) || editedAt < 0) {
      throw new TypeError('artifact metadata timestamp is invalid')
    }
    seen.add(key)
    result.push([key, { name, revision, editedAt }])
  }
  return result
}
