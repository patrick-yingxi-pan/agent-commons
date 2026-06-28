/** One-line summaries for the Agent-Commons concepts (docs/agent-commons.md), shared
 *  so every surface that names a grant or a plan reads identically — the composer
 *  gauges and the Agents management views speak the same words (form follows
 *  function: same fact, same phrasing, one source). */
import { formatTokens, type Authority, type ModelProvider } from '../../contract/index.ts'

/** A one-line summary of an authority grant (D8) — "all X" when a dimension is
 *  unrestricted (absent or '*'), the count when concrete, "no X" when empty. */
export function authorityLabel(a?: Authority): string {
  const dim = (grant: string[] | undefined, noun: string) =>
    !grant || grant.includes('*') ? `all ${noun}` : grant.length ? `${grant.length} ${noun}` : `no ${noun}`
  return `${dim(a?.tools, 'tools')} · ${dim(a?.connectors, 'connectors')} · ${dim(a?.scopes, 'scopes')}`
}

/** A provider's plan summary (D8 cascade root) — its window ceilings, or a note that
 *  it inherits the account plan when it declares none. */
export function providerPlanLabel(provider: ModelProvider): string {
  return provider.plan
    ? provider.plan.windows.map((w) => `${formatTokens(w.ceiling)} ${w.label}`).join(' · ')
    : 'Inherits account plan'
}
