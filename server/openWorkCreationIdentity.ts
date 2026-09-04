/** Durable identity for one logical open-work post. Tenant and Project both
 * participate so a retry key cannot alias work across either authority wall. */
import { createHash } from 'node:crypto'

const OPEN_WORK_CREATION_ID = /^work-new-[a-f0-9]{24}$/

export function openWorkCreationId(
  tenantId: string,
  projectId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${projectId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `work-new-${digest}`
}

export const isOpenWorkCreationId = (id: string): boolean => OPEN_WORK_CREATION_ID.test(id)
