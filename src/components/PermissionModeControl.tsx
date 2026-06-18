import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'

type ModeId = 'ask' | 'acceptEdits' | 'plan' | 'auto' | 'bypass'

const MODES: { id: ModeId; name: string; short: string; key: string }[] = [
  { id: 'ask', name: 'Ask permissions', short: 'Ask', key: '1' },
  { id: 'acceptEdits', name: 'Accept edits', short: 'Accept edits', key: '2' },
  { id: 'plan', name: 'Plan mode', short: 'Plan', key: '3' },
  { id: 'auto', name: 'Auto mode', short: 'Auto', key: '4' },
  { id: 'bypass', name: 'Bypass permissions', short: 'Bypass', key: '5' },
]

const DEFAULT_MODE: ModeId = 'auto'

/** The pill's color cues how permissive the mode is. */
const PILL_TONE: Record<ModeId, string> = {
  ask: 'text-ink-soft hover:bg-panel-2',
  acceptEdits: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  plan: 'bg-[#e9f0f3] text-cap-repo hover:brightness-95',
  auto: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
  bypass: 'bg-red-50 text-red-700 hover:bg-red-100',
}

export function PermissionModeControl() {
  const [open, setOpen] = useState(false)
  const [modeId, setModeId] = useState<ModeId>(DEFAULT_MODE)
  const wrapRef = useRef<HTMLDivElement>(null)
  const mode = MODES.find((m) => m.id === modeId)!

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setOpen(false)
      const m = MODES.find((x) => x.key === e.key)
      if (m) {
        setModeId(m.id)
        setOpen(false)
      }
    }
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
        title="Permission mode (Ctrl ⇧ M)"
        className={`rounded-lg px-2 py-1 text-xs font-medium transition ${PILL_TONE[modeId]}`}
      >
        {mode.short}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-[256px] overflow-hidden rounded-xl border border-line-strong bg-surface p-1.5 shadow-xl">
          <div className="flex items-center justify-between px-1.5 py-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Mode</span>
            <span className="flex items-center gap-0.5">
              <Kbd>Ctrl</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>M</Kbd>
            </span>
          </div>

          <div className="flex items-center justify-between px-1.5 py-1 text-[13px]">
            <span className="text-ink">
              {mode.name}
              {modeId === DEFAULT_MODE && <span className="text-ink-faint"> · Default</span>}
            </span>
            <Check size={14} className="text-ink" />
          </div>

          <div className="my-1 border-t border-line" />

          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setModeId(m.id)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between rounded-lg px-1.5 py-1.5 text-left text-[13px] transition hover:bg-panel-2"
            >
              <span className="text-ink">{m.name}</span>
              <span className="flex items-center gap-2">
                {m.id === modeId && <Check size={13} className="text-ink" />}
                <span className="w-3 text-right text-[12px] text-ink-faint">{m.key}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded border border-line-strong bg-panel-2 px-1 text-[10px] font-medium text-ink-soft">
      {children}
    </span>
  )
}
