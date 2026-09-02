/** Pure desired-state and cache algebra for acknowledgement-owned grants. */
import {
  canonicalGrantNote,
  type Audience,
  type CreateGrantRequest,
  type Grant,
  type SocialEntityRef,
} from '../../contract/index.ts'

export type GrantMutationIntent =
  | { kind: 'upsert'; request: CreateGrantRequest }
  | { kind: 'revoke'; grant: Grant }

export interface GrantMutationBaseline {
  grants: readonly Grant[]
  known: boolean
}

export function grantMutationSubject(intent: GrantMutationIntent): SocialEntityRef {
  return intent.kind === 'upsert' ? intent.request.subject : intent.grant.subject
}

function sameAudience(left: Audience, right: Audience): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'org' && right.kind === 'org') return left.orgId === right.orgId
  if (left.kind === 'principal' && right.kind === 'principal') return left.principalId === right.principalId
  return left.kind === 'link' && right.kind === 'link'
}

function desiredGrant(intent: Extract<GrantMutationIntent, { kind: 'upsert' }>, grant: Grant): boolean {
  return sameAudience(intent.request.audience, grant.audience)
    && intent.request.tier === grant.tier
    && canonicalGrantNote(intent.request.note) === canonicalGrantNote(grant.note)
}

export function grantMutationRealized(
  intent: GrantMutationIntent,
  baseline: GrantMutationBaseline,
  incoming: readonly Grant[],
): boolean {
  if (intent.kind === 'revoke') return !incoming.some((grant) => grant.id === intent.grant.id)
  const realized = incoming.find((grant) => desiredGrant(intent, grant))
  if (!realized) return false
  if (intent.request.audience.kind !== 'link') return true

  // A link share is rotation, not merely desired-state assignment. Prove the
  // token changed from the state frozen before this logical click so an old
  // already-present link cannot be mistaken for a newly applied mutation.
  const prior = baseline.grants.find((grant) => grant.audience.kind === 'link')
  return realized.audience.kind === 'link'
    && (prior?.audience.kind === 'link'
      ? realized.audience.token !== prior.audience.token
      : baseline.known)
}
