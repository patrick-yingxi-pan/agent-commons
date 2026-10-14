import { useSyncExternalStore } from 'react'
import type { LocalGitConnectionId } from '../../contract/localGitCapture.ts'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { localGitConnections } from './localGitConnections.ts'
import { createLocalGitReviewsCore } from './localGitReviewsCore.ts'
import { createGitComparisonReceiptsCore } from './gitComparisonReceiptsCore.ts'

async function commands() {
  const generation = accountGeneration()
  const loaded = await import('../api/localGit.ts')
  if (generation !== accountGeneration()) throw new Error('The account changed before repository review was ready.')
  return loaded
}

export const localGitReviews = createLocalGitReviewsCore({
  read: async id => (await commands()).readLocalGitChanges(id),
  now: () => Date.now(),
})

export const gitComparisonReceipts = createGitComparisonReceiptsCore()

onAccountSwitch(() => localGitReviews.clear())
localGitConnections.subscribeDisconnect(id => localGitReviews.dismiss(id))
localGitConnections.subscribe(() => {
  const connections = localGitConnections.get()
  if (connections.status === 'ready') localGitReviews.retain(connections.rows.map(row => row.id))
})

export function useLocalGitReview(id: LocalGitConnectionId) {
  return useSyncExternalStore(
    listener => localGitReviews.subscribe(id, listener),
    () => localGitReviews.get(id),
    () => localGitReviews.get(id),
  )
}
