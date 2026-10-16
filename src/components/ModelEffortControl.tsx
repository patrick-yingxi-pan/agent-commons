import { useState, type ReactNode } from 'react'
import { ChevronDown, Workflow, Zap } from 'lucide-react'
import {
  displayModelLabel,
  effortLevelsFor,
  isOpusModel,
  pickedModel,
  pickedProvider,
  resolveEffort,
  type ModelPick,
} from '../lib/models'
import type { ModelPrefs } from '../lib/modelPrefs'
import { COMPOSER_MODEL_LAYOUT } from '../lib/composerLayout'
import { updateModelPreferences, useModelPreferences } from '../controller/modelPreferences'
import { useProviders } from '../api'
import { useDismissable } from '../lib/useDismissable'
import { POPOVER_SURFACE } from '../lib/popover'
import { usePopoverShift } from '../lib/usePopoverShift'
import { ModelPickerMenu, OnlineDot } from './ModelPickerMenu'

/** The composer's model/effort config. The list renders through the shared
 *  ModelPickerMenu — provider → model → effort, all sourced from the live
 *  registry (each provider's own catalog) — and what a pick MEANS here is
 *  session wiring: both levels write the session row (`providerId` + `modelId`)
 *  through `onSelectModel`, so the turn genuinely routes there. The same pick is
 *  mirrored through the personal model-preference controller, so Customize
 *  edits the same server-durable, user-and-workspace-scoped setting. */
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
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-surface ring-1 ring-line-strong transition-all ${
            on ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  )
}

export function ModelEffortControl({
  pick,
  onSelectModel,
}: {
  /** The open session's two-level pick (`session.providerId` + `session.modelId`)
   *  — absences inherit (the default provider / its configured model). */
  pick?: ModelPick
  /** Write the pick through to the session (absences clear back to inherit). */
  onSelectModel?: (pick: ModelPick) => void
}) {
  const [open, setOpen] = useState(false)
  const { preferences: config, held } = useModelPreferences()
  const wrapRef = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const popRef = usePopoverShift<HTMLDivElement>(open)

  const providers = useProviders().data ?? []
  const provider = pickedProvider(providers, pick)
  const model = pickedModel(provider, pick)
  const levels = effortLevelsFor(provider, model)

  const { ultracode, fast } = config
  const effort = resolveEffort(levels, config.effort)
  const update = (patch: Partial<Config>) => { void updateModelPreferences(patch) }
  const onDefaultProvider = !pick?.providerId
  const opus = isOpusModel(model?.id)

  return (
    <div ref={wrapRef} className={COMPOSER_MODEL_LAYOUT.picker}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`${COMPOSER_MODEL_LAYOUT.trigger} flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium transition ${
          open ? 'bg-panel-2 text-ink' : 'text-ink-soft hover:bg-panel-2'
        }`}
        title="Model & effort"
        aria-label="Model and effort"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {/* Orthogonal modes, when on, show as icons to the left so the
            model/effort text stays put next to the usage button. */}
        {onDefaultProvider && ultracode && (
          <span title="Ultracode — multi-agent workflow" className="flex items-center text-accent">
            <Workflow size={14} />
          </span>
        )}
        {onDefaultProvider && fast && opus && (
          <span title="Fast output" className="flex items-center text-accent">
            <Zap size={14} />
          </span>
        )}
        {provider?.kind === 'session' && <OnlineDot online={provider.online} />}
        <span className="max-w-[160px] truncate text-ink">
          {displayModelLabel(providers, pick, onDefaultProvider ? effort : undefined)}
        </span>
        <ChevronDown size={13} className={`shrink-0 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Model and effort"
          className={`absolute bottom-full right-0 z-20 mb-2 w-[320px] overflow-hidden ${POPOVER_SURFACE}`}
        >
          <ModelPickerMenu
            disabled={held}
            pick={pick ?? {}}
            effort={config.effort}
            // Both pick levels are gated on the write path together: with no
            // server row to write (onSelectModel absent) the rows render
            // read-only, and the shared default-model preference isn't silently
            // rewritten by a click that visibly does nothing.
            onPickModel={onSelectModel && ((next) => {
              update({ providerId: next.providerId, modelId: next.modelId, ...(isOpusModel(next.modelId) ? {} : { fast: false }) })
              onSelectModel(next)
            })}
            onPickEffort={(e) => update({ effort: e })}
            onPickProvider={onSelectModel && ((providerId) => {
              update({ providerId, modelId: undefined })
              onSelectModel({ providerId })
            })}
          >
            <div className="border-t border-line" />
            {/* Orthogonal modes — independent of the effort level above */}
            <ToggleRow
              icon={<Workflow size={15} />}
              title="Ultracode"
              subtitle="Run as a multi-agent workflow — combines with any effort"
              hint="An orthogonal mode, independent of the effort level above. Ultracode changes how the turn runs — fanning it out into a multi-agent workflow — and can be combined with any effort level."
              on={ultracode}
              disabled={held}
              onToggle={() => update({ ultracode: !ultracode })}
            />
            <ToggleRow
              icon={<Zap size={15} />}
              title="Fast output"
              subtitle={opus ? 'Opus, with faster streaming' : 'Available on Opus models'}
              hint="An orthogonal mode, independent of the effort level above. Fast output speeds up Opus token streaming and can be combined with any effort level."
              on={fast && opus}
              disabled={held || !opus}
              onToggle={() => update({ fast: !fast })}
            />
          </ModelPickerMenu>
        </div>
      )}
    </div>
  )
}
