/** The first-boot world installed into a genuinely absent persistence backend.
 *
 * Development defaults to the authored demo because the repository is also a
 * proposal reviewers need to evaluate. Release profiles explicitly select the
 * clean world. Once written, the store snapshot owns this choice; this resolver
 * is never consulted while an existing database is being rehydrated.
 */
export type InitialWorld = 'demo' | 'clean'

export function resolveInitialWorld(raw: string | undefined = process.env.INITIAL_WORLD): InitialWorld {
  const value = raw?.trim().toLowerCase() || 'demo'
  if (value === 'demo' || value === 'clean') return value
  throw new Error(`INITIAL_WORLD must be demo or clean; received "${raw}".`)
}
