/** ── The D8 authority funnel (server) ────────────────────────────────────────
 *  The throwing half of authority attenuation (docs/agent-commons.md, D8). The pure
 *  subset check (`overAuthority`) lives in the contract, shared with the client; this
 *  wraps it so the single creation funnel can reject an over-grant at mint. Lives in
 *  `server/` because it is a class (the contract stays erasable-TS only), mirroring its
 *  token-face siblings `BudgetError` / `mintBudget`, which live in `usage.ts`. */
import type { Authority } from '../contract/index.ts'
import { overAuthority } from '../contract/index.ts'

/** Raised by the creation funnel when a requested authority grant exceeds its parent —
 *  a 400-class error (the request named an impossible authority). */
export class AuthorityError extends Error {
  readonly code: 'authority_exceeded'
  constructor(message: string) {
    super(message)
    this.code = 'authority_exceeded'
    this.name = 'AuthorityError'
  }
}

/** Assert a requested authority grant is a subset of the parent's, rejecting an
 *  over-grant so it is unrepresentable at mint. Returns the grant unchanged when valid.
 *  An absent parent is unrestricted (the broad default a provider grants from). */
export function mintAuthority(parent: Authority | undefined, requested: Authority): Authority {
  const over = overAuthority(parent ?? {}, requested)
  if (over) {
    throw new AuthorityError(
      `authority for '${over.dimension}' grants [${over.values.join(', ')}] beyond the parent`,
    )
  }
  return requested
}
