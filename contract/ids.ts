/** ── Contract: id-derivation invariants ────────────────────────────────────
 *  A few pure id rules that the client AND the server must agree on byte-for-byte,
 *  because each side derives an id the other will recognize. Centralizing them
 *  here is what keeps the two backends interchangeable:
 *
 *  • `slug` / `repoIdForLabel` — the Add-context picker marks a repo "✓ Added" by
 *    deriving the *same* live-repo id the backend assigns on attach. If the two
 *    transforms drifted, the picker would mis-report. (See the recents/attach
 *    funnel.)
 *  • `runSessionId` — a scheduled run *is* an agent session; its id must be
 *    deterministic so a run stays openable/linkable across reloads and devices
 *    (the run-session back-link depends on resolving to a stable id). */

/** A stable, dedup-friendly id derived from a label. */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** The live-repo id for a repo's display label. One source of truth so the
 *  Add-context picker can tell whether a repo option is already attached (it
 *  derives the same id the backend assigns on attach). */
export function repoIdForLabel(label: string): string {
  return `repo-${slug(label)}`
}

/** The deterministic id for a scheduled run's synthesized session. */
export function runSessionId(taskId: string, runId: string): string {
  return `srun-${taskId}-${runId}`
}

/** Whether an id names a scheduled-run session (vs a normal saved session). */
export function isRunSessionId(id: string): boolean {
  return id.startsWith('srun-')
}
