/** Application-bootstrap policy — the two reads that decide whether the app
 * may render its signed-in workspace or auth front door.
 *
 * A first load never becomes a blank, terminal frame: pending reads produce a
 * neutral loading state and a failed missing read produces an actionable error.
 * Once both values have resolved, the query cache itself keeps them through an
 * ordinary stale-while-revalidate fetch. A deliberate cache reset (account
 * switch, sign-out, server epoch) clears them and must earn a fresh pair. */
import { invalidate, type QueryStatus } from './cache.ts'
import { keys } from './keys.ts'

export type AppBootstrapState<Capabilities, Identity> =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; capabilities: Capabilities; identity: Identity }

export function resolveAppBootstrap<Capabilities, Identity>(
  capabilities: Capabilities | undefined,
  identity: Identity | undefined,
  capabilitiesStatus: QueryStatus,
  identityStatus: QueryStatus,
): AppBootstrapState<Capabilities, Identity> {
  if (capabilities !== undefined && identity !== undefined) {
    return { status: 'ready', capabilities, identity }
  }
  const missingReadFailed =
    (capabilities === undefined && capabilitiesStatus === 'error') ||
    (identity === undefined && identityStatus === 'error')
  return { status: missingReadFailed ? 'error' : 'loading' }
}

/** Retry the complete decision barrier, not only whichever failure happened to
 * render first. Both reads define the next surface and may have failed in the
 * same outage. Keep the pair explicit so its completeness is bite-testable. */
export const APP_BOOTSTRAP_KEYS = [keys.capabilities, keys.me] as const

/** Deliberately zero-argument: this is passed to a React click handler, whose
 * event must never be mistaken for an injectable function dependency. */
export function retryAppBootstrap(): void {
  for (const key of APP_BOOTSTRAP_KEYS) invalidate(key)
}
