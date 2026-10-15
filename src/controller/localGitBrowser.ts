import { useSyncExternalStore } from 'react'
import type { LocalGitConnectionId } from '../../contract/localGitCapture.ts'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { localGitConnections } from './localGitConnections.ts'
import { createLocalGitBrowserCore } from './localGitBrowserCore.ts'
import { prepareLocalFilePreview } from '../lib/localFilePreview.ts'
import { recognizeLocalPdfPreview } from '../lib/localPdfOcrPreview.ts'
import { desktopPdfOcrAvailable } from '../api/desktopPdfOcr.ts'

async function commands() {
  const generation = accountGeneration()
  const loaded = await import('../api/localGit.ts')
  if (generation !== accountGeneration()) throw new Error('The account changed before repository browsing was ready.')
  return loaded
}

export const localGitBrowser = createLocalGitBrowserCore({
  list: async id => (await commands()).readLocalGitFiles(id),
  preview: async (id, path, signal) => {
    const api = await commands()
    signal.throwIfAborted()
    return prepareLocalFilePreview(await api.readLocalGitFile(id, path), signal, undefined, undefined, { retainPdfOcrInput: desktopPdfOcrAvailable() })
  },
  processPreview: recognizeLocalPdfPreview,
  now: () => Date.now(),
})

onAccountSwitch(() => localGitBrowser.clear())
localGitConnections.subscribeDisconnect(id => localGitBrowser.dismiss(id))
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
