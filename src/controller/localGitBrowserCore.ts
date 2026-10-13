import type { LocalGitFileListing, LocalGitFilePreview } from '../../contract/localGitBrowse.mjs'

export type LocalGitBrowseEntry = LocalGitFileListing['files'][number]
export type LocalGitBrowseListing = LocalGitFileListing
export type LocalGitBrowsePreview = LocalGitFilePreview
export interface LocalGitBrowserState {
  listingStatus: 'idle' | 'loading' | 'ready' | 'error'
  listing: LocalGitBrowseListing | null
  listingReadAt: number | null
  listingError: string | null
  selectedPath: string | null
  previewStatus: 'idle' | 'loading' | 'ready' | 'error'
  preview: LocalGitBrowsePreview | null
  previewReadAt: number | null
  previewError: string | null
  /** Ephemeral per-success identity; contains no path or preview bytes. */
  previewReceipt: number | null
  pending: boolean
}

const IDLE: LocalGitBrowserState = Object.freeze({
  listingStatus: 'idle', listing: null, listingReadAt: null, listingError: null,
  selectedPath: null, previewStatus: 'idle', preview: null, previewReadAt: null,
  previewError: null, previewReceipt: null, pending: false,
})

interface PendingRead { epoch: number; version: number; key: string; promise: Promise<unknown> }

/** Explicit local Git browsing state. Results are shared in memory by panes,
 * invalidated on account change/disconnect, and never enter browser storage. */
export function createLocalGitBrowserCore(deps: {
  list(id: string): Promise<LocalGitBrowseListing>
  preview(id: string, path: string): Promise<LocalGitBrowsePreview>
  now(): number
}) {
  const states = new Map<string, LocalGitBrowserState>()
  const versions = new Map<string, number>()
  const pending = new Map<string, Set<PendingRead>>()
  const listeners = new Map<string, Set<() => void>>()
  let epoch = 0
  let nextReceipt = 0
  const get = (id: string): LocalGitBrowserState => states.get(id) ?? IDLE
  const publish = (id: string, state: LocalGitBrowserState) => {
    if (state === IDLE) states.delete(id); else states.set(id, state)
    for (const listener of listeners.get(id) ?? []) listener()
  }
  const versionOf = (id: string) => versions.get(id) ?? 0
  const occupied = (id: string) => [...(pending.get(id) ?? [])].some(item => item.epoch === epoch)
  const current = (id: string, request: PendingRead) => request.epoch === epoch && request.version === versionOf(id)
  const begin = <T>(id: string, key: string, task: () => Promise<T>, onStart: (state: LocalGitBrowserState) => LocalGitBrowserState,
    onSuccess: (state: LocalGitBrowserState, value: T) => LocalGitBrowserState,
    onFailure: (state: LocalGitBrowserState) => LocalGitBrowserState): Promise<T | null> => {
    if (occupied(id)) {
      const same = [...(pending.get(id) ?? [])].find(item => item.epoch === epoch && item.key === key)
      return same ? same.promise as Promise<T | null> : Promise.resolve(null)
    }
    const request = { epoch, version: versionOf(id), key, promise: Promise.resolve(null) as Promise<unknown> }
    publish(id, onStart(get(id)))
    const promise = Promise.resolve().then(task).then(value => {
      if (!current(id, request)) return null
      publish(id, onSuccess(get(id), structuredClone(value)))
      return structuredClone(value)
    }).catch(() => {
      if (current(id, request)) publish(id, onFailure(get(id)))
      return null
    }).finally(() => {
      const reads = pending.get(id); reads?.delete(request)
      if (!reads?.size) pending.delete(id)
      if (request.epoch === epoch && !occupied(id) && get(id).pending) publish(id, { ...get(id), pending: false })
      if (!pending.has(id)) versions.delete(id)
    })
    request.promise = promise
    const reads = pending.get(id) ?? new Set<PendingRead>(); reads.add(request); pending.set(id, reads)
    return promise
  }
  const readListing = (id: string) => begin(id, 'listing', () => deps.list(id),
    state => ({ ...state, listingStatus: 'loading', listing: null, listingReadAt: null, listingError: null,
      selectedPath: null, previewStatus: 'idle', preview: null, previewReadAt: null, previewError: null, previewReceipt: null, pending: true }),
    (state, listing) => ({ ...state, listingStatus: 'ready', listing, listingReadAt: deps.now(), listingError: null, pending: false }),
    state => ({ ...state, listingStatus: 'error', listing: null, listingReadAt: null,
      listingError: 'Could not list tracked repository paths. Check the connection and try again.', selectedPath: null,
      previewStatus: 'idle', preview: null, previewReadAt: null, previewError: null, previewReceipt: null, pending: false }))
  const readPreview = (id: string, path: string) => {
    const state = get(id)
    if (state.listingStatus !== 'ready' || !state.listing?.files.some(file => file.path === path)) return Promise.resolve(null)
    return begin(id, `preview:${path}`, () => deps.preview(id, path),
      currentState => ({ ...currentState, selectedPath: path, previewStatus: 'loading', preview: null,
        previewReadAt: null, previewError: null, previewReceipt: null, pending: true }),
      (currentState, preview) => ({ ...currentState, selectedPath: path, previewStatus: 'ready', preview,
        previewReadAt: deps.now(), previewError: null, previewReceipt: ++nextReceipt, pending: false }),
      currentState => ({ ...currentState, selectedPath: path, previewStatus: 'error', preview: null,
        previewReadAt: null, previewError: 'Could not read this file. Check the connection and try again.', previewReceipt: null, pending: false }))
  }
  const dismiss = (id: string) => {
    const hasPending = occupied(id)
    if (hasPending) versions.set(id, versionOf(id) + 1)
    if (get(id) !== IDLE || hasPending) publish(id, hasPending ? { ...IDLE, pending: true } : IDLE)
  }
  const retain = (ids: readonly string[]) => {
    const retained = new Set(ids)
    for (const id of new Set([...states.keys(), ...pending.keys()])) if (!retained.has(id)) dismiss(id)
  }
  const clear = () => {
    epoch += 1
    const ids = new Set([...states.keys(), ...listeners.keys()])
    states.clear(); versions.clear()
    for (const id of ids) for (const listener of listeners.get(id) ?? []) listener()
  }
  return {
    get,
    subscribe: (id: string, listener: () => void) => {
      const set = listeners.get(id) ?? new Set<() => void>(); set.add(listener); listeners.set(id, set)
      return () => { set.delete(listener); if (!set.size) listeners.delete(id) }
    },
    readListing, readPreview, dismiss, retain, clear,
  }
}
