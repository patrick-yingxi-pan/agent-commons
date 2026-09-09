import { normalizeArtifactName } from './artifactMetadata.ts'

/** Authored body kinds a standing routine may deliver. */
export type ScheduledArtifactKind = 'doc' | 'sheet' | 'slide'

export interface ScheduledArtifactSpec {
  name: string
  kind: ScheduledArtifactKind
}

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Strict wire/storage canonicalizer. A historical string has the one declared
 * meaning Document; explicit objects are closed and never infer kind from name. */
export function parseScheduledArtifactSpec(value: unknown): ScheduledArtifactSpec | undefined {
  if (typeof value === 'string') {
    const name = normalizeArtifactName(value)
    return name === value ? { name, kind: 'doc' } : undefined
  }
  if (!record(value) || Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'name') || !Object.hasOwn(value, 'kind')) return undefined
  const name = normalizeArtifactName(value.name)
  const kind = value.kind
  if (name === undefined || name !== value.name || (kind !== 'doc' && kind !== 'sheet' && kind !== 'slide')) return undefined
  return { name, kind }
}
