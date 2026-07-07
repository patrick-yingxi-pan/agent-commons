/** ── The assistant turn's author byline (surface-audit S5) ──────────────────
 *  A turn carries the worker Agent that DROVE it (`message.agentId`), stamped per-turn
 *  so a D16 mid-thread hand-off is traceable — yet the thread rendered a constant
 *  'Claude', flattening authorship to a dead label. This resolves the byline from the
 *  turn's driver:
 *   - the DEFAULT agent (`agent-default`), an absent id (a user turn / legacy message),
 *     or an id that no longer resolves (a since-deleted agent) → 'Claude', so ordinary
 *     single-agent threads read exactly as before;
 *   - any OTHER worker Agent that drove the turn → its own label, so a hand-off shows
 *     who is speaking.
 *  Pure (ids + the live registry in, label out) so it's node-testable without a DOM. */

/** The seed id of the account's default worker Agent (server/data/workers.ts). A turn
 *  driven by it reads 'Claude', not its stored label ("Default agent"). */
export const DEFAULT_AGENT_ID = 'agent-default'

export function driverByline(
  agentId: string | undefined,
  agents: readonly { id: string; label: string }[],
): string {
  if (!agentId || agentId === DEFAULT_AGENT_ID) return 'Claude'
  return agents.find((a) => a.id === agentId)?.label ?? 'Claude'
}
