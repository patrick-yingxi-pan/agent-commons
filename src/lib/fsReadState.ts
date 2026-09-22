import type { FsSource } from '../../contract/fs.ts'
import type { QueryState, QueryStatus } from '../api/cache.ts'

export type FsReadPhase = 'loading' | 'error' | 'empty' | 'ready'

/** A failed or unanswered filesystem read never supplies selectable stale rows.
 * Only an acknowledged catalog can say that a source is empty. */
export function fsReadPhase(status: QueryStatus, hasItems: boolean): FsReadPhase {
  if (status === 'error') return 'error'
  if (status !== 'success') return 'loading'
  return hasItems ? 'ready' : 'empty'
}

/** A missing served source is not permission to choose the user's computer. */
export function selectedFsSource(query: QueryState<FsSource[]>, id: string, local: FsSource): FsSource | undefined {
  if (id === local.id) return local
  return query.status === 'success' ? query.data?.find((source) => source.id === id) : undefined
}
