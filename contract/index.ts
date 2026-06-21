/** ── The contract ──────────────────────────────────────────────────────────
 *  The single, framework-free source of truth for the UI ↔ backend API. The
 *  client (Vite) and the mock server (Node) import this exact module, so the UI
 *  is portable: it speaks one contract whether the backend is the local mock, a
 *  native sidecar, or a remote web server. */
export * from './entities.ts'
export * from './cowork.ts'
export * from './relations.ts'
export * from './contexts.ts'
export * from './content.ts'
export * from './graph.ts'
export * from './runs.ts'
export * from './ids.ts'
export * from './events.ts'
export * from './api.ts'
