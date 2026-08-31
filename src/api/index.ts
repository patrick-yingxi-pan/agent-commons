/** ── The API client ────────────────────────────────────────────────────────
 *  The UI's one door to the backend. Components import hooks (`useSessions`),
 *  controllers import commands + the cache; nothing else in the UI knows a URL or
 *  an event. Point `VITE_API_BASE` at a native sidecar or a remote server and the
 *  whole app moves — that's the portability the contract buys. */
export * from './client.ts'
export * from './account.ts'
export * from './cache.ts'
export * from './keys.ts'
export * from './sessionPaging.ts'
export * from './entityRevision.ts'
export * from './scheduleRevision.ts'
export * from './artifactContentRevision.ts'
export * from './appBootstrap.ts'
export * from './resourceRead.ts'
export * from './syncHealth.ts'
export * from './hooks.ts'
export * from './events.ts'
export * from './commands.ts'
export * from './desktopCredentials.ts'
export * from './desktopData.ts'
