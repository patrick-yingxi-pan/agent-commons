import type { SessionContextState } from '../../contract/api.ts'
import type { LocalGitRefreshRequest } from '../../contract/localGitCapture.ts'
import { apiPost } from './client.ts'
import { invalidate } from './cache.ts'
import { keys, paths } from './keys.ts'
import type { captureLocalGitSource } from './localGit.ts'

export async function refreshLocalGitSessionFolder(sessionId: string, folderId: string, request: LocalGitRefreshRequest, identity: ReturnType<typeof captureLocalGitSource>): Promise<SessionContextState> {
  identity.assertCurrent()
  const result = await apiPost<SessionContextState>(paths.refreshLocalGitSessionFolder(sessionId, folderId), request, {
    signal: AbortSignal.timeout(30_000), expectedSessionUserId: identity.sourceUserId,
  })
  identity.assertCurrent()
  invalidate(keys.session(sessionId))
  return result
}
