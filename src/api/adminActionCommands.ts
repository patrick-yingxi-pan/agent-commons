/** Exact transport and recovery for the maintainer console's security acts. */
import type { AdminActionState } from '../../contract/index.ts'
import { apiDelete, apiGet, apiPost } from './client.ts'
import { invalidate } from './cache.ts'
import { keys, paths } from './keys.ts'
import {
  adminActionRealized,
  type AdminActionTarget,
} from './adminActionRevision.ts'

export type AdminActionIntent = AdminActionTarget & {
  tenantId: string
  intentId: string
}

export function adminActionResourceId(target: AdminActionTarget): string {
  switch (target.kind) {
    case 'deactivate-user':
      return `admin-action:deactivate-user:${encodeURIComponent(target.userId)}`
    case 'revoke-token':
      return `admin-action:revoke-token:${encodeURIComponent(target.userId)}:${encodeURIComponent(target.tokenId)}`
    case 'revoke-invite':
      return `admin-action:revoke-invite:${encodeURIComponent(target.inviteId)}`
  }
}

function refreshAdminAction(target: AdminActionTarget): void {
  switch (target.kind) {
    case 'deactivate-user':
      invalidate(keys.adminUsers)
      invalidate(keys.adminTokens)
      break
    case 'revoke-token':
      invalidate(keys.adminTokens)
      invalidate(keys.adminUsers)
      break
    case 'revoke-invite':
      invalidate(keys.adminInvites)
      break
  }
}

export async function applyAdminAction(
  intent: AdminActionIntent,
  idempotencyKey: string,
): Promise<void> {
  let state: AdminActionState
  switch (intent.kind) {
    case 'deactivate-user':
      state = await apiPost<AdminActionState>(
        paths.adminUserDeactivate(intent.userId),
        undefined,
        { idempotencyKey },
      )
      break
    case 'revoke-token':
      state = await apiDelete<AdminActionState>(
        paths.adminTokenRevoke(intent.userId, intent.tokenId),
        undefined,
        { idempotencyKey },
      )
      break
    case 'revoke-invite':
      state = await apiDelete<AdminActionState>(
        paths.adminInviteRevoke(intent.inviteId),
        undefined,
        { idempotencyKey },
      )
      break
  }
  if (!adminActionRealized(state, intent)) {
    throw new Error('The server did not acknowledge the requested maintainer action.')
  }
  refreshAdminAction(intent)
}

export async function reconcileAdminAction(intent: AdminActionIntent): Promise<boolean> {
  let state: AdminActionState
  switch (intent.kind) {
    case 'deactivate-user':
      state = await apiGet<AdminActionState>(paths.adminUserDeactivate(intent.userId))
      break
    case 'revoke-token':
      state = await apiGet<AdminActionState>(paths.adminTokenRevoke(intent.userId, intent.tokenId))
      break
    case 'revoke-invite':
      state = await apiGet<AdminActionState>(paths.adminInviteRevoke(intent.inviteId))
      break
  }
  const realized = adminActionRealized(state, intent)
  refreshAdminAction(intent)
  return realized
}
