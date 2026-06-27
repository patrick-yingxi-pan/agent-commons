/** ── Contract: authority (the D8 attenuation cascade — authority face) ────────
 *  The *primary* axis of the D8 cascade (docs/agent-commons.md): which **tools,
 *  connectors, and file-scopes** a principal may use. *provider ⊇ agent ⊇ commission*,
 *  enforced at the single creation funnel — an over-grant is unrepresentable at mint.
 *  This is object-capability attenuation: *you may delegate only a subset of the
 *  authority you hold*. Token spend (`budget.ts`) is the quota special-case riding the
 *  same machinery; **authority is where the security lives** — a connector you weren't
 *  granted can't be misused, where a tight token cap does not stop a misuse of one you
 *  were.
 *
 *  A dimension that is absent, or whose value includes the `'*'` sentinel, means
 *  **unrestricted** on that dimension (the broad default a provider grants from). A
 *  concrete list is exactly that set. */

export interface Authority {
  /** Tool names the principal may call (`server/model/tools.ts` `TOOL_NAMES`). Absent
   *  / `['*']` = unrestricted. */
  tools?: string[]
  /** Connector / MCP ids the principal may use. Absent / `['*']` = unrestricted. */
  connectors?: string[]
  /** File-scope roots the principal may touch (mirrors `AgentCapability.scopes`).
   *  Absent / `['*']` = unrestricted. */
  scopes?: string[]
}

/** The single dimension on which a child grant breaks attenuation. */
export interface AuthorityViolation {
  dimension: 'tools' | 'connectors' | 'scopes'
  /** The child values the parent does not grant (the over-reach) — `['*']` when the
   *  child claims unrestricted under a restricted parent. */
  values: string[]
}

const DIMENSIONS = ['tools', 'connectors', 'scopes'] as const

/** Whether a parent grant covers everything on its dimension. */
function unrestricted(grant?: string[]): boolean {
  return grant === undefined || grant.includes('*')
}

/** The D8 authority subset check — pure and shared (like `overBudgetWindow`), so the
 *  client can pre-validate and the server can enforce authoritatively. Returns the
 *  first dimension where the `child` claims authority the `parent` does not hold (the
 *  confused-deputy escalation D8 forbids), or `null` when `child ⊆ parent` on every
 *  dimension. A child dimension that is absent (inherits the parent) or that the parent
 *  grants unrestricted never violates. */
export function overAuthority(parent: Authority, child: Authority): AuthorityViolation | null {
  for (const dim of DIMENSIONS) {
    const childGrant = child[dim]
    if (childGrant === undefined) continue // the child makes no claim on this dimension
    if (unrestricted(parent[dim])) continue // the parent already grants everything here
    // Parent is restricted: the child may not claim '*', and every value must be held.
    if (childGrant.includes('*')) return { dimension: dim, values: ['*'] }
    const parentSet = new Set(parent[dim])
    const over = childGrant.filter((v) => !parentSet.has(v))
    if (over.length) return { dimension: dim, values: over }
  }
  return null
}
