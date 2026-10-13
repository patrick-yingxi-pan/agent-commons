import { useSyncExternalStore } from 'react'
import type { LocalGitConnectionId } from '../../contract/localGitCapture.ts'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { localGitConnections } from './localGitConnections.ts'
import { createLocalGitBrowserCore } from './localGitBrowserCore.ts'

async function commands() {
  const generation = accountGeneration()
  const loaded = await import('../api/localGit.ts')
  if (generation !== accountGeneration()) throw new Error('The account changed before repository browsing was ready.')
  return loaded
}

export const localGitBrowser = createLocalGitBrowserCore({
  list: async id => (await commands()).readLocalGitFiles(id),
  preview: async (id, path) => (await commands()).readLocalGitFile(id, path),
  now: () => Date.now(),
})

onAccountSwitch(() => localGitBrowser.clear())
localGitConnections.subscribe(() => {
  const connections = localGitConnections.get()
  if (connections.status === 'ready') localGitBrowser.retain(connections.rows.map(row => row.id))
})

export function useLocalGitBrowser(id: LocalGitConnectionId) {
  return useSyncExternalStore(
    listener => localGitBrowser.subscribe(id, listener),
    () => localGitBrowser.get(id),
    () => localGitBrowser.get(id),
  )
}
