import { useSyncExternalStore } from 'react'

const held = new Map<string, number>()
const listeners = new Set<() => void>()
let revision = 0

function publish(): void {
  revision += 1
  for (const listener of listeners) listener()
}

export function holdDelegationPolicy(id: string): void {
  held.set(id, (held.get(id) ?? 0) + 1)
  publish()
}

export function releaseDelegationPolicy(id: string): void {
  const remaining = Math.max(0, (held.get(id) ?? 0) - 1)
  if (remaining === 0) held.delete(id)
  else held.set(id, remaining)
  publish()
}

export function clearDelegationPolicyHolds(): void {
  if (held.size === 0) return
  held.clear()
  publish()
}

export const isDelegationPolicyHeld = (id: string): boolean => (held.get(id) ?? 0) > 0

export function useDelegationPolicyHolds(): number {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    () => revision,
    () => 0,
  )
}
