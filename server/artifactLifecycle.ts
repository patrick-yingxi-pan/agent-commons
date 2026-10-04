import type { ArtifactLifecycle } from '../contract/artifactLifecycle.ts'

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Validate the additive persisted artifact-id → lifecycle entries. */
export function parseArtifactLifecycleEntries(value: unknown): Array<[string, ArtifactLifecycle]> {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError('artifact lifecycle must be an entry array')
  const seen = new Set<string>()
  const result: Array<[string, ArtifactLifecycle]> = []
  for (const entry of value) {
    if (!Array.isArray(entry) || Object.getPrototypeOf(entry) !== Array.prototype ||
      entry.length !== 2 || Object.keys(entry).length !== 2 || !Object.hasOwn(entry, '0') || !Object.hasOwn(entry, '1')) {
      throw new TypeError('artifact lifecycle entry must be an exact pair')
    }
    const [key, raw] = entry
    if (typeof key !== 'string' || key.length === 0 || key.trim() !== key || seen.has(key)) {
      throw new TypeError('artifact lifecycle key is invalid or duplicated')
    }
    if (!isRecord(raw)) throw new TypeError('artifact lifecycle value must be an object')
    const keys = Object.keys(raw).sort()
    if (keys.length !== 3 || keys[0] !== 'changedAt' || keys[1] !== 'revision' || keys[2] !== 'state') {
      throw new TypeError('artifact lifecycle value has unexpected keys')
    }
    if (!hasOwn(raw, 'state') || !hasOwn(raw, 'revision') || !hasOwn(raw, 'changedAt')) {
      throw new TypeError('artifact lifecycle value is incomplete')
    }
    if (raw.state !== 'active' && raw.state !== 'trashed') {
      throw new TypeError('artifact lifecycle state is invalid')
    }
    const revision = raw.revision
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0 ||
      (raw.state === 'active' ? revision % 2 !== 0 : revision % 2 !== 1)) {
      throw new TypeError('artifact lifecycle revision is invalid')
    }
    const changedAt = raw.changedAt
    if (typeof changedAt !== 'number' || !Number.isSafeInteger(changedAt) || changedAt < 0) {
      throw new TypeError('artifact lifecycle timestamp is invalid')
    }
    seen.add(key)
    result.push([key, { state: raw.state, revision, changedAt }])
  }
  return result
}
