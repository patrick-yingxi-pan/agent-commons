import { useSyncExternalStore } from 'react'
import type { LocalFolderConnectionId } from '../../contract/localFolderCapture.ts'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { localFolderConnections } from './localFolderConnections.ts'
import { createLocalFolderBrowserCore } from './localFolderBrowserCore.ts'

async function commands() {
  const generation = accountGeneration()
  const loaded = await import('../api/localFolders.ts')
  if (generation !== accountGeneration()) throw new Error('The account changed before folder browsing was ready.')
  return loaded
}

export const localFolderBrowser = createLocalFolderBrowserCore({
  list: async id => (await commands()).readLocalFolderFiles(id),
  preview: async (id, path) => (await commands()).readLocalFolderFile(id, path),
  now: () => Date.now(),
})

onAccountSwitch(() => localFolderBrowser.clear())
localFolderConnections.subscribeDisconnect(id => localFolderBrowser.dismiss(id))
localFolderConnections.subscribe(() => {
  const connections = localFolderConnections.get()
  if (connections.status === 'ready') localFolderBrowser.retain(connections.rows.map(row => row.id))
})

export function useLocalFolderBrowser(id: LocalFolderConnectionId) {
  return useSyncExternalStore(
    listener => localFolderBrowser.subscribe(id, listener),
    () => localFolderBrowser.get(id),
    () => localFolderBrowser.get(id),
  )
}
