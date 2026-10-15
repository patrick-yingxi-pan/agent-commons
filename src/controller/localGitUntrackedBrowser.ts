import { useSyncExternalStore } from 'react'
import type { LocalGitConnectionId } from '../../contract/localGitCapture.ts'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { localGitConnections } from './localGitConnections.ts'
import { createLocalGitUntrackedBrowserCore } from './localGitUntrackedBrowserCore.ts'
import { createLocalGitUntrackedOptInCore } from './localGitUntrackedOptInCore.ts'
import { prepareLocalFilePreview } from '../lib/localFilePreview.ts'
import { recognizeLocalPdfPreview } from '../lib/localPdfOcrPreview.ts'
import { desktopPdfOcrAvailable } from '../api/desktopPdfOcr.ts'

async function commands() {
  const generation = accountGeneration()
  const loaded = await import('../api/localGit.ts')
  if (generation !== accountGeneration()) throw new Error('The account changed before repository browsing was ready.')
  return loaded
}

export const localGitUntrackedBrowser = createLocalGitUntrackedBrowserCore({
  list: async (id, signal) => (await commands()).readLocalGitUntrackedFiles(id, signal),
  preview: async (id, path, signal) => {
    const api = await commands()
    signal.throwIfAborted()
    return prepareLocalFilePreview(await api.readLocalGitUntrackedFile(id, path, signal), signal, undefined, undefined, { retainPdfOcrInput: desktopPdfOcrAvailable() })
  },
  processPreview: recognizeLocalPdfPreview,
  now: () => Date.now(),
})

export const localGitUntrackedOptIn = createLocalGitUntrackedOptInCore(id => localGitUntrackedBrowser.dismiss(id))

onAccountSwitch(() => {
  localGitUntrackedOptIn.clear()
  localGitUntrackedBrowser.clear()
})
localGitConnections.subscribeDisconnect(id => localGitUntrackedOptIn.set(id, false))
localGitConnections.subscribe(() => {
  const connections = localGitConnections.get()
  if (connections.status === 'ready') localGitUntrackedOptIn.retain(connections.rows.map(row => row.id))
})

export function useLocalGitUntrackedBrowser(id: LocalGitConnectionId) {
  return useSyncExternalStore(
    listener => localGitUntrackedBrowser.subscribe(id, listener),
    () => localGitUntrackedBrowser.get(id),
    () => localGitUntrackedBrowser.get(id),
  )
}

export function useLocalGitUntrackedOptIn(id: LocalGitConnectionId) {
  return useSyncExternalStore(
    listener => localGitUntrackedOptIn.subscribe(id, listener),
    () => localGitUntrackedOptIn.get(id),
    () => false,
  )
}
