/** Transient, account-local opt-in state for the explicit untracked browser. */
export function createLocalGitUntrackedOptInCore(onDisable: (id: string) => void) {
  const enabled = new Set<string>()
  const listeners = new Map<string, Set<() => void>>()
  const publish = (id: string) => { for (const listener of listeners.get(id) ?? []) listener() }
  return {
    get: (id: string) => enabled.has(id),
    subscribe(id: string, listener: () => void) {
      const set = listeners.get(id) ?? new Set<() => void>()
      set.add(listener); listeners.set(id, set)
      return () => { set.delete(listener); if (!set.size) listeners.delete(id) }
    },
    set(id: string, value: boolean) {
      if (enabled.has(id) === value) return
      if (value) enabled.add(id)
      else { enabled.delete(id); onDisable(id) }
      publish(id)
    },
    retain(ids: readonly string[]) {
      const retained = new Set(ids)
      for (const id of enabled) if (!retained.has(id)) {
        enabled.delete(id); onDisable(id); publish(id)
      }
    },
    clear() {
      const ids = [...enabled]
      enabled.clear()
      for (const id of ids) { onDisable(id); publish(id) }
    },
  }
}
