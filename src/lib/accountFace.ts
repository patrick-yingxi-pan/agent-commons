/** ── The SIGNED-IN account's face (chip · switcher · account picker) ─────────
 *  The private twin of `publicFace.ts`. That module answers "who owns this
 *  thing" for everyone; this one answers "which of my accounts is this" for the
 *  one person looking — the account chip in the rail footer, the switcher rows
 *  inside it, and the auth screen's picker. Three surfaces, one question, so
 *  one funnel (form follows function; locked by tests/account-face.test.ts).
 *
 *  It exists because of what FWD-5 Phase 2 did to identity: account and
 *  namespace collapsed 1:1, and since 2026-08-09 a seed namespace WEARS ITS
 *  PERSON'S NAME (server/accounts.ts). All three surfaces had been rendering
 *  `user.name` with `tenant.name` beside it — a pairing that only ever read as
 *  two facts because the seeds were misnamed after companies. Name the
 *  namespace honestly and the second line becomes "Ada Lovelace · Ada
 *  Lovelace": the duplication was always there, hidden by the lie.
 *
 *  So the rule is: **say the namespace only when it is not simply you.** */
import type { Tenant, User } from '../../contract/index.ts'

/** The secondary line under an account's display name: its EMAIL (the unique
 *  handle that actually distinguishes two stacked accounts), then the namespace
 *  — but only when the namespace is something other than the person themselves.
 *  Empty means there is genuinely nothing more to say than the name already
 *  said; callers render nothing rather than repeating it. */
export function accountSubtitle(user: Pick<User, 'name' | 'email'>, tenant: Pick<Tenant, 'name'> | undefined): string {
  const parts: string[] = []
  if (user.email) parts.push(user.email)
  if (tenant && tenant.name !== user.name) parts.push(tenant.name)
  return parts.join(' · ')
}
