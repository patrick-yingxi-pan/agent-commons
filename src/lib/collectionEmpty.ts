/** Empty collection copy distinguishes a genuine first-use state from a view
 *  whose search or filters happen to hide existing rows. Main and rail
 *  projections consume the same sentence so the collection never tells two
 *  different stories about the same account state. */
export type FirstRunCollection = 'sessions' | 'artifacts' | 'routines'

const EMPTY_COLLECTION_COPY: Record<FirstRunCollection, { firstRun: string; filtered: string }> = {
  sessions: {
    firstRun: 'No sessions yet — choose New session to begin.',
    filtered: 'No sessions match these filters.',
  },
  artifacts: {
    firstRun: 'No artifacts yet — choose New artifact or save work from a conversation.',
    filtered: 'No artifacts match.',
  },
  routines: {
    firstRun: 'No routines yet — choose New routine to begin.',
    filtered: 'No routines match.',
  },
}

export function collectionEmptyCopy(collection: FirstRunCollection, total: number): string {
  return total === 0
    ? EMPTY_COLLECTION_COPY[collection].firstRun
    : EMPTY_COLLECTION_COPY[collection].filtered
}
