import { CONNECTED_CONNECTOR_IDS, CONNECTED_MCP_IDS } from '../data/savedContexts'
import type { ContextTypeId } from '../data/contextOptions'

/** The connectors / MCP servers that are already "set up" — what the Add-context
 *  picker shows as its instant-attach "Connected" quick list. Seeded from the
 *  Contexts page's catalog (savedContexts); setting up a new one through Browse
 *  promotes it here so it joins the quick list and is there to reuse the next
 *  time the picker opens. In-memory for the session — a reload returns to the
 *  seeded set, like the rest of the mock's state.
 *
 *  Only connectors & MCP servers use this: files / photos / folders / repos keep
 *  their own "recents" list (lib/recents.ts), which already promotes browsed-in
 *  items. Connectors & MCP instead show every set-up entry, hence a separate store. */
const known: Partial<Record<ContextTypeId, string[]>> = {
  connector: [...CONNECTED_CONNECTOR_IDS],
  mcp: [...CONNECTED_MCP_IDS],
}

/** The ids already set up for a type, in the order they were added. */
export function getKnownIds(type: ContextTypeId): string[] {
  return known[type] ?? []
}

/** Promote a freshly set-up element into `type`'s known list — appended (so it
 *  joins the end of the Connected quick list), de-duped. */
export function addKnownId(type: ContextTypeId, id: string) {
  const cur = known[type] ?? []
  if (!cur.includes(id)) known[type] = [...cur, id]
}
