/** The free-typed → relation-op matcher now runs on the backend (it drives the
 *  streaming reply for a session turn). This shim re-exports it so anything still
 *  referencing it client-side keeps resolving; removed once nothing does. */
export * from '../../server/data/relationIntents.ts'
