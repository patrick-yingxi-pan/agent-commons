type PresenceId = string | number

interface PresenceRegistration {
  register: (id: PresenceId) => () => void
  onExitComplete?: (id: PresenceId) => void
}

/** A replaced loading shell may finish an old animation after unregistering.
 * Forward only live registrations, so that completion cannot recreate a ghost
 * entry in the parent's presence map and block a later ordinary dismissal. */
export function scopePanelPresence<T extends PresenceRegistration>(parent: T, active: Set<PresenceId>): T {
  return {
    ...parent,
    register(id: PresenceId) {
      active.add(id)
      const unregister = parent.register(id)
      return () => { active.delete(id); unregister() }
    },
    onExitComplete(id: PresenceId) {
      if (active.has(id)) parent.onExitComplete?.(id)
    },
  }
}
