import type { Delegation } from '../../contract/index.ts'

/** Keep acknowledgements and recovery reads from rewinding a newer authority version. */
export function preferNewerDelegation(current: Delegation, incoming: Delegation): Delegation {
  return (current.revision ?? 0) > (incoming.revision ?? 0) ? current : incoming
}
