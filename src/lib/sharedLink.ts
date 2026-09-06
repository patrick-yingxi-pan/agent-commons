/** Share-link entry is parsed and routed before the workspace mounts. Keeping
 * this policy pure makes malformed addresses and every social noun cheap to
 * lock without a browser. */
import type { SocialEntityRef } from '../../contract/index.ts'
import { sectionForSocialKind } from './anchorLocus.ts'
import { seedFor } from './paneNav.ts'
import { pathForView } from './urlRoutes.ts'

export type SharedLinkAddress =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'token'; token: string }

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{1,256}$/

/** Only the exact `/shared/:token` shape is a capability entry. Malformed
 * percent escapes and decoded separators are invalid rather than exceptions. */
export function sharedLinkAddress(pathname: string): SharedLinkAddress {
  if (pathname === '/shared' || pathname === '/shared/') return { kind: 'invalid' }
  if (!pathname.startsWith('/shared/')) return { kind: 'none' }
  const match = pathname.match(/^\/shared\/([^/]+)\/?$/)
  if (!match) return { kind: 'invalid' }
  try {
    const token = decodeURIComponent(match[1])
    return TOKEN_SHAPE.test(token) ? { kind: 'token', token } : { kind: 'invalid' }
  } catch {
    return { kind: 'invalid' }
  }
}

/** The one canonical browser destination for every social noun. Nouns with a
 * page reuse the existing kind → section → seed → URL funnel; a proposal has
 * no independent UI page and therefore lands in the Commons projection. */
export function sharedSubjectPath(subject: SocialEntityRef): string {
  if (subject.kind === 'session') return `/s/${encodeURIComponent(subject.id)}`
  if (subject.kind === 'principal') return `/u/${encodeURIComponent(subject.id)}`
  const section = sectionForSocialKind(subject.kind)
  if (!section) return '/commons'
  const seed = seedFor(section, subject.id)
  const loc = {
    kind: 'section' as const,
    section,
    projectId: null,
    scheduleId: null,
    ownerName: null,
    ...(seed ?? {}),
  }
  return pathForView(loc, null)
}

export type SharedLinkFailurePhase = 'retryable' | 'unavailable' | 'identity-changed'

/** Status-only failure policy: absence/rotation is terminal; identity drift
 * requires a fresh bootstrap; transport, overload, and server faults retry the
 * exact in-memory token. */
export function sharedLinkFailurePhase(status: number | null, accountSwitched = false): SharedLinkFailurePhase {
  if (accountSwitched || status === 401 || status === 403 || status === 409) return 'identity-changed'
  if (status === 400 || status === 404) return 'unavailable'
  return 'retryable'
}
