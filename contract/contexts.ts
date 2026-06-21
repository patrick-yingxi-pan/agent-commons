/** ── Contract: Add-context types ───────────────────────────────────────────
 *  The six kinds of context a session can attach. The recents store and the
 *  picker quick-lists are keyed by these. (The catalog item shapes —
 *  CONNECTOR_OPTIONS, FOLDER_OPTIONS, SavedContext, … — are added here as their
 *  reads migrate to the API; this id type is the part the event + recents
 *  contracts need from the start.) */
export type ContextTypeId = 'files' | 'photos' | 'folder' | 'repo' | 'connector' | 'mcp'
