import type { SessionContextState } from '../../contract/api.ts'
import type { LocalFolderRefreshRequest } from '../../contract/localFolderCapture.ts'
import { apiPost } from './client.ts'
import { invalidate } from './cache.ts'
import { keys, paths } from './keys.ts'
import type { captureLocalFolderSource } from './localFolders.ts'

export async function refreshLocalSessionFolder(sessionId: string, folderId: string, request: LocalFolderRefreshRequest, identity: ReturnType<typeof captureLocalFolderSource>): Promise<SessionContextState> {
  identity.assertCurrent()
  const result = await apiPost<SessionContextState>(paths.refreshLocalSessionFolder(sessionId, folderId), request, {
    signal: AbortSignal.timeout(30_000), expectedSessionUserId: identity.sourceUserId,
  })
  identity.assertCurrent()
  invalidate(keys.session(sessionId))
  return result
}
