import type { LocalGitFileComparison } from '../../contract/localGitFileComparison.mjs'
import type { GitComparison } from '../lib/localGitReview.ts'

export interface LocalGitFileComparisonState {
  draftPath: string
  comparison: GitComparison
  status: 'idle' | 'loading' | 'ready' | 'error'
  result: LocalGitFileComparison | null
  readAt: number | null
  error: string | null
  pending: boolean
}

const EMPTY = (draftPath = '', comparison: GitComparison = 'staged'): LocalGitFileComparisonState => ({
  draftPath, comparison, status: 'idle', result: null, readAt: null, error: null, pending: false,
})
const IDLE: LocalGitFileComparisonState = Object.freeze(EMPTY())
const FAILURE = 'Could not compare this file. Check the connection and try again.'

interface PendingRead {
  epoch: number
  version: number
  path: string
  comparison: GitComparison
  controller: AbortController
  promise: Promise<LocalGitFileComparison | null>
}

/** Account-scoped captured one-file comparisons. Draft edits invalidate the
 * exact result immediately; only an explicit read obtains new source data. */
export function createLocalGitFileComparisonsCore(deps: {
  read(id: string, selection: { path: string; comparison: GitComparison }, signal: AbortSignal): Promise<LocalGitFileComparison>
  now(): number
}) {
  const states = new Map<string, LocalGitFileComparisonState>()
  const versions = new Map<string, number>()
  const pending = new Map<string, PendingRead>()
  const listeners = new Map<string, Set<() => void>>()
  let epoch = 0

  const publish = (id: string, state: LocalGitFileComparisonState): void => {
    if (state === IDLE) states.delete(id)
    else states.set(id, state)
    for (const listener of listeners.get(id) ?? []) listener()
  }
  const get = (id: string): LocalGitFileComparisonState => states.get(id) ?? IDLE
  const versionOf = (id: string): number => versions.get(id) ?? 0
  const isCurrent = (id: string, request: PendingRead): boolean =>
    request.epoch === epoch && request.version === versionOf(id) && pending.get(id) === request && !request.controller.signal.aborted

  const invalidate = (id: string): void => {
    versions.set(id, versionOf(id) + 1)
    const request = pending.get(id)
    if (request) {
      pending.delete(id)
      request.controller.abort()
    }
  }
  const reset = (id: string, preserveDraft: boolean): void => {
    invalidate(id)
    const current = get(id)
    const next = preserveDraft ? EMPTY(current.draftPath, current.comparison) : IDLE
    if (current.status !== 'idle' || current.pending || current.result || current.draftPath !== next.draftPath || current.comparison !== next.comparison) publish(id, next)
  }

  const setDraftPath = (id: string, draftPath: string): void => {
    if (typeof draftPath !== 'string') return
    const current = get(id)
    if (current.draftPath === draftPath) return
    invalidate(id)
    publish(id, { ...EMPTY(draftPath, current.comparison) })
  }

  const setComparison = (id: string, comparison: GitComparison): void => {
    if (comparison !== 'staged' && comparison !== 'unstaged') return
    const current = get(id)
    if (current.comparison === comparison) return
    invalidate(id)
    publish(id, { ...EMPTY(current.draftPath, comparison) })
  }

  const read = (id: string): Promise<LocalGitFileComparison | null> => {
    const current = get(id)
    const path = current.draftPath
    const comparison = current.comparison
    if (!path.length) {
      publish(id, { ...EMPTY(path, comparison), status: 'error', error: 'Enter a repository-relative path to compare.' })
      return Promise.resolve(null)
    }
    const active = pending.get(id)
    if (active && active.epoch === epoch && active.path === path && active.comparison === comparison) return active.promise

    invalidate(id)
    const requestEpoch = epoch
    const requestVersion = versionOf(id)
    const controller = new AbortController()
    const request = { epoch: requestEpoch, version: requestVersion, path, comparison, controller, promise: Promise.resolve(null) } as PendingRead
    publish(id, { ...EMPTY(path, comparison), status: 'loading', pending: true })
    const promise = Promise.resolve().then(() => deps.read(id, { path, comparison }, controller.signal)).then(result => {
      if (!isCurrent(id, request)) return null
      if (!result || result.scope !== 'file-comparison' || result.path !== path || result.comparison !== comparison) throw new Error('The repository returned a mismatched comparison.')
      const captured = structuredClone(result)
      publish(id, { draftPath: path, comparison, status: 'ready', result: captured, readAt: deps.now(), error: null, pending: false })
      return captured
    }).catch(() => {
      if (isCurrent(id, request)) publish(id, { ...EMPTY(path, comparison), status: 'error', error: FAILURE })
      return null
    }).finally(() => {
      if (pending.get(id) === request) pending.delete(id)
      if (request.epoch === epoch && !pending.has(id)) versions.delete(id)
    })
    request.promise = promise
    pending.set(id, request)
    return promise
  }

  const subscribe = (id: string, listener: () => void): (() => void) => {
    const subscribers = listeners.get(id) ?? new Set<() => void>()
    subscribers.add(listener)
    listeners.set(id, subscribers)
    return () => {
      subscribers.delete(listener)
      if (!subscribers.size) listeners.delete(id)
    }
  }

  const clear = (): void => {
    epoch += 1
    for (const request of pending.values()) request.controller.abort()
    pending.clear()
    const ids = new Set([...states.keys(), ...listeners.keys()])
    states.clear()
    versions.clear()
    for (const id of ids) for (const listener of listeners.get(id) ?? []) listener()
  }

  return {
    get,
    subscribe,
    setDraftPath,
    setComparison,
    read,
    dismiss: (id: string) => reset(id, true),
    retain: (ids: readonly string[]) => {
      const retained = new Set(ids)
      for (const id of new Set([...states.keys(), ...pending.keys()])) if (!retained.has(id)) reset(id, false)
    },
    clear,
  }
}
