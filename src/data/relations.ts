/** The relationship model (types + opKey/describeOp/RELATIONS) now lives in the
 *  shared contract (contract/relations.ts), since both the UI and the backend
 *  need it. This shim re-exports it so existing `../data/relations` imports keep
 *  resolving. */
export * from '../../contract/relations.ts'
