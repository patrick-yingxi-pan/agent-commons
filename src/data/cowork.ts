/** Projects / Artifacts / Schedules / Dispatch seed now lives with the backend
 *  (server/data/cowork.ts) and is served over the API. This shim re-exports it so
 *  the reads that haven't migrated yet (the relations overlay seed, the section
 *  views) keep resolving; it's removed once they all read through the API. */
export * from '../../server/data/cowork.ts'
