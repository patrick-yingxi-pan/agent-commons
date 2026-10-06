import type { LocalGitReview } from '../../contract/localGitReview.mjs'

export type LocalGitReviewComparison = 'staged' | 'unstaged'

export interface LocalGitReviewState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  result: LocalGitReview | null
  readAt: number | null
  error: string | null
  comparison: LocalGitReviewComparison
  path: string | null
  pending: boolean
}

const IDLE: LocalGitReviewState = Object.freeze({
  status: 'idle', result: null, readAt: null, error: null, comparison: 'staged', path: null, pending: false,
})
const FAILURE = 'Could not read this repository review. Check the connection and try again.'

interface PendingRead {
  epoch: number
  version: number
  promise: Promise<LocalGitReview | null>
}

function selectablePaths(result: LocalGitReview, comparison: LocalGitReviewComparison): string[] {
  return result.files.filter(file => file[comparison] !== 'unchanged').map(file => file.path)
}

function normalizedSelection(result: LocalGitReview, comparison: LocalGitReviewComparison, path: string | null): string | null {
  const paths = selectablePaths(result, comparison)
  return path && paths.includes(path) ? path : paths[0] ?? null
}

/** Account-scoped, memory-only explicit review state shared by panes. */
export function createLocalGitReviewsCore(deps: {
  read(id: string): Promise<LocalGitReview>
  now(): number
}) {
  const states = new Map<string, LocalGitReviewState>()
  const versions = new Map<string, number>()
  const pending = new Map<string, Set<PendingRead>>()
  const listeners = new Map<string, Set<() => void>>()
  let epoch = 0

  const publish = (id: string, state: LocalGitReviewState): void => {
    if (state === IDLE) states.delete(id)
    else states.set(id, state)
    for (const listener of listeners.get(id) ?? []) listener()
  }
  const get = (id: string): LocalGitReviewState => states.get(id) ?? IDLE
  const versionOf = (id: string): number => versions.get(id) ?? 0
  const isCurrent = (id: string, request: PendingRead): boolean =>
    request.epoch === epoch && request.version === versionOf(id)

  const read = (id: string): Promise<LocalGitReview | null> => {
    const requestEpoch = epoch
    const requestVersion = versionOf(id)
    const inFlight = [...(pending.get(id) ?? [])].find(item => item.epoch === requestEpoch)
    if (inFlight) return inFlight.promise

    const current = get(id)
    publish(id, { ...current, status: 'loading', result: null, readAt: null, error: null, pending: true })
    const request = { epoch: requestEpoch, version: requestVersion, promise: Promise.resolve(null) } as PendingRead
    const promise = Promise.resolve().then(() => deps.read(id)).then(result => {
      if (!isCurrent(id, request)) return null
      const comparison = get(id).comparison
      const selectedPath = normalizedSelection(result, comparison, get(id).path)
      publish(id, { status: 'ready', result: structuredClone(result), readAt: deps.now(), error: null,
        comparison, path: selectedPath, pending: false })
      return structuredClone(result)
    }).catch(() => {
      if (isCurrent(id, request)) {
        const previous = get(id)
        publish(id, { ...previous, status: 'error', result: null, readAt: null, error: FAILURE, path: null, pending: false })
      }
      return null
    }).finally(() => {
      const requests = pending.get(id)
      requests?.delete(request)
      if (!requests?.size) pending.delete(id)
      if (request.epoch === epoch && ![...(pending.get(id) ?? [])].some(item => item.epoch === epoch)) {
        const current = get(id)
        if (current.status === 'idle' && current.pending) publish(id, { ...IDLE, pending: false })
      }
      if (!pending.has(id)) versions.delete(id)
    })
    request.promise = promise
    const requests = pending.get(id) ?? new Set<PendingRead>()
    requests.add(request)
    pending.set(id, requests)
    return promise
  }

  const dismiss = (id: string): void => {
    const current = get(id)
    const occupied = [...(pending.get(id) ?? [])].some(item => item.epoch === epoch)
    if (occupied) versions.set(id, versionOf(id) + 1)
    const next = occupied ? { ...IDLE, pending: true } : IDLE
    if (current !== IDLE || occupied) publish(id, next)
  }

  const retain = (ids: readonly string[]): void => {
    const retained = new Set(ids)
    for (const id of new Set([...states.keys(), ...pending.keys()])) {
      if (!retained.has(id)) dismiss(id)
    }
  }

  const clear = (): void => {
    epoch += 1
    const ids = new Set([...states.keys(), ...listeners.keys()])
    states.clear()
    versions.clear()
    for (const id of ids) for (const listener of listeners.get(id) ?? []) listener()
  }

  const select = (id: string, comparison: LocalGitReviewComparison, path: string | null): void => {
    const current = get(id)
    if (current.status !== 'ready' || !current.result || !['staged', 'unstaged'].includes(comparison)) return
    publish(id, { ...current, comparison, path: normalizedSelection(current.result, comparison, path) })
  }

  return {
    get,
    subscribe: (id: string, listener: () => void): (() => void) => {
      const subscribers = listeners.get(id) ?? new Set<() => void>()
      subscribers.add(listener)
      listeners.set(id, subscribers)
      return () => {
        subscribers.delete(listener)
        if (!subscribers.size) listeners.delete(id)
      }
    },
    read,
    dismiss,
    retain,
    clear,
    select,
  }
}
