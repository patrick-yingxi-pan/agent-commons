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

/** ── Invalid registry reference (server) ─────────────────────────────────────
 *  Raised when a mutation names a registry reference that is missing, empty, or
 *  unknown — e.g. minting an Agent without a provider or system prompt. The store
 *  refuses instead of resolving to a default (default-flagged entries are a UI
 *  pre-selection shortcut, never an API fallback — a missing binding should surface
 *  as a bug at the call site, not as a surprising resolution later). Its `code` is
 *  the `ApiErrorCode` 'bad_request', so a route surfaces it verbatim as a 400. */
export class ValidationError extends Error {
  readonly code: 'bad_request'
  constructor(message: string) {
    super(message)
    this.code = 'bad_request'
    this.name = 'ValidationError'
  }
}

/** Missing and unreadable references share one existence-hiding response. */
export class NotFoundError extends Error {
  readonly code = 'not_found' as const
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}
