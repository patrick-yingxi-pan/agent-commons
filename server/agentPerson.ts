/** Shared trust posture for private Agent provenance and request access. */
import type { Identity } from '../contract/identity.ts'
import { identityHeadersAllowed } from './auth.ts'

export function agentPerson(who: Identity, authGate: boolean): string | undefined {
  return who.via === 'session' || (process.env.DEPLOYMENT_PROFILE === 'desktop' && who.via === 'default' && who.local &&
    !identityHeadersAllowed() && !authGate) ? who.user.id : undefined
}
