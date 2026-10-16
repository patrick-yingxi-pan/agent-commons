import type { ReactNode } from 'react'
import { Workflow, Zap } from 'lucide-react'
import { isOpusModel } from '../lib/models'
import type { ModelPrefs } from '../lib/modelPrefs'

function ToggleRow({ icon, title, subtitle, hint, on, disabled, onToggle }: {
  icon: ReactNode; title: string; subtitle: string; hint: string
  on: boolean; disabled?: boolean; onToggle: () => void
}) {
  return <button onClick={() => !disabled && onToggle()} disabled={disabled} title={hint}
    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition enabled:hover:bg-panel-2/60 disabled:opacity-45">
    <span className={on ? 'text-accent' : 'text-ink-faint'}>{icon}</span>
    <span className="min-w-0 flex-1">
      <span className="block text-[13px] font-medium text-ink">{title}</span>
      <span className="block text-[11px] leading-snug text-ink-faint">{subtitle}</span>
    </span>
    <span className={`relative h-4 w-7 shrink-0 rounded-full transition ${on ? 'bg-accent' : 'bg-line-strong'}`}>
      <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-surface ring-1 ring-line-strong transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
    </span>
  </button>
}

/** Optional controls share the catalog's lazy boundary. */
export function ModelModeToggles({ config, update, modelId, disabled }: {
  config: ModelPrefs; update: (patch: Partial<ModelPrefs>) => void; modelId?: string; disabled?: boolean
}) {
  const opus = isOpusModel(modelId)
  return <>
    <div className="border-t border-line" />
    <ToggleRow icon={<Workflow size={15} />} title="Ultracode"
      subtitle="Run as a multi-agent workflow — combines with any effort"
      hint="An orthogonal mode, independent of the effort level above. Ultracode changes how the turn runs — fanning it out into a multi-agent workflow — and can be combined with any effort level."
      on={config.ultracode} disabled={disabled} onToggle={() => update({ ultracode: !config.ultracode })} />
    <ToggleRow icon={<Zap size={15} />} title="Fast output"
      subtitle={opus ? 'Opus, with faster streaming' : 'Available on Opus models'}
      hint="An orthogonal mode, independent of the effort level above. Fast output speeds up Opus token streaming and can be combined with any effort level."
      on={config.fast && opus} disabled={disabled || !opus} onToggle={() => update({ fast: !config.fast })} />
  </>
}
