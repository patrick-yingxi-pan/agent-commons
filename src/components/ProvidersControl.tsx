import { lazy, Suspense } from 'react'
import { Cpu } from 'lucide-react'
import { useProviders } from '../api'
import { GaugePopover } from './GaugePopover'
import { DeferredLoadBoundary } from './DeferredLoadBoundary'

const ProvidersControlBody = lazy(() => import('./ProvidersControlBody').then((module) => ({ default: module.ProvidersControlBody })))

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
      <DeferredLoadBoundary fallback={<ProviderDetailsError />}>
        <Suspense fallback={<p data-provider-details-loading role="status" className="text-[12px] text-ink-faint">Loading provider details…</p>}>
          <ProvidersControlBody providers={providers} />
        </Suspense>
      </DeferredLoadBoundary>
    </GaugePopover>
  )
}

function ProviderDetailsError() {
  return (
    <div data-provider-details-error role="alert" className="text-[12px] leading-snug text-ink-faint">
      <p>Couldn’t display provider details. Copy unsent workspace text before reloading.</p>
      <button type="button" className="mt-2 text-ink underline" onClick={() => window.location.reload()}>Reload provider details</button>
    </div>
  )
}
