/** Controller-owned transcripts are not query-cache entries. Both ambient
 * pushes and acknowledged writes request the same generation-fenced reread.
 * Keep this leaf free of EventSource/account lifecycle side effects so commands
 * can heal an open conversation even when ambient sync is unavailable. */
import { makeSeam } from './eventSeam.ts'

const sessionPush = makeSeam<[sessionId: string]>()
export const onSessionPush = sessionPush.on
export const refreshOpenSession = sessionPush.notify
