import type { ReactNode } from 'react'
import { Check, Plus } from 'lucide-react'

export function OptionRow({
  icon,
  label,
  meta,
  status,
  added,
  onClick,
  disabled = false,
}: {
  icon: ReactNode
  label: string
  meta?: string
  status?: 'connected' | 'needs-auth'
  added?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={added || disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={added || disabled}
      className={`group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
        added ? 'cursor-default' : 'hover:bg-panel-2'
      }`}
    >
      {status && (
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === 'connected' ? 'bg-ok' : 'bg-warn'}`}
          title={status === 'connected' ? 'Connected' : 'Needs auth'}
        />
      )}
      <span className="shrink-0 text-ink-soft">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{label}</span>
        {meta && <span className="block truncate text-[11px] text-ink-faint">{meta}</span>}
      </span>
      {added ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-ok-strong">
          <Check size={13} strokeWidth={2.5} /> Added
        </span>
      ) : (
        <span
          title="Add"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-faint transition group-hover:bg-accent-solid group-hover:text-on-solid"
        >
          <Plus size={14} />
        </span>
      )}
    </button>
  )
}
