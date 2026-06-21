/** Read hooks — the UI's window onto server-owned data. Each is a one-liner over
 *  the query cache, so a component swaps a `import { SESSIONS }` for a
 *  `useSessions()` and gains: a real fetch, a loading/error state, and live
 *  updates when the server pushes a change. Hooks grow per resource as reads
 *  migrate; Phase 1 covers capabilities + sessions. */
import { useQuery, type QueryState } from './cache.ts'
import { apiGet } from './client.ts'
import { keys, paths } from './keys.ts'
import type { Capabilities, Session } from '../../contract/index.ts'

/** What this backend can do — the UI gates native-only affordances on this,
 *  never on sniffing Electron vs web. */
export function useCapabilities(): QueryState<Capabilities> {
  return useQuery(keys.capabilities, () => apiGet<Capabilities>(paths.capabilities))
}

/** The session list (lightweight rows) for the sidebar + search. */
export function useSessions(): QueryState<Session[]> {
  return useQuery(keys.sessions, () => apiGet<Session[]>(paths.sessions))
}

/** A full session by id (messages / artifacts / repo included). */
export function useSession(id: string): QueryState<Session> {
  return useQuery(keys.session(id), () => apiGet<Session>(paths.session(id)))
}
