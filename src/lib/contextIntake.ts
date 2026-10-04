import { useLayoutEffect, useSyncExternalStore } from 'react'

/** A picker keeps its acknowledged preview focus, but an overlay must not
 * cover that picker before Done. This is ephemeral UI ownership, not context
 * authority or persistence. Idempotent release also handles StrictMode cleanup. */
export function createContextIntakeGate() {
  const owners = new Map<symbol, string>()
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  return {
    getSnapshot: (sessionId: string | null | undefined) => !!sessionId && [...owners.values()].includes(sessionId),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    acquire: (sessionId: string) => {
      const owner = Symbol()
      const held = [...owners.values()].includes(sessionId)
      owners.set(owner, sessionId)
      if (!held) notify()
      return () => {
        if (owners.delete(owner) && ![...owners.values()].includes(sessionId)) notify()
      }
    },
  }
}

const intake = createContextIntakeGate()

export function useContextIntake(sessionId: string | undefined, open: boolean): void {
  useLayoutEffect(() => open && sessionId ? intake.acquire(sessionId) : undefined, [sessionId, open])
}

export function useContextIntakeOpen(sessionId: string | null): boolean {
  return useSyncExternalStore(intake.subscribe, () => intake.getSnapshot(sessionId), () => false)
}
