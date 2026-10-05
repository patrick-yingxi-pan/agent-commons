import { accountGeneration, onAccountSwitch } from './account.ts'

// A successful retirement outranks every older list/graph/snapshot read for
// the current identity. The server epoch or identity switch starts a new world.
const absent = new Map<string, number>()
onAccountSwitch(() => absent.clear())

export function isArtifactPermanentlyAbsent(id: string): boolean {
  return absent.get(id) === accountGeneration()
}

export function markArtifactPermanentlyAbsent(id: string): void {
  absent.set(id, accountGeneration())
}

export function clearArtifactPermanentAbsences(): void {
  absent.clear()
}
