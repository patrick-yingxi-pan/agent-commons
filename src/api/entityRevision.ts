/** A monotonic acceptance fence for revisioned entity projections. Legacy
 * unrevisioned responses interoperate until revisioned truth exists; after
 * that, neither an older nor an unrevisioned acknowledgement may rewind it. */
export function shouldAcceptEntityRevision(
  current: number | undefined,
  incoming: number | undefined,
): boolean {
  if (incoming === undefined) return current === undefined
  if (current === undefined) return true
  return incoming >= current
}
