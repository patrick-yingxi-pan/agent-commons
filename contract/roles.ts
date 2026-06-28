/** ── Contract: project roles (D14) ──────────────────────────────────────────
 *  GitHub-style roles on a shared Project. A Contributor's role sets a **permission
 *  baseline** — one more factor in the D8 cascade (role ∩ agent ∩ provider ∩
 *  project-admitted): it can only *tighten*, never widen, what the Agent already holds.
 *  Roles also form a lattice (`roleRank`) that ranks **acquisition-time** arbitration at
 *  the Guardian (owner-priority); a role never preempts an in-flight hold.
 *  See docs/agent-commons.md (D14). Imported verbatim by UI + server, so it stays
 *  framework- and Node-free. */

/** The role a Contributor plays on a Project — owner ⊃ maintainer ⊃ writer ⊃ reader. */
export const PROJECT_ROLES = ['owner', 'maintainer', 'writer', 'reader'] as const
export type ProjectRole = (typeof PROJECT_ROLES)[number]

/** The actions a role gates. `fire` = fire an irreversible (non-monotonic) effect;
 *  `reserve` = claim a sub-goal; `commission` = add other Contributors; `configure` =
 *  change Project config / instructions. */
export type ProjectAction = 'read' | 'write' | 'reserve' | 'fire' | 'commission' | 'configure'

/** The permission baseline per role (the D14 table). **Maintainer and writer share the
 *  same actions** — they differ only in `roleRank` (a maintainer outranks a writer in
 *  acquisition-time arbitration), not in what they may do. Owner alone may commission and
 *  configure; reader is read-only. */
const ROLE_ACTIONS: Record<ProjectRole, ReadonlySet<ProjectAction>> = {
  reader: new Set(['read']),
  writer: new Set(['read', 'write', 'reserve', 'fire']),
  maintainer: new Set(['read', 'write', 'reserve', 'fire']),
  owner: new Set(['read', 'write', 'reserve', 'fire', 'commission', 'configure']),
}

/** Does `role` permit `action` on its Project? Pure + shared (like `overAuthority`), so the
 *  client can pre-check and the server enforces authoritatively. */
export function rolePermits(role: ProjectRole, action: ProjectAction): boolean {
  return ROLE_ACTIONS[role].has(action)
}

/** The role lattice as a rank — higher wins a *free or contested* sub-goal lease
 *  (owner-priority, D14); equal ranks stay first-come; no rank ever preempts an in-flight
 *  hold. owner 3 > maintainer 2 > writer 1 > reader 0. */
export function roleRank(role: ProjectRole): number {
  return PROJECT_ROLES.length - 1 - PROJECT_ROLES.indexOf(role)
}
