import type { FsReadPhase } from '../lib/fsReadState.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'

/** Source discovery and all three catalog projections share one recovery face. */
export function FsReadNotice({ phase, label, onRetry, unavailable = false }: {
  phase: FsReadPhase
  label: string
  onRetry: () => void
  unavailable?: boolean
}) {
  if (phase === 'ready') return null
  const failed = phase === 'error' || unavailable
  return (
    <div data-fs-read-state={phase} role={failed ? 'alert' : 'status'} aria-busy={phase === 'loading'} className="px-1 py-4 text-center text-[12px] text-ink-soft">
      <p className={failed ? 'text-danger-text' : undefined}>
        {phase === 'loading' ? `Loading ${label}…` : phase === 'error' ? `Could not load ${label}.` : unavailable ? 'This source is no longer available.' : `Nothing here yet — no ${label}.`}
      </p>
      {failed && <p className="mt-1">Try again, or choose another source.</p>}
      {failed && <button type="button" onClick={onRetry} className={`${SECONDARY_BUTTON_CLASS} mt-2 px-2 py-1 text-[12px]`}>Retry</button>}
    </div>
  )
}
