import { useSyncExternalStore } from 'react'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { fsRecentKey } from '../../contract/fs.ts'
import { DRAFT_ID } from '../data/liveSession.ts'
import { createLocalGitSavedCopiesCore } from './localGitSavedCopiesCore.ts'

export const localGitSavedCopies = createLocalGitSavedCopiesCore()
onAccountSwitch(() => localGitSavedCopies.clear())

export function localGitSavedCopyScope(sessionId?: string) {
  return JSON.stringify([accountGeneration(), sessionId || DRAFT_ID])
}

export function newLocalGitSavedCopyId() {
  return fsRecentKey('ui-host', crypto.randomUUID())
}

export function useLocalGitSavedCopyPending(scope: string, connectionId: string, receipt: number | null) {
  return useSyncExternalStore(
    listener => receipt === null ? () => {} : localGitSavedCopies.subscribe(scope, connectionId, receipt, listener),
    () => receipt !== null && localGitSavedCopies.isPending(scope, connectionId, receipt),
    () => false,
  )
}
