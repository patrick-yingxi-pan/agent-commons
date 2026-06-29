/** ── Contract: the detective audit trail (docs/agent-commons.md, D15 / OQ7) ──────
 *  A server-side, append-only record of effects on the **cross-user channels** — the
 *  agent-to-agent proxy (D15), a guarded Project effect (D11/D12), and a commissioned
 *  host invoke. Settled **detective-audit-only — no provenance taint engine**: this is a
 *  best-effort *backstop* to the attenuation wall (D12), not a guarantee. It records
 *  *attempts*, not just successes (a denied proxy is exactly what a watcher wants to see),
 *  so `outcome` is part of every entry. Pure types + a pure summary; the store mints the
 *  id + stamps `at` (its own clock), keeping this erasable. */

/** The three cross-user channels an entry can come from. A const array so the store +
 *  UI iterate it and a `never` switch stays exhaustive as channels are added. */
export const AUDIT_CHANNELS = ['proxy', 'project-effect', 'host-invoke'] as const
export type AuditChannel = (typeof AUDIT_CHANNELS)[number]

/** Whether the effect was performed or refused — the detective signal. */
export type AuditOutcome = 'fulfilled' | 'denied'

export interface AuditEntry {
  id: string
  /** Which cross-user channel produced the effect (D15 proxy / Project effect / host). */
  channel: AuditChannel
  /** The Agent that performed the effect — the proxy's *acting* Agent (B), when known.
   *  Absent on a commission-attributed channel where only the Commission is named. */
  actorAgentId?: string
  /** The Commission the effect was attributed to (Project-effect / host-invoke), when known. */
  commissionId?: string
  /** The capability / effect type (e.g. `connector.read`, `fs.write`, `mcp.query`). */
  capability: string
  /** The resource target (a connector name, a file path, …). */
  target: string
  /** Performed or refused — recorded either way (detective audit watches attempts). */
  outcome: AuditOutcome
  /** When it happened (epoch ms), stamped by the server's clock. */
  at: number
}

/** Human-readable channel labels (UI + the pure summary). */
export const AUDIT_CHANNEL_LABEL: Record<AuditChannel, string> = {
  proxy: 'agent-to-agent proxy',
  'project-effect': 'Project effect',
  'host-invoke': 'host capability',
}

/** A one-line description of an audit entry — the detective watch, in words. Pure, so the
 *  UI row and any server-side log read the same sentence. */
export function summarizeAudit(e: AuditEntry): string {
  const actor = e.actorAgentId ?? e.commissionId ?? 'a Contributor'
  return `${AUDIT_CHANNEL_LABEL[e.channel]}: ${actor} ${e.outcome} ${e.capability} on '${e.target}'`
}
