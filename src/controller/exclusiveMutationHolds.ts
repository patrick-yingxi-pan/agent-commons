/** Generation-safe mutual exclusion for two or more mutation kinds that share
 * one resource identity. Same-kind callers may queue; different kinds cannot
 * race. Account switches synchronously clear every hold, while old promises
 * retain generation-stamped leases that cannot release new-account work. */
import { onAccountSwitch } from '../api/account.ts'

export interface ExclusiveMutationLease<Kind extends string> {
  readonly generation: number
  readonly id: string
  readonly kind: Kind
}

export function createExclusiveMutationHolds<const Kind extends string>(
  kinds: readonly Kind[],
) {
  const counts = new Map<Kind, Map<string, number>>(
    kinds.map((kind) => [kind, new Map<string, number>()]),
  )
  let generation = 0

  const count = (kind: Kind, id: string): number => counts.get(kind)?.get(id) ?? 0

  const acquire = (kind: Kind, id: string): ExclusiveMutationLease<Kind> | null => {
    if (kinds.some((candidate) => candidate !== kind && count(candidate, id) > 0)) return null
    const held = counts.get(kind)
    if (!held) throw new Error(`Unknown mutation kind '${kind}'.`)
    held.set(id, count(kind, id) + 1)
    return { generation, id, kind }
  }

  const release = (lease: ExclusiveMutationLease<Kind>): void => {
    if (lease.generation !== generation) return
    const held = counts.get(lease.kind)
    if (!held) return
    const remaining = Math.max(0, count(lease.kind, lease.id) - 1)
    if (remaining === 0) held.delete(lease.id)
    else held.set(lease.id, remaining)
  }

  const isHeld = (kind: Kind, id: string): boolean => count(kind, id) > 0

  onAccountSwitch(() => {
    generation += 1
    for (const held of counts.values()) held.clear()
  })

  return { acquire, release, isHeld }
}
