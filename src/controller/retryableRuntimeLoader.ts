/** Coalesce one active lazy load without retaining its rejection forever. */
import { IDLE_REVISIONED_MUTATION, type RevisionedMutationStatus } from './revisionedMutationCore.ts'

export function createRetryableRuntimeLoader<T>(load: () => Promise<T>, accept: (loaded: T) => void): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => {
    if (pending) return pending
    const loading = load().then((loaded) => {
      accept(loaded)
      return loaded
    })
    pending = loading
    void loading.catch(() => {
      // Clear only this rejected attempt; an older callback must never erase a
      // later in-flight load.
      if (pending === loading) pending = null
    })
    return loading
  }
}

/** FIFO identity for held mutations whose shared lazy runtime failed to load. */
export function createRuntimeLoadFailureTracker() {
  let active: string | null = null
  return {
    active: (): string | null => active,
    status: (pendingCount: number, message: string): RevisionedMutationStatus => active ? {
      busy: false,
      error: message,
      retryable: true,
      activeResourceId: active,
      pendingCount,
    } : IDLE_REVISIONED_MUTATION,
    fail: (resourceId: string): string => {
      active ??= resourceId
      return active
    },
    retry: (): void => { active = null },
    remove: (resourceId: string, remaining: Iterable<string>): string | null => {
      if (active !== resourceId) return active
      active = null
      for (const candidate of remaining) { active = candidate; break }
      return active
    },
    clear: (): void => { active = null },
  }
}
