import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Gauge, Sparkles, Wand2, Workflow, Zap } from 'lucide-react'
import type { Capability } from '../types'

/** Effort levels mirror Claude's reasoning-effort ladder. `ultracode` is the
 *  top tier and is qualitatively different — it fans the turn out into a
 *  multi-agent workflow rather than just thinking harder. */
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'ultracode'

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

/** The first four sit on one continuum (a segmented control). */
const SEGMENT_EFFORTS: { id: Effort; label: string; blurb: string }[] = [
  { id: 'low', label: 'Low', blurb: 'Quick replies, minimal reasoning.' },
  { id: 'medium', label: 'Medium', blurb: 'Balanced speed and depth.' },
  { id: 'high', label: 'High', blurb: 'Deeper, step-by-step reasoning.' },
  { id: 'xhigh', label: 'xHigh', blurb: 'Extended reasoning for hard, multi-file work.' },
]
/** Ultracode is set apart because it changes *kind*, not just degree. */
const ULTRACODE = {
  id: 'ultracode' as Effort,
  label: 'Ultracode',
  blurb: 'Fans out into a multi-agent workflow — most exhaustive, highest cost.',
}
const ALL_EFFORTS = [...SEGMENT_EFFORTS, ULTRACODE]

/** The adaptive default: with no attached context it stays light; a workspace
 *  bumps it up; a repo pushes it to xHigh. It deliberately caps at xHigh and
 *  never auto-selects Ultracode — escalating into a multi-agent fleet (real
 *  cost + latency) should be a human decision, not an inference. */
function autoEffort(caps: Capability[]): Effort {
  if (caps.includes('repo')) return 'xhigh'
  if (caps.includes('workspace')) return 'high'
  return 'medium'
}

function contextLabel(caps: Capability[]): string {
  if (caps.includes('repo')) return 'the attached repo'
  if (caps.includes('workspace')) return 'the workspace'
  return 'a chat'
}

export function ModelEffortControl({ caps }: { caps: Capability[] }) {
  const [open, setOpen] = useState(false)
  const [modelId, setModelId] = useState<(typeof MODELS)[number]['id']>('opus')
  const [auto, setAuto] = useState(true)
  const [manualEffort, setManualEffort] = useState<Effort>('high')
  const [fast, setFast] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const model = MODELS.find((m) => m.id === modelId)!
  const effort: Effort = auto ? autoEffort(caps) : manualEffort
  const effortMeta = ALL_EFFORTS.find((e) => e.id === effort)!
  const isUltra = effort === 'ultracode'

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

  const pickEffort = (id: Effort) => {
    setAuto(false)
    setManualEffort(id)
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition ${
          open ? 'bg-panel-2 text-ink' : 'text-ink-soft hover:bg-panel-2'
        }`}
        title="Model & effort"
      >
        <Sparkles size={13} className="text-accent" />
        <span className="text-ink">{model.short}</span>
        <span className="text-ink-faint">·</span>
        <span className="inline-flex items-center gap-1">
          {isUltra ? (
            <Workflow size={12} className="text-accent-strong" />
          ) : (
            <Gauge size={12} className="text-ink-faint" />
          )}
          <span className={isUltra ? 'font-semibold text-accent-strong' : undefined}>
            {effortMeta.label}
          </span>
          {auto && <span className="text-[10px] font-semibold text-accent-strong">AUTO</span>}
        </span>
        <ChevronDown size={13} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-[300px] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl">
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
                  onClick={() => {
                    setModelId(m.id)
                    if (!m.isOpus) setFast(false)
                  }}
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

          {/* Effort */}
          <div className="px-3">
            <div className="flex items-center justify-between pb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                Effort
              </span>
              <button
                onClick={() => setAuto((a) => !a)}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition ${
                  auto ? 'bg-accent-tint text-accent-strong' : 'text-ink-faint hover:bg-panel-2'
                }`}
                title="Match effort to the conversation's attached context"
              >
                <Wand2 size={11} />
                Auto
              </button>
            </div>

            <div className="flex gap-1 rounded-lg bg-panel-2 p-0.5">
              {SEGMENT_EFFORTS.map((e) => {
                const active = !isUltra && e.id === effort
                return (
                  <button
                    key={e.id}
                    onClick={() => pickEffort(e.id)}
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
            <p className="mt-1.5 text-[11px] leading-snug text-ink-soft">
              {auto ? (
                <>
                  <span className="font-semibold text-accent-strong">Auto:</span> matched to{' '}
                  {contextLabel(caps)} → <span className="font-medium">{effortMeta.label}</span>.{' '}
                  {effortMeta.blurb}
                </>
              ) : (
                effortMeta.blurb
              )}
            </p>

            {/* Ultracode — set apart as a distinct top tier */}
            <button
              onClick={() => pickEffort('ultracode')}
              className={`mt-2 flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition ${
                isUltra
                  ? 'border-accent bg-accent-tint'
                  : 'border-line hover:border-line-strong hover:bg-panel-2/60'
              }`}
            >
              <Workflow
                size={16}
                className={isUltra ? 'text-accent-strong' : 'text-ink-faint'}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">{ULTRACODE.label}</span>
                <span className="block text-[11px] leading-snug text-ink-faint">
                  {ULTRACODE.blurb}
                </span>
              </span>
              {isUltra && (
                <Check size={15} strokeWidth={2.5} className="shrink-0 text-accent-strong" />
              )}
            </button>
            {auto && (
              <p className="mt-1 text-[11px] leading-snug text-ink-faint">
                Auto won't escalate to Ultracode — that stays your call.
              </p>
            )}
          </div>

          <div className="my-1.5 border-t border-line" />

          {/* Fast output (Opus only) */}
          <button
            onClick={() => model.isOpus && setFast((f) => !f)}
            disabled={!model.isOpus}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition enabled:hover:bg-panel-2/60 disabled:opacity-45"
          >
            <Zap size={15} className={fast && model.isOpus ? 'text-accent' : 'text-ink-faint'} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-ink">Fast output</span>
              <span className="block text-[11px] text-ink-faint">
                {model.isOpus ? 'Opus, with faster streaming' : 'Available on Opus models'}
              </span>
            </span>
            <span
              className={`relative h-4 w-7 shrink-0 rounded-full transition ${
                fast && model.isOpus ? 'bg-accent' : 'bg-line-strong'
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${
                  fast && model.isOpus ? 'left-3.5' : 'left-0.5'
                }`}
              />
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
