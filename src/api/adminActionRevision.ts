/** Exact desired-state proof for maintainer security actions. */
import type { AdminActionState } from '../../contract/index.ts'

export type AdminActionTarget =
  | { kind: 'deactivate-user'; userId: string }
  | { kind: 'revoke-token'; userId: string; tokenId: string }
  | { kind: 'revoke-invite'; inviteId: string }

export function adminActionRealized(
  state: AdminActionState,
  target: AdminActionTarget,
): boolean {
  if (state.kind !== target.kind) return false
  switch (target.kind) {
    case 'deactivate-user':
      return state.kind === 'deactivate-user' && state.userId === target.userId && state.deactivated
    case 'revoke-token':
      return state.kind === 'revoke-token' &&
        state.userId === target.userId &&
        state.tokenId === target.tokenId &&
        state.revoked
    case 'revoke-invite':
      return state.kind === 'revoke-invite' &&
        state.inviteId === target.inviteId &&
        (state.status === 'revoked' || state.status === 'absent')
  }
}
