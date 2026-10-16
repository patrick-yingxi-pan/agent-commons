import { useState } from 'react'
import { DEFAULT_PROVIDER_ID } from '../../contract/index.ts'
import { ChevronDown } from 'lucide-react'
import {
  displayModelLabel,
  effortLevelsFor,
  pickedModel,
  pickedProvider,
  resolveEffort,
  type ModelPick,
} from '../lib/models'
import { COMPOSER_MODEL_LAYOUT } from '../lib/composerLayout'
import { updateModelPreferences, useModelPreferences } from '../controller/modelPreferences'
import { useProviders, useAgents } from '../api'
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
export function ModelEffortControl({
  pick,
  agentId,
  onSelectAgent,
  onSelectModel,
}: {
  /** The open session's two-level pick (`session.providerId` + `session.modelId`)
   *  — absences inherit (the default provider / its configured model). */
  pick?: ModelPick
  agentId?: string
  onSelectAgent?: (agentId: string) => void
  /** Write the pick through to the session (absences clear back to inherit). */
  onSelectModel?: (pick: ModelPick) => void
}) {
  const [open, setOpen] = useState(false)
  const { preferences: config, held } = useModelPreferences()
  const wrapRef = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const popRef = usePopoverShift<HTMLDivElement>(open)

  const providers = useProviders().data ?? []
  const provider = pickedProvider(providers, pick)
  const agent = (useAgents().data ?? []).find((candidate) => candidate.id === agentId)
  const model = pickedModel(provider, pick)
  const levels = effortLevelsFor(provider, model)

  const effort = resolveEffort(levels, config.effort)
  const onDefaultProvider = (pick?.providerId ?? DEFAULT_PROVIDER_ID) === DEFAULT_PROVIDER_ID
  const label = `${agentId && agentId !== 'agent-default' ? `${agent?.label ?? 'Unavailable Agent'} · ` : ''}${displayModelLabel(providers, pick, onDefaultProvider ? effort : undefined)}`

  return (
    <div ref={wrapRef} className={COMPOSER_MODEL_LAYOUT.picker}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`${COMPOSER_MODEL_LAYOUT.trigger} flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium transition ${
          open ? 'bg-panel-2 text-ink' : 'text-ink-soft hover:bg-panel-2'
        }`}
        title={`Agent, model & effort: ${label}`}
        aria-label="Model and effort"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {provider?.kind === 'session' && <OnlineDot online={provider.online} />}
        <span className="max-w-[160px] truncate text-ink">
          {label}
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
            agentControl={agentId ? { agentId, onSelect: onSelectAgent } : undefined}
            personalPreferences={{ update: updateModelPreferences, onSelectModel }}
            pick={pick ?? {}}
            effort={config.effort}
          />
        </div>
      )}
    </div>
  )
}
