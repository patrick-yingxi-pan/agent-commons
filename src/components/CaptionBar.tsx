import { ChevronRight, Play, RotateCcw, Sparkles } from 'lucide-react'
import type { TourPhase } from '../types'

export function CaptionBar({
  phase,
  stepIndex,
  totalSteps,
  caption,
  busy,
  onStart,
  onNext,
  onRestart,
}: {
  phase: TourPhase
  stepIndex: number
  totalSteps: number
  caption: string
  busy: boolean
  onStart: () => void
  onNext: () => void
  onRestart: () => void
}) {
  // Styled for the dark proposal band it lives in (light text, accent buttons).
  if (phase === 'idle') {
    return (
      <div className="flex items-center gap-3 border-t border-white/10 px-4 py-2 short:py-1.5">
        <Sparkles size={15} className="shrink-0 text-accent" />
        <span className="flex-1 text-sm text-canvas/85">
          <span className="font-semibold text-canvas">Guided tour</span>
          <span className="hidden sm:inline">
            : watch one conversation flow from chat → workspace → code, with no tab switching.
          </span>
        </span>
        <button
          onClick={onStart}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-accent-strong"
        >
          <Play size={14} />
          Play the tour
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 border-t border-white/10 px-4 py-2 short:py-1.5">
      {/* The step dots crowd a phone-width band; the n/m counter carries the
          same information there. */}
      <div className="hidden shrink-0 items-center gap-1 sm:flex">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              i <= stepIndex ? 'w-5 bg-accent' : 'w-2 bg-white/25'
            }`}
          />
        ))}
      </div>
      <span className="line-clamp-2 flex-1 text-sm text-canvas/85 sm:line-clamp-none">
        <span className="mr-1.5 font-semibold text-accent">
          {Math.min(stepIndex + 1, totalSteps)}/{totalSteps}
        </span>
        {caption}
      </span>
      {phase === 'running' ? (
        <button
          onClick={onNext}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:opacity-40"
        >
          {stepIndex + 1 >= totalSteps ? 'Finish' : 'Next'}
          <ChevronRight size={15} />
        </button>
      ) : (
        <button
          onClick={onRestart}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/25 px-3 py-1.5 text-sm font-semibold text-canvas/80 transition hover:bg-white/10 hover:text-canvas"
        >
          <RotateCcw size={14} />
          Replay
        </button>
      )}
    </div>
  )
}
