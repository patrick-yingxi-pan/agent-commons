/** A retained revision is an addressable, read-only place, including revision 0. */
export function artifactHistoryRevision(value: string | null | undefined): number | undefined {
  if (value === undefined || value === null || !/^(0|[1-9]\d*)$/.test(value)) return undefined
  const revision = Number(value)
  return Number.isSafeInteger(revision) ? revision : undefined
}
