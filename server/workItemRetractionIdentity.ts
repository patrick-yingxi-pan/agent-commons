/** Durable identity for one logical native work-item retraction. The operation
 * stays private inside the stored item; every authority and containment
 * coordinate participates so a retry key cannot alias another act. */
import { createHash } from 'node:crypto'

const WORK_ITEM_RETRACTION_ID = /^work-retract-[a-f0-9]{24}$/

export function workItemRetractionId(
  tenantId: string,
  projectId: string,
  itemId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${projectId}\0${itemId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `work-retract-${digest}`
}

export const isWorkItemRetractionId = (id: string): boolean =>
  WORK_ITEM_RETRACTION_ID.test(id)
