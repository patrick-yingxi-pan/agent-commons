/** Browser-Origin boundary shared by ordinary HTTP, preflight, and MCP.
 *
 * An exact `CORS_ORIGIN` is not merely a response-header preference: for a
 * loopback desktop server it is the wall that stops an unrelated webpage from
 * reading or mutating the device owner's local workspace. Requests without an
 * Origin are native/non-browser callers and remain valid. Development keeps its
 * explicit wildcard posture.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { headerValue, sendError } from './respond.ts'

export function originAllowed(
  headers: IncomingMessage['headers'],
  env: Record<string, string | undefined> = process.env,
): boolean {
  const pinned = env.CORS_ORIGIN
  const origin = headerValue(headers, 'origin')
  return !pinned || pinned === '*' || !origin || origin === pinned
}

/** Returns true when processing may continue; otherwise writes the 403. */
export function enforceOrigin(
  req: IncomingMessage,
  res: ServerResponse,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (originAllowed(req.headers, env)) return true
  sendError(res, 'forbidden', 'This browser origin is not allowed to access this deployment.')
  return false
}
