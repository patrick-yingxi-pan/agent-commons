/** ── Resource-limit exceeded (server) ────────────────────────────────────────
 *  Raised when a fail-closed quota refuses a mutation: the D13 per-commissioner abuse
 *  cap (a Project already holds its maximum active Commissions). The acquisition-time
 *  analog of the cascade's other guards (`BudgetError` / `AuthorityError` /
 *  `ConflictError`): its `code` is the `ApiErrorCode` 'limit_exceeded', so a route
 *  surfaces it verbatim as a 429 and the caller backs off (un-commission first, or the
 *  owner raises the cap). Lives in `server/` because it is a class (the contract stays
 *  erasable-TS only). */
export class LimitError extends Error {
  readonly code: 'limit_exceeded'
  constructor(message: string) {
    super(message)
    this.code = 'limit_exceeded'
    this.name = 'LimitError'
  }
}
