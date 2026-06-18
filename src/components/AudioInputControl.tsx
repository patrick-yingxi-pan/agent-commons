import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Mic } from 'lucide-react'

const DEVICES = [
  'Default — System microphone',
  'Communications — Headset microphone',
  'Built-in microphone',
  'Microphone Array',
]

/** Voice input: a mic button (toggles a recording state) plus a chevron that
 *  opens the microphone device menu. */
export function AudioInputControl() {
  const [open, setOpen] = useState(false)
  const [device, setDevice] = useState(0)
  const [hold, setHold] = useState(true)
  const [recording, setRecording] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

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
    <div ref={wrapRef} className="relative flex items-center">
      <button
        onClick={() => setRecording((r) => !r)}
        title={recording ? 'Stop' : 'Voice input'}
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
          recording ? 'bg-red-50 text-red-600' : 'text-ink-soft hover:bg-panel-2 hover:text-ink'
        }`}
      >
        <Mic size={16} className={recording ? 'animate-pulse' : ''} />
      </button>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Microphone settings"
        className={`flex h-8 w-5 items-center justify-center rounded-lg transition ${
          open ? 'bg-panel-2 text-ink' : 'text-ink-faint hover:bg-panel-2 hover:text-ink'
        }`}
      >
        <ChevronDown size={13} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-[300px] overflow-hidden rounded-xl border border-line-strong bg-surface p-1.5 shadow-xl">
          <div className="px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Microphone
          </div>
          {DEVICES.map((d, i) => (
            <button
              key={i}
              onClick={() => setDevice(i)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-panel-2"
            >
              <span
                className={`min-w-0 truncate text-[13px] ${
                  i === device ? 'font-medium text-ink' : 'text-ink-soft'
                }`}
              >
                {d}
              </span>
              {i === device && <Check size={14} className="shrink-0 text-ink" />}
            </button>
          ))}

          <div className="my-1 border-t border-line" />

          <button
            onClick={() => setHold((h) => !h)}
            className="flex w-full items-center justify-between rounded-lg px-1.5 py-1.5 text-left transition hover:bg-panel-2"
          >
            <span className="text-[13px] text-ink">Hold to record</span>
            <span
              className={`relative h-4 w-7 shrink-0 rounded-full transition ${
                hold ? 'bg-accent' : 'bg-line-strong'
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${
                  hold ? 'left-3.5' : 'left-0.5'
                }`}
              />
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
