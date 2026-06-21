/** ── The mock backend's state + event bus ──────────────────────────────────
 *  In-memory, seeded from server/data. In the real product this is a database +
 *  the Anthropic API; here it's plain objects the routes read and mutate, plus a
 *  tiny pub/sub the SSE channels subscribe to. Refresh-resets, like the rest of
 *  the mock — restarting the server reseeds (a new `epoch` tells clients to drop
 *  their cache).
 *
 *  State is added to this store as each resource's reads/commands migrate; Phase 1
 *  carries sessions + the event bus, the spine everything else hangs off. */
import type {
  ArtifactContentLibrary,
  Connector,
  ConnectorDetail,
  DispatchRun,
  SavedContextsSnapshot,
  ScheduleTemplate,
  ServerEvent,
  Session,
} from '../contract/index.ts'
import { SESSIONS, DEMO_SESSION_ID } from './data/sessions.ts'
import { DISPATCH_RUNS, SCHEDULE_TEMPLATES } from './data/cowork.ts'
import { SAVED_CONTEXTS, CONNECTED_CONNECTOR_IDS, CONNECTED_MCP_IDS } from './data/savedContexts.ts'
import { connectorDetail } from './data/connectorDetails.ts'
import { ARTIFACT_CONTENT } from './data/artifactContent.ts'

type Listener = (e: ServerEvent) => void

/** A monotonic-ish boot id. Math.random/Date are fine here (server side, not in
 *  the resumable-workflow sandbox); a fresh value each boot signals a reseed. */
const EPOCH = `e${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

const listeners = new Set<Listener>()

export const store = {
  epoch: EPOCH,

  // ── Event bus ──
  /** Subscribe to the ambient event stream; returns an unsubscribe fn. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  /** Publish a domain event to every open ambient SSE channel. */
  emit(e: ServerEvent): void {
    for (const fn of listeners) {
      try {
        fn(e)
      } catch {
        /* a dead channel shouldn't break the others */
      }
    }
  },

  // ── Sessions ──
  /** The lightweight list rows (no message bodies) for the sidebar/search. */
  listSessions(): Session[] {
    return SESSIONS.map((s) => ({
      id: s.id,
      title: s.title,
      caps: s.caps,
      updatedLabel: s.updatedLabel,
      preview: s.preview,
      isDemo: s.isDemo,
    }))
  },
  /** A full session by id (messages/artifacts/repo included). */
  getSession(id: string): Session | undefined {
    return SESSIONS.find((s) => s.id === id)
  },
  demoSessionId: DEMO_SESSION_ID,

  // ── Dispatch ──
  /** The agent-run feed shown in the Dispatch section. */
  listDispatch(): DispatchRun[] {
    return DISPATCH_RUNS
  },

  // ── Contexts (the set-up ones, on the Contexts page) ──
  savedContexts(): SavedContextsSnapshot {
    return {
      contexts: SAVED_CONTEXTS,
      connectedConnectorIds: CONNECTED_CONNECTOR_IDS,
      connectedMcpIds: CONNECTED_MCP_IDS,
    }
  },
  /** The sidebar detail for one connector / MCP server (mock: derived locally;
   *  a real backend fetches live resources from the connected service). */
  connectorDetail(connector: Connector): ConnectorDetail {
    return connectorDetail(connector)
  },

  // ── Artifact bodies ──
  artifactContent(): ArtifactContentLibrary {
    return ARTIFACT_CONTENT
  },

  // ── Schedule templates (the "New schedule" starters) ──
  scheduleTemplates(): ScheduleTemplate[] {
    return SCHEDULE_TEMPLATES
  },
}
