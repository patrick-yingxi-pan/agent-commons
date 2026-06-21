/** The app's domain types now live in the shared contract (`/contract`), so the
 *  UI and the mock backend speak the exact same vocabulary. This module re-exports
 *  them, so existing `import … from '../types'` sites keep working unchanged while
 *  the single source of truth moves out of the client. */
export type * from '../contract/entities.ts'
