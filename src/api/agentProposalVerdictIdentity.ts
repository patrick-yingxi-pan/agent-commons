/** Browser twin of the server's durable Agent-proposal verdict receipt. */
export async function agentProposalVerdictId(
  tenantId: string,
  agentId: string,
  proposalId: string,
  idempotencyKey: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${tenantId}\0${agentId}\0${proposalId}\0${idempotencyKey}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `agent-proposal-verdict-${[...digest].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
