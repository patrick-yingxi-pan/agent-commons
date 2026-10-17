import { authorityLabel, providerPlanLabel } from '../lib/agentCommonsLabels'
import type { ModelProvider } from '../../contract/index.ts'

/** Read-only registry details; the eager gauge owns count, opening and containment. */
export function ProvidersControlBody({ providers }: { providers: ModelProvider[] }) {
  return (
    <div data-provider-details>
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
    </div>
  )
}

function ProviderRow({ provider }: { provider: ModelProvider }) {
  // The plan is the cascade root (D8): an Agent's budget must attenuate it. The
  // seeded default declares none, inheriting the account plan.
  const planLabel = providerPlanLabel(provider)
  return (
    <div data-provider-details-row={provider.id}>
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
