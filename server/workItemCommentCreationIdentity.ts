/** Durable identity for one logical work-item comment. Every authority and
 * containment coordinate participates so one retry key cannot alias another
 * tenant, Project, or item. */
import { createHash } from 'node:crypto'

const WORK_ITEM_COMMENT_CREATION_ID = /^work-comment-new-[a-f0-9]{24}$/

export function workItemCommentCreationId(
  tenantId: string,
  projectId: string,
  itemId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${projectId}\0${itemId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `work-comment-new-${digest}`
}

export const isWorkItemCommentCreationId = (id: string): boolean =>
  WORK_ITEM_COMMENT_CREATION_ID.test(id)
