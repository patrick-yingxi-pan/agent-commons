import type { ReactNode } from 'react'

/** One compact status/recovery row above the composer or panel it governs. */
export function InlineOperationStatus({
  tone,
  message,
  leading,
  action,
}: {
  tone: 'status' | 'alert'
  message: string
  leading?: ReactNode
  action?: { label: string; icon?: ReactNode; onClick: () => void }
}) {
  return (
    <div
      role={tone}
      aria-live={tone === 'status' ? 'polite' : 'assertive'}
      aria-atomic="true"
      className="mb-2 flex items-center justify-center gap-2 px-3 text-center text-[12px] text-ink-faint"
    >
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {leading}
        <span>{message}</span>
      </span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-ink-soft transition hover:bg-panel-2 hover:text-ink"
        >
          {action.icon}
          {action.label}
        </button>
      )}
    </div>
  )
}
