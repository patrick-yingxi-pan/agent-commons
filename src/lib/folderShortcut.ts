import type { AddedContext } from '../types.ts'

/** Resolve a folder's stable catalog identity when its canonical representation
 * carries an explicit folder record and no artifact rows. */
export function folderRecentId(ctx: Extract<AddedContext, { kind: 'folder' }>): string | undefined {
  if (ctx.source?.kind === 'ui-host') return undefined
  return ctx.folder?.id ?? ctx.artifacts.find((artifact) => artifact.source)?.source?.id
}
