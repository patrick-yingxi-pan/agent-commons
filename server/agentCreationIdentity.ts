import { createHash } from 'node:crypto'

const DIRECT_AGENT_CREATION_ID = /^agent-new-[a-f0-9]{24}$/
const FORK_AGENT_CREATION_ID = /^agent-fork-[a-f0-9]{24}$/
const IMPORT_AGENT_CREATION_ID = /^agent-import-[a-f0-9]{24}$/

function opaqueAgentId(
  prefix: 'new' | 'fork' | 'import',
  tenantId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${tenantId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24)
  return `agent-${prefix}-${digest}`
}

/** Durable identity for one logical direct Agent creation. The tenant is part
 * of the digest so a retry key can never alias a row across account scopes. */
export function agentCreationId(tenantId: string, idempotencyKey: string): string {
  return opaqueAgentId('new', tenantId, idempotencyKey)
}

/** A published-definition fork gets a disjoint identity namespace. Reusing a
 * transport key across New Agent and Fork agent can therefore never alias. */
export function agentForkCreationId(tenantId: string, idempotencyKey: string): string {
  return opaqueAgentId('fork', tenantId, idempotencyKey)
}

/** A remote-card import has its own namespace so the same transport key can
 * never alias either a directly authored Agent or a local definition fork. */
export function agentImportCreationId(tenantId: string, idempotencyKey: string): string {
  return opaqueAgentId('import', tenantId, idempotencyKey)
}

export const isDirectAgentCreationId = (id: string): boolean =>
  DIRECT_AGENT_CREATION_ID.test(id)
export const isForkAgentCreationId = (id: string): boolean =>
  FORK_AGENT_CREATION_ID.test(id)
export const isImportAgentCreationId = (id: string): boolean =>
  IMPORT_AGENT_CREATION_ID.test(id)
export const isAgentCreationId = (id: string): boolean =>
  isDirectAgentCreationId(id) || isForkAgentCreationId(id) || isImportAgentCreationId(id)
