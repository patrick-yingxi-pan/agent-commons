import { apiGet, ApiRequestError } from './client.ts'
import { keys, paths } from './keys.ts'
import { invalidate } from './cache.ts'
import type { ToolActivityDecisionEligibility } from '../../contract/index.ts'

/** Viewer-relative control eligibility. These opaque activity ids are the only
 *  authorization projection; person/owner identities never enter the payload. */
export type ToolActivityEligibility = ToolActivityDecisionEligibility

export function retryToolActivityEligibility(sessionId: string, tenantId: string, userId: string): void {
  invalidate(keys.toolActivityEligibility(sessionId, tenantId, userId))
}

function idList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(id => typeof id === 'string' && id.length > 0) &&
    new Set(value).size === value.length
}

export async function readToolActivityEligibility(sessionId: string, expectedSessionUserId: string | null): Promise<ToolActivityEligibility> {
  const value = await apiGet<unknown>(paths.toolActivityEligibility(sessionId), { expectedSessionUserId })
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'decisionActivityIds') || !Object.hasOwn(value, 'confirmActivityIds')) {
    throw new ApiRequestError('internal', 'Invalid consent-control projection', 0)
  }
  const result = value as Record<string, unknown>
  const decisionActivityIds = result.decisionActivityIds
  const confirmActivityIds = result.confirmActivityIds
  if (!idList(decisionActivityIds) || !idList(confirmActivityIds) ||
      confirmActivityIds.some(id => !decisionActivityIds.includes(id))) {
    throw new ApiRequestError('internal', 'Invalid consent-control projection', 0)
  }
  return { decisionActivityIds: [...decisionActivityIds], confirmActivityIds: [...confirmActivityIds] }
}
