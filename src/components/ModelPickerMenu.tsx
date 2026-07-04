import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { EFFORTS, MODELS, providerModelOptions, type Effort, type ModelId, type ProviderModelOption } from '../lib/models'
import { useProviders } from '../api'

/** ── The one model+effort menu body (form follows function) ──────────────────
 *  Three surfaces pick a model — the composer's Model control, a routine's model
 *  picker, and Customize's "Default model" — and they must be the SAME menu: the
 *  built-in Claude trio plus **every registered Model provider** from the live
 *  registry (Models section, D9), never a hard-coded mirror that drifts. Each
 *  caller owns its popover chrome + what a pick *means* (session wiring, a stored
 *  routine label, a persisted preference); this component owns the list and the
 *  effort section, so a provider registered once is pickable everywhere at once.
 *  Locked by tests/model-picker.test.ts: the built-in catalog renders only here. */

/** One selectable model row — shared by the built-in trio and the registered
 *  providers, so both halves of the list read as one control. */
function ModelRow({
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
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition ${
        active ? 'bg-panel-2' : 'hover:bg-panel-2/60'
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          active ? 'border-accent bg-accent text-white' : 'border-line-strong'
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

export function ModelPickerMenu({
  modelId,
  effort,
  providerId,
  onPickModel,
  onPickEffort,
  onPickProvider,
  children,
}: {
  /** The built-in selection (shown active only while no provider is picked). */
  modelId: ModelId
  effort: Effort
  /** The picked registered provider, if any — undefined = the built-in trio. */
  providerId?: string
  onPickModel: (m: (typeof MODELS)[number]) => void
  onPickEffort: (e: Effort) => void
  /** Absent = registered models are not pickable on this surface (e.g. a
   *  synthesized run session has no server row to write the pick to) — the
   *  section is omitted rather than rendering rows that silently no-op. */
  onPickProvider?: (o: ProviderModelOption) => void
  /** Caller extras rendered below the effort section while a built-in model is
   *  active (the composer's orthogonal-mode toggles). */
  children?: ReactNode
}) {
  // The registered Model providers, live — a provider minted in the Models section
  // is immediately in every picker (the registry cache refreshes on provider events).
  const registered = providerModelOptions(useProviders().data ?? [])
  const picked = providerId ? registered.find((o) => o.providerId === providerId) : undefined
  const effortMeta = EFFORTS.find((e) => e.id === effort)!

  return (
    <>
      {/* Model — the default provider's built-in catalog */}
      <div className="px-2 pt-2">
        <SectionLabel>Model</SectionLabel>
        {MODELS.map((m) => (
          <ModelRow
            key={m.id}
            active={!picked && m.id === modelId}
            name={m.name}
            blurb={m.blurb}
            onSelect={() => onPickModel(m)}
          />
        ))}
      </div>

      {/* Your models — the live provider registry (D9). */}
      {onPickProvider && registered.length > 0 && (
        <div className="px-2 pt-1.5">
          <SectionLabel>Your models</SectionLabel>
          {registered.map((o) => (
            <ModelRow
              key={o.providerId}
              active={o.providerId === providerId}
              name={o.name}
              blurb={
                o.kind === 'session' && !o.online ? `${o.blurb} Offline — start its drain loop.` : o.blurb
              }
              trailing={o.kind === 'session' ? <OnlineDot online={o.online} /> : undefined}
              onSelect={() => onPickProvider(o)}
            />
          ))}
        </div>
      )}

      <div className="my-1.5 border-t border-line" />

      {picked ? (
        /* A registered model's effort vocabulary is its own (provider-local, not
           the Claude ladder); per-turn effort binding is a v2 seam, so the levels
           are shown, not yet selectable. */
        <div className="px-3 pb-2.5">
          <div className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Effort
          </div>
          <div className="flex flex-wrap gap-1">
            {picked.effortLevels.map((level) => (
              <span key={level} className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-ink-soft">
                {level}
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-ink-soft">
            This model declares its own effort levels
            {picked.kind === 'session' ? ' and answers in prose only' : ''}.
          </p>
        </div>
      ) : (
        <>
          {/* Effort — the continuum */}
          <div className="px-3 pb-2">
            <div className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Effort
            </div>
            <div className="flex gap-1 rounded-lg bg-panel-2 p-0.5">
              {EFFORTS.map((e) => {
                const active = e.id === effort
                return (
                  <button
                    key={e.id}
                    onClick={() => onPickEffort(e.id)}
                    className={`flex-1 rounded-md px-1 py-1 text-[12px] font-medium transition ${
                      active
                        ? 'bg-surface text-ink shadow-sm ring-1 ring-line-strong'
                        : 'text-ink-soft hover:text-ink'
                    }`}
                  >
                    {e.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-ink-soft">{effortMeta.blurb}</p>
          </div>
          {children}
        </>
      )}
    </>
  )
}
