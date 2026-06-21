/** The app's domain types now live in the shared contract (`/contract`), so the
 *  UI and the mock backend speak the exact same vocabulary. This module re-exports
 *  the whole contract as types, so any `import type { … } from '../types'` site
 *  keeps working and can reach every shared shape (entities, cowork, relations,
 *  contexts, content, events, api). Runtime values (RELATIONS, opKey, slug, …)
 *  are imported from their own modules, not here. */
export type * from '../contract/index.ts'
