/** ── Registry-management conflict (server) ───────────────────────────────────
 *  Raised when a registry resource (a provider / system prompt / agent) can't be
 *  mutated because something still depends on it, or it's a protected seed the system
 *  resolves to (the default provider / agent). The deletion-time analog of the cascade's
 *  creation-time guards (`BudgetError` / `AuthorityError`): its `code` is the
 *  `ApiErrorCode` 'conflict', so a route surfaces it verbatim as a 409 and the user
 *  re-targets (e.g. re-points the Agents off a provider before removing it). Lives in
 *  `server/` because it is a class (the contract stays erasable-TS only). */
export class ConflictError extends Error {
  readonly code: 'conflict'
  constructor(message: string) {
    super(message)
    this.code = 'conflict'
    this.name = 'ConflictError'
  }
}
