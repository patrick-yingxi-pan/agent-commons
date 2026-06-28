/** ── Contract: budgets (the D8 attenuation cascade — quota face) ─────────────
 *  A token budget: a ceiling per rolling window. The quota face of the D8
 *  attenuation cascade (docs/agent-commons.md): *provider plan ⊇ agent budget ⊇
 *  commission grant*, where "⊇" means **no window's ceiling exceeds its parent's**.
 *  Enforced at the single creation funnel — an over-grant is unrepresentable at
 *  mint — not per-turn. Authority attenuation (tools / connectors / scope) is the
 *  larger D8 story and a later slice; this is the token quota. */

export interface BudgetWindow {
  /** The rolling window this ceiling applies to — keyed to a plan window's label
   *  (server/usage.ts), the identity that aligns a child ceiling with its parent. */
  label: string
  /** The token ceiling for this window. Must not exceed the parent's. */
  ceiling: number
}

export interface Budget {
  /** Per-window token ceilings. An omitted window inherits the parent (no tighter
   *  cap there). */
  windows: BudgetWindow[]
}

/** The D8 subset check — the pure heart of the creation funnel, shared so the
 *  client can pre-validate and the server can enforce authoritatively. Returns the
 *  first child window that *breaks* attenuation (exceeds its parent's ceiling, or
 *  names a window the parent doesn't have), or `null` when `child` is a valid
 *  attenuation of `parent`. */
export function overBudgetWindow(parent: BudgetWindow[], child: Budget): BudgetWindow | null {
  for (const w of child.windows) {
    const p = parent.find((x) => x.label === w.label)
    if (!p || w.ceiling > p.ceiling) return w
  }
  return null
}

/** Re-clamp a child budget to (possibly newly-narrowed) parent windows — the **runtime
 *  half of D8** for the quota face: each child window's ceiling is capped at its parent's
 *  same-label window. A window the parent no longer has is left as-is (the labels are a
 *  fixed plan vocabulary). Idempotent — a child already ⊆ parent is returned unchanged. */
export function clampBudget(child: Budget, parent: BudgetWindow[]): Budget {
  return {
    windows: child.windows.map((w) => {
      const p = parent.find((x) => x.label === w.label)
      return p && w.ceiling > p.ceiling ? { ...w, ceiling: p.ceiling } : w
    }),
  }
}
