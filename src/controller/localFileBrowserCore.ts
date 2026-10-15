export interface LocalFileBrowserState<Listing, Preview> {
  listingStatus: 'idle' | 'loading' | 'ready' | 'error'
  listing: Listing | null
  listingReadAt: number | null
  listingError: string | null
  selectedPath: string | null
  previewStatus: 'idle' | 'loading' | 'ready' | 'error'
  preview: Preview | null
  previewReadAt: number | null
  previewError: string | null
  /** Per-success identity only; no path or preview bytes. */
  previewReceipt: number | null
  processingStatus: 'idle' | 'loading' | 'error'
  processingError: string | null
  pending: boolean
}
export type LocalPreviewProcessingResult<Preview> =
  { status: 'ready'; preview: Preview } | { status: 'error'; message: string } | { status: 'cancelled' }
export type LocalPreviewProcessor<Preview> = (preview: Preview, signal: AbortSignal) => Promise<LocalPreviewProcessingResult<Preview>>
interface PendingRead { epoch: number; version: number; key: string; promise: Promise<unknown>; controller: AbortController }

const makeIdle = <L, P>(): LocalFileBrowserState<L, P> => Object.freeze({
  listingStatus: 'idle', listing: null, listingReadAt: null, listingError: null,
  selectedPath: null, previewStatus: 'idle', preview: null, previewReadAt: null,
  previewError: null, previewReceipt: null, processingStatus: 'idle', processingError: null, pending: false,
})

/** Shared bounded browser state machine. Source-specific API validators and UI
 * wrappers supply their typed payloads, entry admission, and safe status copy. */
export function createLocalFileBrowserCore<
  Listing extends { files: Array<{ path: string; kind: string }> },
  Preview extends { path: string },
