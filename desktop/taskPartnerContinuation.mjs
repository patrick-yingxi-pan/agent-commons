import { isTrustedAppUrl } from './runtime.mjs'

/** Open only the local, non-secret consent address in the system browser.
 * An application handoff ID is a lookup key. The browser must sign in itself. */
export function isTaskPartnerContinuation(candidate, origin) {
  if (!isTrustedAppUrl(candidate, origin)) return false
  const url = new URL(candidate)
  return !url.search && !url.hash && !url.username && !url.password &&
    /^\/api\/v1\/auth\/task-partner-handoffs\/grant-[a-f0-9]{32}$/.test(url.pathname)
}
