import { useEffect, useSyncExternalStore } from 'react'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { localFoldersAvailable } from '../api/localFolderCapability.ts'
import { createLocalFolderConnections } from './localFolderConnectionsCore.ts'

async function commands() {
  const generation = accountGeneration()
  const loaded = await import('../api/localFolders.ts')
  if (generation !== accountGeneration()) throw new Error('The account changed before local access was ready.')
  return loaded
}

export const localFolderConnections = createLocalFolderConnections({
  list: async () => (await commands()).readLocalFolders(),
  connect: async remember => (await commands()).connectLocalFolder(remember),
  disconnect: async id => (await commands()).disconnectLocalFolder(id),
})
onAccountSwitch(() => localFolderConnections.clear())

export function useLocalFolderConnections() {
  const state = useSyncExternalStore(localFolderConnections.subscribe, localFolderConnections.get)
  const available = localFoldersAvailable()
  useEffect(() => { if (available && state.status === 'idle') void localFolderConnections.reload() }, [available, state.status])
  return { ...state, available }
}