>(deps: {
  list(id: string, signal: AbortSignal): Promise<Listing>
  preview(id: string, path: string, signal: AbortSignal): Promise<Preview>
  processPreview?: LocalPreviewProcessor<Preview>
  now(): number
  isPreviewable(kind: string): boolean
  listingError: string
  previewError: string
}) {
  type State = LocalFileBrowserState<Listing, Preview>
  const IDLE = makeIdle<Listing, Preview>()
  const states = new Map<string, State>()
  const versions = new Map<string, number>()
  const pending = new Map<string, Set<PendingRead>>()
  const listeners = new Map<string, Set<() => void>>()
  let epoch = 0
  let nextReceipt = 0
  const get = (id: string): State => states.get(id) ?? IDLE
  const publish = (id: string, state: State) => {
    if (state === IDLE) states.delete(id); else states.set(id, state)
    for (const listener of listeners.get(id) ?? []) listener()
  }
  const versionOf = (id: string) => versions.get(id) ?? 0
  const occupied = (id: string) => [...(pending.get(id) ?? [])].some(item => item.epoch === epoch)
  const current = (id: string, request: PendingRead) => !request.controller.signal.aborted && request.epoch === epoch && request.version === versionOf(id)
  const begin = <T>(id: string, key: string, task: (signal: AbortSignal) => Promise<T>, onStart: (state: State) => State,
    onSuccess: (state: State, value: T) => State,
    onFailure: (state: State) => State): Promise<T | null> => {
    if (occupied(id)) {
      const same = [...(pending.get(id) ?? [])].find(item => item.epoch === epoch && item.key === key)
      return same ? same.promise as Promise<T | null> : Promise.resolve(null)
    }
    const request: PendingRead = { epoch, version: versionOf(id), key, promise: Promise.resolve(null), controller: new AbortController() }
    const promise = Promise.resolve().then(() => {
      request.controller.signal.throwIfAborted()
      return task(request.controller.signal)
    }).then(value => {
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
    // Subscribers can synchronously dismiss or start a competing action. The
    // operation must own its slot before announcing the pending state.
    publish(id, onStart(get(id)))
    return promise
  }
  const readListing = (id: string) => begin(id, 'listing', signal => deps.list(id, signal),
    state => ({ ...state, listingStatus: 'loading', listing: null, listingReadAt: null, listingError: null,
      selectedPath: null, previewStatus: 'idle', preview: null, previewReadAt: null, previewError: null, previewReceipt: null,
      processingStatus: 'idle', processingError: null, pending: true }),
    (state, listing) => ({ ...state, listingStatus: 'ready', listing, listingReadAt: deps.now(), listingError: null, pending: false }),
    state => ({ ...state, listingStatus: 'error', listing: null, listingReadAt: null, listingError: deps.listingError,
      selectedPath: null, previewStatus: 'idle', preview: null, previewReadAt: null, previewError: null, previewReceipt: null,
      processingStatus: 'idle', processingError: null, pending: false }))
  const readPreview = (id: string, path: string) => {
    const state = get(id)
    const entry = state.listing?.files.find(file => file.path === path)
    if (state.listingStatus !== 'ready' || !entry || !deps.isPreviewable(entry.kind)) return Promise.resolve(null)
    return begin(id, `preview:${path}`, signal => deps.preview(id, path, signal),
      currentState => ({ ...currentState, selectedPath: path, previewStatus: 'loading', preview: null,
        previewReadAt: null, previewError: null, previewReceipt: null, processingStatus: 'idle', processingError: null, pending: true }),
      (currentState, preview) => ({ ...currentState, selectedPath: path, previewStatus: 'ready', preview,
        previewReadAt: deps.now(), previewError: null, previewReceipt: ++nextReceipt, pending: false }),
      currentState => ({ ...currentState, selectedPath: path, previewStatus: 'error', preview: null,
        previewReadAt: null, previewError: deps.previewError, previewReceipt: null, pending: false }))
  }
  const processingFailure = (state: State): State => ({ ...state, processingStatus: 'error',
    processingError: 'Could not process this preview. The previous preview is unchanged; try again.', pending: false })
  const processPreview = (id: string, receipt: number) => {
    const state = get(id)
    const processor = deps.processPreview
    if (!processor || state.previewStatus !== 'ready' || !state.preview || state.previewReceipt !== receipt) return Promise.resolve(null)
    const preview = state.preview
    return begin(id, `process:${receipt}`, signal => processor(structuredClone(preview), signal),
      currentState => ({ ...currentState, processingStatus: 'loading', processingError: null, pending: true }),
      (currentState, result) => {
        if (result.status === 'cancelled') return { ...currentState, processingStatus: 'idle', processingError: null, pending: false }
        if (result.status === 'error') return { ...currentState, processingStatus: 'error', processingError: result.message, pending: false }
        if (result.status !== 'ready' || result.preview.path !== preview.path) return processingFailure(currentState)
        return { ...currentState, preview: result.preview, previewReceipt: ++nextReceipt,
          processingStatus: 'idle', processingError: null, pending: false }
      }, processingFailure)
  }
  const cancelProcessing = (id: string) => {
    const requests = [...(pending.get(id) ?? [])].filter(request => request.epoch === epoch && request.key.startsWith('process:'))
    if (!requests.length) return
    versions.set(id, versionOf(id) + 1)
    for (const request of requests) request.controller.abort()
    publish(id, { ...get(id), processingStatus: 'idle', processingError: null, pending: true })
  }
  const dismiss = (id: string) => {
    const hasPending = occupied(id)
    if (hasPending) versions.set(id, versionOf(id) + 1)
    for (const request of pending.get(id) ?? []) request.controller.abort()
    if (get(id) !== IDLE || hasPending) publish(id, hasPending ? { ...IDLE, pending: true } : IDLE)
  }
  const retain = (ids: readonly string[]) => {
    const retained = new Set(ids)
    for (const id of new Set([...states.keys(), ...pending.keys()])) if (!retained.has(id)) dismiss(id)
  }
  const clear = () => {
    epoch += 1
    for (const reads of pending.values()) for (const request of reads) request.controller.abort()
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
    readListing, readPreview, processPreview, cancelProcessing, dismiss, retain, clear,
  }
}
