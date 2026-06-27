import { Cpu } from 'lucide-react'
import { useProviders } from '../api'
import { GaugePopover } from './GaugePopover'
import { formatTokens } from '../../contract/index.ts'
import type { Authority, ModelProvider } from '../../contract/index.ts'

/** A one-line summary of an authority grant (D8) — "all X" when a dimension is
 *  unrestricted (absent or '*'), else the count granted. */
function authorityLabel(a?: Authority): string {
  const dim = (grant: string[] | undefined, noun: string) =>
    !grant || grant.includes('*') ? `all ${noun}` : grant.length ? `${grant.length} ${noun}` : `no ${noun}`
  return `${dim(a?.tools, 'tools')} · ${dim(a?.connectors, 'connectors')} · ${dim(a?.scopes, 'scopes')}`
}

/** Providers button: an ambient indicator of the Model providers registered to this
 *  account (docs/agent-commons.md, D9) — the cognition sources an Agent binds. Like
 *  Runners, providers are a standing account fabric referenced by id, not attached as
 *  context, so this sits beside the Hosts gauge in the composer footer (the same
 *  styled primitive — same role, same look). Reads the live registry
 *  (`GET /v1/providers`). */
export function ProvidersControl() {
  // Server-owned: the UI just caches the registry snapshot.
  const providers = useProviders().data ?? []

  return (
    <GaugePopover
      icon={<Cpu size={15} className="text-ink-faint" />}
      count={providers.length}
      title={`Model providers — ${providers.length} registered`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-ink-faint">Model providers</span>
        <span className="text-[12px] text-ink">{providers.length} registered</span>
      </div>

      <div className="mt-2.5 space-y-2.5">
        {providers.length === 0 && (
          <p className="text-[12px] leading-snug text-ink-faint">
            No providers registered. A cognition source an Agent can run on appears here with
            the effort levels and plan it offers.
          </p>
        )}
        {providers.map((p) => (
          <ProviderRow key={p.id} provider={p} />
        ))}
      </div>

      <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-tight text-ink-faint">
        An Agent's cognition source — referenced by id, never attached as context.
      </p>
    </GaugePopover>
  )
}

function ProviderRow({ provider }: { provider: ModelProvider }) {
  // The plan is the cascade root (D8): an Agent's budget must attenuate it. The
  // seeded default declares none, inheriting the account plan.
  const planLabel = provider.plan
    ? provider.plan.windows.map((w) => `${formatTokens(w.ceiling)} ${w.label}`).join(' · ')
    : 'Inherits account plan'
  return (
    <div>
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-ink">{provider.label}</span>
        <span className="text-ink-faint">{provider.modelFamily}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {provider.effortLevels.map((e) => (
          <span key={e} className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint">
            {e}
          </span>
        ))}
      </div>
      <p className="mt-1 text-[10px] leading-tight text-ink-faint">Grants {authorityLabel(provider.authority)}</p>
      <p className="mt-0.5 text-[10px] leading-tight text-ink-faint">{planLabel}</p>
    </div>
  )
}
