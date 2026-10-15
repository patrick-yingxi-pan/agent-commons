/** One live/replay audience for both event transports. Private requests also
 * require the original credential to remain the same authenticated person. */
import type { Identity } from '../contract/identity.ts'
import type { ServerEvent } from '../contract/events.ts'
import { store } from './store/index.ts'

export function eventAudience(headers: Record<string, string | string[] | undefined>, identity: Identity = store.identity(headers)): (event: ServerEvent) => boolean {
  return event => {
    if (event.type === 'agent-request.changed') {
      const current = store.identity(headers)
      const actor = store.agentRequestActor(headers)
      if (!actor || current.via !== identity.via || actor.tenantId !== identity.tenant.id || actor.userId !== identity.user.id) return false
    }
    return store.eventVisibleToTenant(event, identity.tenant.id, identity.user.id)
  }
}
