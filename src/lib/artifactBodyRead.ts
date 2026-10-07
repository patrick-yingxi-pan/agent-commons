/** Saved-body surfaces and lifecycle holds must not admit a live library read. */
export function shouldReadCurrentArtifactBody({
  addressedRevision,
  hasBodyOverride = false,
  inTrash = false,
  lifecycleHeld = false,
}: {
  addressedRevision?: number
  hasBodyOverride?: boolean
  inTrash?: boolean
  lifecycleHeld?: boolean
} = {}): boolean {
  return addressedRevision === undefined && !hasBodyOverride && !inTrash && !lifecycleHeld
}
