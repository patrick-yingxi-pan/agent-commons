/** The Agent that drove a recorded turn, distinct from its model provenance.
 * Current registry labels decorate exact IDs; missing or unavailable drivers
 * never imply a particular vendor. */

/** The seed id of the account's default worker Agent (server/data/workers.ts). */
export const DEFAULT_AGENT_ID = 'agent-default'

export function driverByline(
  agentId: string | undefined,
  agents: readonly { id: string; label: string }[],
): string {
  return agents.find((a) => a.id === agentId)?.label ?? 'Assistant'
}
