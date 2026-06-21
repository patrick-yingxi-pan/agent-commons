/** Artifact bodies now live with the backend (server/data/artifactContent.ts) and
 *  are served over the API. This shim re-exports them so the artifact preview /
 *  workspace / attachment panels keep resolving until those reads migrate. */
export * from '../../server/data/artifactContent.ts'
