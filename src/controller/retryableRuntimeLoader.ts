/** Coalesce one active lazy load without retaining its rejection forever. */
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
