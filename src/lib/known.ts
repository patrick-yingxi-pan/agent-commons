/** The connectors / MCP servers that are already "set up" — what the Add-context
 *  picker shows as its instant-attach "Connected" quick list.
 *
 *  ── The concept (so the update rule is deducible, not incidental) ────────────
 *  "Connected" is the *shortcut surface* for connectors & MCP servers: the auth-
 *  /setup-heavy context, listed so it re-attaches in one click without re-
 *  authenticating. Unlike the files/folders/repos "Recent" list this is a *set*
 *  (membership, not recency). The invariant is the same, though: **any connector
 *  or server newly attached to a thread joins this set** — from Browse setting up
 *  a new account, an AI proposal attaching one, or a repo pulling in its GitHub
 *  connector. Promotion happens once, at the single attach funnel
 *  (`lib/contextShortcuts.ts` → `controller/handleAddContext`), never scattered
 *  across click handlers — see [[../lib/contextShortcuts]]. `addKnownId` notifies
 *  subscribers so every open picker re-renders to show the new entry.
 *
 *  Seeded from the Contexts page's catalog (savedContexts). In-memory for the
 *  session — a reload returns to the seeded set, like the rest of the mock's
 *  state. Files / photos / folders / repos keep their own "recents" list
 *  (lib/recents.ts); connectors & MCP show every set-up entry, hence this
 *  separate store. */
import { useSyncExternalStore } from 'react'
import { CONNECTED_CONNECTOR_IDS, CONNECTED_MCP_IDS } from '../data/savedContexts'
import type { ContextTypeId } from '../data/contextOptions'

/** Stable empty snapshot for types with no set (everything but connector / mcp),
 *  so the reactive hook doesn't loop on a fresh `[]` each render. */
const EMPTY: readonly string[] = []

const known: Partial<Record<ContextTypeId, string[]>> = {
  connector: [...CONNECTED_CONNECTOR_IDS],
  mcp: [...CONNECTED_MCP_IDS],
}
const subscribers = new Set<() => void>()

/** The ids already set up for a type, in the order they were added. */
export function getKnownIds(type: ContextTypeId): readonly string[] {
  return known[type] ?? EMPTY
}

/** Promote a freshly set-up element into `type`'s known list — appended (so it
 *  joins the end of the Connected quick list), de-duped. Notifies subscribers on
 *  a real change so any open picker reflects it immediately. */
export function addKnownId(type: ContextTypeId, id: string) {
  const cur = known[type] ?? []
  if (cur.includes(id)) return
  known[type] = [...cur, id]
  subscribers.forEach((cb) => cb())
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

/** Reactive read of a type's Connected set — re-renders the caller whenever
 *  `addKnownId` runs (from any attach path), so the quick list stays current. */
export function useKnownIds(type: ContextTypeId): readonly string[] {
  return useSyncExternalStore(subscribe, () => getKnownIds(type))
}
