import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { DEFAULT_PROVIDER_ID, type ModelProvider } from '../../contract/index.ts'
import {
  EFFORT_BLURBS,
  effortLevelsFor,
  modelBlurb,
  pickedModel,
  pickedProvider,
  resolveEffort,
  type ModelPick,
} from '../lib/models'
import { useProviders } from '../api'

/** ── The one provider→model→effort menu body (form follows function) ─────────
 *  Three surfaces pick a model — the composer's Model control, a routine's model
 *  picker, and Customize's "Default model" — and they must be the SAME menu,
 *  driven entirely by the live provider registry (Models section, D9): a
 *  **Provider** section (the registry rows), a **Model** section (the *selected
 *  provider's own catalog* — `ModelProvider.models`, fetched from its endpoint's
 *  list API), and an **Effort** section (the model's own levels, falling back to
 *  the provider's vocabulary). No hard-coded catalog anywhere — the default
 *  provider's models are registry rows like any other's (locked by
 *  tests/model-picker.test.ts). Each caller owns its popover chrome + what a pick
 *  *means* (session wiring, a stored routine label, a persisted preference).
 *  Every metadata field is provider-sourced and optional: a provider that can't
 *  enumerate models says so honestly instead of fabricating rows. */

/** One selectable row — shared by providers and models, so the two levels read
 *  as one control. Without `onSelect` it renders as a read-only listing (a
 *  surface with nowhere to write the pick shows the catalog without claiming a
 *  control that would silently no-op). */
function PickRow({
  active,
  name,
  blurb,
  trailing,
  onSelect,
}: {
  active: boolean
  name: string
  blurb: ReactNode
  trailing?: ReactNode
  onSelect?: () => void
}) {
  return (
    <button
      onClick={onSelect}
      disabled={!onSelect}
      className={`flex w-full items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition ${
        active ? 'bg-panel-2' : onSelect ? 'hover:bg-panel-2/60' : ''
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          active ? 'border-co-solid bg-co-solid text-on-solid' : 'border-line-strong'
        }`}
      >
        {active && <Check size={11} strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
          {name}
          {trailing}
        </span>
        <span className="block text-[11px] leading-snug text-ink-faint">{blurb}</span>
      </span>
    </button>
  )
}

/** A session-kind provider's liveness dot — green while a drain loop is bound. */
export function OnlineDot({ online }: { online?: boolean }) {
  return (
    <span
      title={online ? 'Session connected' : 'Offline — drain loop not running'}
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${online ? 'bg-added' : 'bg-ink-faint/50'}`}
    />
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
      {children}
    </div>
  )
}

/** A provider row's caption — its nature, from its own registry entry. */
function providerBlurb(p: ModelProvider): string {
  if (p.kind === 'session') return 'Your own AI session answers — tool calls relayed through it.'
  const count = p.models?.length
  return count ? `${count} model${count === 1 ? '' : 's'} from its catalog.` : 'Endpoint-configured model (no catalog).'
}

export function ModelPickerMenu({
  pick,
  effort,
  onPickModel,
  onPickEffort,
  onPickProvider,
  children,
}: {
  /** The active two-level selection (absences inherit — see lib/models). */
  pick: ModelPick
  /** The stored effort preference (a label; resolved against the live vocabulary). */
  effort?: string
  /** A model row was chosen — carries the full pick (provider + model). Absent =
   *  the pick has nowhere to write on this surface; the catalog renders read-only. */
  onPickModel?: (pick: Required<Pick<ModelPick, 'modelId'>> & ModelPick) => void
  onPickEffort: (effort: string) => void
  /** A provider row was chosen (undefined = the default provider). Absent =
   *  provider switching isn't available on this surface (e.g. a session whose
   *  server row hasn't resolved yet has nowhere to write the pick) — the section
   *  is omitted rather than rendering rows that silently no-op. */
  onPickProvider?: (providerId?: string) => void
  /** Caller extras rendered below the effort section while the default provider
   *  is active (the composer's orthogonal-mode toggles). */
  children?: ReactNode
}) {
  // The live registry — a provider minted in the Models section is immediately in
  // every picker (the registry cache refreshes on provider events).
  const providers = useProviders().data ?? []
  const provider = pickedProvider(providers, pick)
  const activeModel = pickedModel(provider, pick)
  const catalog = provider?.kind === 'session' ? [] : provider?.models ?? []
  const levels = effortLevelsFor(provider, activeModel)
  const activeEffort = resolveEffort(levels, effort)
  const onDefaultProvider = (provider?.id ?? DEFAULT_PROVIDER_ID) === DEFAULT_PROVIDER_ID

  return (
    <>
      {/* Provider — the registry (D9). One row per cognition source. */}
      {onPickProvider && providers.length > 1 && (
        <div className="px-2 pt-2">
          <SectionLabel>Provider</SectionLabel>
          {providers.map((p) => (
            <PickRow
              key={p.id}
              active={p.id === (provider?.id ?? DEFAULT_PROVIDER_ID)}
              name={p.label}
              blurb={
                p.kind === 'session' && !p.online
                  ? `${providerBlurb(p)} Offline — start its drain loop.`
                  : providerBlurb(p)
              }
              trailing={p.kind === 'session' ? <OnlineDot online={p.online} /> : undefined}
              onSelect={() => onPickProvider(p.id === DEFAULT_PROVIDER_ID ? undefined : p.id)}
            />
          ))}
        </div>
      )}

      {/* Model — the SELECTED provider's own catalog. */}
      <div className="px-2 pt-2">
        <SectionLabel>Model</SectionLabel>
        {catalog.map((m) => (
          <PickRow
            key={m.id}
            active={m.id === activeModel?.id}
            name={m.label}
            blurb={modelBlurb(m)}
            onSelect={
              onPickModel &&
              (() =>
                onPickModel({ ...(provider && provider.id !== DEFAULT_PROVIDER_ID ? { providerId: provider.id } : {}), modelId: m.id }))
            }
          />
        ))}
        {catalog.length === 0 && (
          <p className="px-1.5 pb-1 text-[11px] leading-snug text-ink-soft">
            {provider?.kind === 'session'
              ? 'Whatever model your connected session runs — the provider can’t enumerate it.'
              : 'This provider doesn’t list models — turns run its configured model.'}
          </p>
        )}
      </div>

      <div className="my-1.5 border-t border-line" />

      {/* Effort — the vocabulary the picked model (or its provider) declares. */}
      {levels.length > 0 && (
        <div className="px-3 pb-2">
          <div className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Effort
          </div>
          <div className="flex gap-1 rounded-lg bg-panel-2 p-0.5">
            {levels.map((level) => {
              const active = level === activeEffort
              return (
                <button
                  key={level}
                  onClick={() => onPickEffort(level)}
                  className={`flex-1 rounded-md px-1 py-1 text-[12px] font-medium transition ${
                    active
                      ? 'bg-surface text-ink ring-1 ring-line-strong'
                      : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  {level}
                </button>
              )
            })}
          </div>
          {activeEffort && EFFORT_BLURBS[activeEffort] && (
            <p className="mt-1.5 text-[11px] leading-snug text-ink-soft">{EFFORT_BLURBS[activeEffort]}</p>
          )}
        </div>
      )}
      {levels.length === 0 && (
        <p className="px-3 pb-2 text-[11px] leading-snug text-ink-soft">
          {provider?.kind === 'session'
            ? 'This provider declares no effort levels — your own session answers its turns.'
            : activeModel
              ? 'This model runs at a single effort — no levels to pick.'
              : 'This provider declares no effort levels.'}
        </p>
      )}

      {onDefaultProvider && children}
    </>
  )
}
