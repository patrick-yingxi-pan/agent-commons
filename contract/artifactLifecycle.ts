import type { ArtifactItem } from './cowork.ts'

export type ArtifactLifecycleState = 'active' | 'trashed'

/** Durable lifecycle ordering is independent of body and display metadata. */
export interface ArtifactLifecycle {
  state: ArtifactLifecycleState
  revision: number
  changedAt: number
}

/** Owner-only Trash projection. It deliberately carries the canonical Artifact row. */
export interface TrashedArtifact {
  artifact: ArtifactItem
  trashedAt: number
}

export type ArtifactLifecycleTransitionResult =
  | { kind: 'changed'; value: ArtifactLifecycle }
  | { kind: 'replayed'; value: ArtifactLifecycle }
  | { kind: 'conflict' }
  | { kind: 'invalid' }

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isTimestamp = isRevision

function validLifecycle(value: unknown): value is ArtifactLifecycle {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  if (keys.length !== 3 || keys[0] !== 'changedAt' || keys[1] !== 'revision' || keys[2] !== 'state') return false
  if (!Object.hasOwn(value, 'state') || !Object.hasOwn(value, 'revision') || !Object.hasOwn(value, 'changedAt')) return false
  if (value.state !== 'active' && value.state !== 'trashed') return false
  if (!isRevision(value.revision) || !isTimestamp(value.changedAt)) return false
  if (value.state === 'active') return value.revision === 0 || value.revision % 2 === 0
  return value.revision > 0 && value.revision % 2 === 1
}

/** Apply a compare-and-swap lifecycle transition, admitting only its exact lost-ack retry. */
export function nextArtifactLifecycle(
  current: ArtifactLifecycle | undefined,
  target: ArtifactLifecycleState,
  expectedRevision: number,
  now: number,
): ArtifactLifecycleTransitionResult {
  if ((current !== undefined && !validLifecycle(current)) ||
    (target !== 'active' && target !== 'trashed') ||
    !isRevision(expectedRevision) || !isTimestamp(now)) return { kind: 'invalid' }

  const prior: ArtifactLifecycle = current === undefined
    ? { state: 'active', revision: 0, changedAt: 0 }
    : { state: current.state, revision: current.revision, changedAt: current.changedAt }
  const retryRevision = expectedRevision + 1

  if (prior.state === target) {
    if (Number.isSafeInteger(retryRevision) && prior.revision === retryRevision) {
      return { kind: 'replayed', value: { ...prior } }
    }
    return { kind: 'conflict' }
  }
  if (prior.revision !== expectedRevision || prior.revision === Number.MAX_SAFE_INTEGER) {
    return { kind: 'conflict' }
  }

  return {
    kind: 'changed',
    value: { state: target, revision: prior.revision + 1, changedAt: now },
  }
}
