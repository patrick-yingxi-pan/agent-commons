import type { LocalGitConnection } from '../../contract/localGitCapture.ts'

export interface LocalGitConnectionState {
  rows: readonly LocalGitConnection[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  busy: boolean
  error: string | null
}

export function createLocalGitConnections(deps: {
  list(): Promise<LocalGitConnection[]>
  connect(remember: boolean): Promise<LocalGitConnection | null>
  disconnect(id: string): Promise<void>
}) {
  const empty = (): LocalGitConnectionState => ({ rows: [], status: 'idle', busy: false, error: null })
  let state = empty()
  let epoch = 0
  let read: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const publish = (next: LocalGitConnectionState) => { state = next; for (const listener of listeners) listener() }
  const reload = (): Promise<void> => {
    if (state.busy) return Promise.resolve()
    if (read) return read
    const issued = ++epoch
    publish({ ...state, status: 'loading', error: null })
    read = deps.list().then(rows => {
      if (issued === epoch) publish({ rows, status: 'ready', busy: false, error: null })
    }, () => {
      if (issued === epoch) publish({ ...state, status: 'error', error: 'Could not check repository connections. Check again before attaching or changing access.' })
    }).finally(() => { if (issued === epoch) read = undefined })
    return read
  }
  const change = async (act: () => Promise<LocalGitConnection | null | void>, removing?: string): Promise<LocalGitConnection | null> => {
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
