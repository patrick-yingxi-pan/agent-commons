/** The set-up contexts (connectors / MCP / repos) now live with the backend
 *  (server/data/savedContexts.ts) and are served over the API. This shim
 *  re-exports them so the Contexts page + recents seed keep resolving until
 *  those reads migrate. */
export * from '../../server/data/savedContexts.ts'
