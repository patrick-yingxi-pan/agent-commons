import { useEffect, useSyncExternalStore } from 'react'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { localGitAvailable } from '../api/localGitCapability.ts'
import { createLocalGitConnections } from './localGitConnectionsCore.ts'

async function commands() {
  const generation = accountGeneration()
  const loaded = await import('../api/localGit.ts')
  if (generation !== accountGeneration()) throw new Error('The account changed before repository access was ready.')
  return loaded
}

export const localGitConnections = createLocalGitConnections({
  list: async () => (await commands()).readLocalGitConnections(),
  connect: async remember => (await commands()).connectLocalGit(remember),
  disconnect: async id => (await commands()).disconnectLocalGit(id),
})
onAccountSwitch(() => localGitConnections.clear())

export function useLocalGitConnections() {
  const state = useSyncExternalStore(localGitConnections.subscribe, localGitConnections.get)
  const available = localGitAvailable()
  useEffect(() => { if (available && state.status === 'idle') void localGitConnections.reload() }, [available, state.status])
  return { ...state, available }
}
