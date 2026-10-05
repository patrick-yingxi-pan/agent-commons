/** Feature-local cache key family. Kept out of the broad API registry so the
 * history feature does not add code to every screen's shared key graph. */
export const artifactHistoryKey = (id?: string): string =>
  id ? `artifact-history:${id}` : 'artifact-history'
