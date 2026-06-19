import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Workflow, Zap } from 'lucide-react'

/** Reasoning-effort ladder — a single continuum from quick to maximal. */
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type ModelId = 'opus' | 'sonnet' | 'haiku'

const MODELS = [
  {
    id: 'opus',
    name: 'Claude Opus 4.8',
    short: 'Opus 4.8',
    blurb: 'Most capable — best for hard reasoning & code.',
    isOpus: true,
  },
  {
    id: 'sonnet',
    name: 'Claude Sonnet 4.6',
    short: 'Sonnet 4.6',
    blurb: 'Fast and balanced for everyday work.',
    isOpus: false,
  },
  {
    id: 'haiku',
    name: 'Claude Haiku 4.5',
    short: 'Haiku 4.5',
    blurb: 'Fastest — for lightweight tasks.',
    isOpus: false,
  },
] as const

const EFFORTS: { id: Effort; label: string; blurb: string }[] = [
  { id: 'low', label: 'Low', blurb: 'Quick replies, minimal reasoning.' },
  { id: 'medium', label: 'Medium', blurb: 'Balanced speed and depth.' },
  { id: 'high', label: 'High', blurb: 'Deeper, step-by-step reasoning.' },
  { id: 'xhigh', label: 'xHigh', blurb: 'Extended reasoning for hard, multi-file work.' },
  { id: 'max', label: 'Max', blurb: 'Maximum reasoning for the hardest problems.' },
]

/** The full composer config. Persisted so the user's last choice becomes the
 *  default next time — no adaptive guessing, just a sticky manual setting. */
type Config = {
  modelId: ModelId
  effort: Effort
  ultracode: boolean
  fast: boolean
}

const DEFAULT_CONFIG: Config = { modelId: 'opus', effort: 'high', ultracode: false, fast: false }
const STORAGE_KEY = 'claude-ui.composer.modelEffort.v1'

function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<Config>) }
  } catch {
    return DEFAULT_CONFIG
  }
}

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

export function ModelEffortControl() {
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState<Config>(loadConfig)
  const wrapRef = useRef<HTMLDivElement>(null)

  const { modelId, effort, ultracode, fast } = config
  const update = (patch: Partial<Config>) => setConfig((c) => ({ ...c, ...patch }))

  const model = MODELS.find((m) => m.id === modelId)!
  const effortMeta = EFFORTS.find((e) => e.id === effort)!

  // Remember the last-used config as the default.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [config])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

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
        {ultracode && (
          <span title="Ultracode — multi-agent workflow" className="flex items-center text-accent">
            <Workflow size={14} />
          </span>
        )}
        {fast && model.isOpus && (
          <span title="Fast output" className="flex items-center text-accent">
            <Zap size={14} />
          </span>
        )}
        <span className="text-ink">
          {model.short} · {effortMeta.label}
        </span>
        <ChevronDown size={13} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Model and effort"
          className="absolute bottom-full right-0 z-20 mb-2 w-[320px] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl"
        >
          {/* Model */}
          <div className="px-2 pt-2">
            <div className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Model
            </div>
            {MODELS.map((m) => {
              const active = m.id === modelId
              return (
                <button
                  key={m.id}
                  onClick={() => update({ modelId: m.id, ...(m.isOpus ? {} : { fast: false }) })}
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
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{m.name}</span>
                    <span className="block text-[11px] leading-snug text-ink-faint">{m.blurb}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="my-1.5 border-t border-line" />

          {/* Effort — the continuum */}
          <div className="px-3">
            <div className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Effort
            </div>
            <div className="flex gap-1 rounded-lg bg-panel-2 p-0.5">
              {EFFORTS.map((e) => {
                const active = e.id === effort
                return (
                  <button
                    key={e.id}
                    onClick={() => update({ effort: e.id })}
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

          <div className="my-1.5 border-t border-line" />

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
        </div>
      )}
    </div>
  )
}
