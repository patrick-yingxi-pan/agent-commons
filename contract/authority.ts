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

/** Whether a grant covers everything on its dimension (`'*'` or absent) — the single
 *  definition of "unrestricted", shared so the sentinel can't drift between callers. */
export function unrestricted(grant?: string[]): boolean {
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

/** The intersection of two grants on one dimension. An unrestricted side ('*' or
 *  absent) lets the *other* side govern; two concrete sets intersect; both
 *  unrestricted stays unrestricted (`undefined`). This is the **clamp** D12 uses to
 *  bound a commissioned Agent to a Project's admitted set: `intersect(agent, project)`
 *  with the agent unrestricted yields exactly the Project's set — default-deny on
 *  anything the Project doesn't admit, regardless of what the Agent was granted. */
function intersectDimension(x: string[] | undefined, y: string[] | undefined): string[] | undefined {
  const xAll = unrestricted(x)
  const yAll = unrestricted(y)
  if (xAll && yAll) return undefined // both unrestricted → still unrestricted
  if (xAll) return y
  if (yAll) return x
  const ys = new Set(y)
  return x!.filter((v) => ys.has(v))
}

/** The pairwise intersection of two authority grants — `a ∩ b` on every dimension.
 *  Pure + shared (D12): the effective authority a commissioned Agent carries onto a
 *  Project is `intersectAuthority(what-the-agent-was-granted, what-the-Project-admits)`. */
export function intersectAuthority(a: Authority, b: Authority): Authority {
  const result: Authority = {}
  for (const dim of DIMENSIONS) {
    const v = intersectDimension(a[dim], b[dim])
    if (v !== undefined) result[dim] = v
  }
  return result
}

/** Whether a grant admits a specific `target` on one dimension — `true` when the grant
 *  is unrestricted there ('*' / absent) or explicitly lists the target. The membership
 *  side of the D12 mediation check: an effect's target is allowed iff the commission's
 *  *effective* (Project-clamped) authority admits it. */
export function authorityAdmits(authority: Authority, dimension: AuthorityViolation['dimension'], target: string): boolean {
  const grant = authority[dimension]
  return unrestricted(grant) || grant!.includes(target)
}

/** Re-clamp a child grant to a (possibly newly-narrowed) parent — the **runtime half of
 *  D8**: after a parent shrinks, an already-minted child must not stay over-grant. Only the
 *  dimensions the child sets **explicitly** are tightened (an inherited / unrestricted dim
 *  already follows the parent down, so it is left alone); each explicit value the parent no
 *  longer admits is dropped. Idempotent — a child already ⊆ parent is returned unchanged. */
export function clampAuthority(child: Authority, parent: Authority): Authority {
  const result: Authority = { ...child }
  for (const dim of DIMENSIONS) {
    const grant = child[dim]
    if (unrestricted(grant)) continue // inherited / '*' — follows the parent, nothing to clamp
    result[dim] = grant!.filter((v) => authorityAdmits(parent, dim, v))
  }
  return result
}
