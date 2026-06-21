/** Add-context catalogs now live with the backend (server/data/contextOptions.ts)
 *  and are served over the API. This shim re-exports them so the picker + recents
 *  reads that haven't migrated yet keep resolving. */
export * from '../../server/data/contextOptions.ts'
