import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, Workflow, Zap } from 'lucide-react'
import { EFFORTS, MODELS, providerModelOptions } from '../lib/models'
import { loadModelPrefs, saveModelPrefs, type ModelPrefs } from '../lib/modelPrefs'
import { useProviders } from '../api'
import { useDismissable } from '../lib/useDismissable'
import { POPOVER_SURFACE } from '../lib/popover'
import { usePopoverShift } from '../lib/usePopoverShift'
import { ModelPickerMenu, OnlineDot } from './ModelPickerMenu'

/** The composer's model/effort config — the shared "default model" preference
 *  (lib/modelPrefs), so the Customize page edits the same setting. The MODEL list
 *  itself renders through the shared ModelPickerMenu (built-in trio + the live
 *  provider registry); what a pick MEANS here is session wiring — a provider row
 *  writes `session.providerId` through `onSelectProvider`. */
type Config = ModelPrefs

/** An orthogonal on/off mode (Ultracode, Fast output) — visually distinct from
 *  the effort ladder to signal it's a different axis, combinable with any level. */
function ToggleRow({
  icon,
  title,
  subtitle,
  hint,
  on,
  disabled,
  onToggle,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  hint?: string
  on: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={() => !disabled && onToggle()}
      disabled={disabled}
      title={hint}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition enabled:hover:bg-panel-2/60 disabled:opacity-45"
    >
      <span className={on ? 'text-accent' : 'text-ink-faint'}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink">{title}</span>
        <span className="block text-[11px] leading-snug text-ink-faint">{subtitle}</span>
      </span>
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition ${
          on ? 'bg-accent' : 'bg-line-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${
            on ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  )
}

export function ModelEffortControl({
  providerId,
  onSelectProvider,
}: {
  /** The open session's model pick (`session.providerId`) — undefined = the
   *  built-in Claude models (the default provider). */
  providerId?: string
  /** Write the pick through to the session (undefined clears to default). */
  onSelectProvider?: (providerId?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState<Config>(loadModelPrefs)
  const wrapRef = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const popRef = usePopoverShift<HTMLDivElement>(open)

  const registered = providerModelOptions(useProviders().data ?? [])
  const picked = providerId ? registered.find((o) => o.providerId === providerId) : undefined

  const { modelId, effort, ultracode, fast } = config
  const update = (patch: Partial<Config>) => setConfig((c) => ({ ...c, ...patch }))

  const model = MODELS.find((m) => m.id === modelId)!
  const effortMeta = EFFORTS.find((e) => e.id === effort)!

  // Remember the last-used config as the default (shared with the Customize page).
  useEffect(() => {
    saveModelPrefs(config)
  }, [config])

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition ${
          open ? 'bg-panel-2 text-ink' : 'text-ink-soft hover:bg-panel-2'
        }`}
        title="Model & effort"
        aria-label="Model and effort"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {/* Orthogonal modes, when on, show as icons to the left so the
            model/effort text stays put next to the usage button. */}
        {!picked && ultracode && (
          <span title="Ultracode — multi-agent workflow" className="flex items-center text-accent">
            <Workflow size={14} />
          </span>
        )}
        {!picked && fast && model.isOpus && (
          <span title="Fast output" className="flex items-center text-accent">
            <Zap size={14} />
          </span>
        )}
        {picked?.kind === 'session' && <OnlineDot online={picked.online} />}
        <span className="max-w-[160px] truncate text-ink">
          {picked ? picked.name : `${model.short} · ${effortMeta.label}`}
        </span>
        <ChevronDown size={13} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Model and effort"
          className={`absolute bottom-full right-0 z-20 mb-2 w-[320px] overflow-hidden ${POPOVER_SURFACE}`}
        >
          <ModelPickerMenu
            modelId={modelId}
            effort={effort}
            providerId={providerId}
            onPickModel={(m) => {
              update({ modelId: m.id, ...(m.isOpus ? {} : { fast: false }) })
              // A Claude pick clears any provider override on the session.
              if (providerId) onSelectProvider?.(undefined)
            }}
            onPickEffort={(e) => update({ effort: e })}
            // No write-through (a synthesized run session) ⇒ no provider section.
            onPickProvider={onSelectProvider && ((o) => onSelectProvider(o.providerId))}
          >
            <div className="border-t border-line" />
            {/* Orthogonal modes — independent of the effort level above */}
            <ToggleRow
              icon={<Workflow size={15} />}
              title="Ultracode"
              subtitle="Run as a multi-agent workflow — combines with any effort"
              hint="An orthogonal mode, independent of the effort level above. Ultracode changes how the turn runs — fanning it out into a multi-agent workflow — and can be combined with any effort level."
              on={ultracode}
              onToggle={() => update({ ultracode: !ultracode })}
            />
            <ToggleRow
              icon={<Zap size={15} />}
              title="Fast output"
              subtitle={model.isOpus ? 'Opus, with faster streaming' : 'Available on Opus models'}
              hint="An orthogonal mode, independent of the effort level above. Fast output speeds up Opus token streaming and can be combined with any effort level."
              on={fast && model.isOpus}
              disabled={!model.isOpus}
              onToggle={() => update({ fast: !fast })}
            />
          </ModelPickerMenu>
        </div>
      )}
    </div>
  )
}
