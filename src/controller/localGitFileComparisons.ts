import { useSyncExternalStore } from 'react'
import type { LocalGitConnectionId } from '../../contract/localGitCapture.ts'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { localGitConnections } from './localGitConnections.ts'
import { createLocalGitFileComparisonsCore } from './localGitFileComparisonsCore.ts'

async function commands() {
  const generation = accountGeneration()
  const loaded = await import('../api/localGit.ts')
  if (generation !== accountGeneration()) throw new Error('The account changed before file comparison was ready.')
  return loaded
}

export const localGitFileComparisons = createLocalGitFileComparisonsCore({
  read: async (id, selection, signal) => (await commands()).readLocalGitFileComparison(id, selection, signal),
  now: () => Date.now(),
})

onAccountSwitch(() => localGitFileComparisons.clear())
localGitConnections.subscribeDisconnect(id => localGitFileComparisons.dismiss(id))
localGitConnections.subscribe(() => {
  const connections = localGitConnections.get()
  if (connections.status === 'ready') localGitFileComparisons.retain(connections.rows.map(row => row.id))
})

export function useLocalGitFileComparison(id: LocalGitConnectionId) {
  return useSyncExternalStore(
    listener => localGitFileComparisons.subscribe(id, listener),
    () => localGitFileComparisons.get(id),
    () => localGitFileComparisons.get(id),
  )
}
