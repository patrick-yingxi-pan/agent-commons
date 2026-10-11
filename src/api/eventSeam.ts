/** Event-shape-free fan-out shared by ambient pushes and acknowledged writes.
 * This leaf starts no transport and owns no account lifecycle. */
export function makeSeam<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => void>()
  return {
    on(fn: (...args: Args) => void): () => void {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    notify(...args: Args): void {
      for (const fn of listeners) fn(...args)
    },
  }
}
