import type { LocalFolderConnection } from '../../contract/localFolderCapture.ts'

export interface LocalFolderConnectionState {
  rows: readonly LocalFolderConnection[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  busy: boolean
  error: string | null
}

/** Native metadata is the sole registry. An uncertain mutation permits only a
 * new authoritative list read, never automatic selection or optimistic removal. */
export function createLocalFolderConnections(deps: {
  list(): Promise<LocalFolderConnection[]>
  connect(remember: boolean): Promise<LocalFolderConnection | null>
  disconnect(id: string): Promise<void>
}) {
  const empty = (): LocalFolderConnectionState => ({ rows: [], status: 'idle', busy: false, error: null })
  let state = empty()
  let epoch = 0
  let read: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const publish = (next: LocalFolderConnectionState) => { state = next; for (const listener of listeners) listener() }
  const reload = (): Promise<void> => {
    if (state.busy) return Promise.resolve()
    if (read) return read
    const issued = ++epoch
    publish({ ...state, status: 'loading', error: null })
    read = deps.list().then(rows => {
      if (issued === epoch) publish({ rows, status: 'ready', busy: false, error: null })
    }, () => {
      if (issued === epoch) publish({ ...state, status: 'error', error: 'Could not check local connections. Check again before attaching or changing access.' })
    }).finally(() => { if (issued === epoch) read = undefined })
    return read
  }
  const change = async (act: () => Promise<LocalFolderConnection | null | void>, removing?: string): Promise<LocalFolderConnection | null> => {
    if (state.busy || state.status !== 'ready') return null
    const issued = ++epoch
    publish({ ...state, busy: true, error: null })
    try {
      const added = await act()
      if (issued !== epoch) return null
      publish({ status: 'ready', busy: false, error: null,
        rows: removing ? state.rows.filter(row => row.id !== removing)
          : added ? [...state.rows.filter(row => row.id !== added.id), added] : state.rows })
      return added ?? null
    } catch {
      if (issued === epoch) publish({ ...state, busy: false, status: 'error', error: 'Could not confirm the access change. Check connections to learn what was saved before trying again. Saved snapshots are unchanged.' })
      return null
    }
  }
  return {
    get: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    reload,
    connect: (remember: boolean) => change(() => deps.connect(remember)),
    disconnect: (id: string) => change(() => deps.disconnect(id), id),
    clear: () => { ++epoch; read = undefined; publish(empty()) },
  }
}
