import type { Agent } from '../../contract/index.ts'
import { shouldAcceptEntityRevision } from './entityRevision.ts'

const monotonic = (a: number | undefined, b: number | undefined): number | undefined => {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.max(a, b)
}

/** Merge the configuration domain by its own revision while preserving the two
 * independent, monotonic activity counters. A delayed PATCH acknowledgement can
 * therefore never erase a contribution or fork observed through ambient sync. */
export function mergeAgentConfiguration(current: Agent, incoming: Agent): Agent {
  const activity = {
    contributions: monotonic(current.contributions, incoming.contributions),
    forks: monotonic(current.forks, incoming.forks),
  }
  if (!shouldAcceptEntityRevision(current.revision, incoming.revision)) {
    return { ...current, ...activity }
  }
  return { ...incoming, ...activity }
}
