async function opaqueAgentId(
  prefix: 'new' | 'fork' | 'import',
  tenantId: string,
  idempotencyKey: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${tenantId}\0${idempotencyKey}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const suffix = [...digest].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `agent-${prefix}-${suffix}`
}

/** Browser twin of the server's durable direct Agent-creation identity. */
export function agentCreationId(tenantId: string, idempotencyKey: string): Promise<string> {
  return opaqueAgentId('new', tenantId, idempotencyKey)
}

/** Browser twin of the server's durable Agent-fork identity. */
export function agentForkCreationId(tenantId: string, idempotencyKey: string): Promise<string> {
  return opaqueAgentId('fork', tenantId, idempotencyKey)
}

/** Browser twin of the server's durable Agent Card-import identity. */
export function agentImportCreationId(tenantId: string, idempotencyKey: string): Promise<string> {
  return opaqueAgentId('import', tenantId, idempotencyKey)
}
