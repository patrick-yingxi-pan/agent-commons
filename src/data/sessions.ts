/** The session seed now lives with the backend (server/data/sessions.ts) — the
 *  UI reads sessions over the API (src/api). This shim re-exports the seed so the
 *  controller paths that haven't migrated yet keep resolving; it's removed once
 *  every session read goes through the API. */
export * from '../../server/data/sessions.ts'
