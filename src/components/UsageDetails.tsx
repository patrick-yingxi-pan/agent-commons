import { ChevronRight } from 'lucide-react'
import { POPOVER_SURFACE } from '../lib/popover'
import { usePopoverShift } from '../lib/usePopoverShift'
import { formatTokens, formatUsagePercent, type ContextSegment, type ContextTone, type UsageSnapshot } from '../../contract/usage.ts'
import { contextPercentLabel } from '../lib/usagePresentation.ts'

const TONE: Record<ContextTone, string> = {
  messages: '#2f6fed',
  skills: '#4f86cf',
  memory: '#5e97da',
  systemTools: '#79a8e6',
  systemPrompt: '#9cc1f0',
  agents: '#bcd7f7',
  mcp: '#cfd0d6',
  free: '#ececed',
}

const WATER = { blue: '#4f86cf', gold: '#d99a2b', red: '#d2452c' }
function waterColor(pct: number): string {
  if (pct > 80) return WATER.red
  if (pct >= 50) return WATER.gold
  return WATER.blue
}

export function UsageDetails({
  usage,
  expanded,
  updating,
  onToggleExpanded,
}: {
  usage: UsageSnapshot
  expanded: boolean
  updating?: boolean
  onToggleExpanded: () => void
}) {
  const windowKnown = usage.context.windowTokens !== undefined
  const modelRef = usage.model
  const popRef = usePopoverShift<HTMLDivElement>(true)

  return (
    <div ref={popRef} role="dialog" aria-label="Usage details" className={`absolute bottom-full right-0 z-20 mb-2 w-[340px] p-3 ${POPOVER_SURFACE}`}>
      {updating && <p role="status" className="mb-2 text-[11px] text-ink-soft">Updating usage…</p>}
      {/* Partial estimate; the disclosure stays visible when rows collapse. */}
      <button
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        className="flex w-full flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-left"
      >
        <span className="text-[13px] font-medium text-ink">Context estimate</span>
        <span className="flex items-center gap-1 text-[12px] text-ink-soft">
          {windowKnown
            ? <>{usage.context.used} / {usage.context.total} ({contextPercentLabel(usage.context)})</>
            : <>{usage.context.used} used · window unknown</>}
          <ChevronRight size={13} className={`text-ink-faint transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </span>
      </button>
      {/* This is the session's resolved provider + model, never a client constant. */}
      {modelRef && (
        <div className="mt-0.5 break-words text-[11px] text-ink-faint">
          {modelRef.modelLabel ?? modelRef.modelId ?? 'Model chosen by the provider'} · {modelRef.providerLabel}
        </div>
      )}
      {windowKnown
        ? <>
            <StackedBar segments={usage.context.segments} className="mt-1.5" />
            <p className="mt-1.5 text-[11px] leading-snug text-ink-soft">Window size is model catalog metadata, not a live provider reading.</p>
          </>
        : <p className="mt-1.5 text-[11px] leading-snug text-ink-soft">No context-window value is available for this model. Fill percentages are unavailable.</p>}
      <p className="mt-1.5 text-[11px] leading-snug text-ink-soft">
        About 4 characters per token for conversation text, base tools and prompt.
        Excludes attachments, runtime tools, per-turn prompt additions and provider-managed context;
        actual use may be higher.
      </p>

      {expanded && usage.context.segments.length > 0 && (
        <div className="mt-2.5 space-y-1.5">
          {usage.context.segments.map((segment) => <SegmentRow key={segment.id} seg={segment} windowTokens={usage.context.windowTokens} />)}
        </div>
      )}

      <div className="my-2.5 border-t border-line" />
      <div className="text-[12px] font-medium text-ink">Provider quota</div>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-soft">Not connected in Agent Commons. Remaining API balance, rate limits and subscription allowance are not retrieved here.</p>

      <div className="my-2.5 border-t border-line" />
      <div className="text-[12px] font-medium text-ink">Local usage limits</div>
      <p className="mt-0.5 text-[11px] text-ink-soft">Across all models in this account</p>
      <p className="mt-1 text-[11px] leading-snug text-ink-soft">App-enforced token limits, not your provider’s quota or bill. Includes recorded input and output, relay estimates and development fixtures.</p>

      <div className="mt-2.5 space-y-2.5">
        {usage.limits.map((limit) => (
          <div key={limit.key}>
            <div className="flex flex-wrap items-center justify-between gap-x-2 text-[12px]">
              <span className="text-ink">{limit.label}</span>
              <span className="tabular-nums text-ink">{formatUsagePercent(limit.usedTokens, limit.limitTokens)}</span>
            </div>
            <Bar pct={limit.pct} className="mt-1" />
            <div className="mt-1 flex flex-wrap justify-between gap-x-2 text-[11px] text-ink-soft">
              <span title={`${limit.usedTokens.toLocaleString()} / ${limit.limitTokens.toLocaleString()} tokens`}>
                {formatTokens(limit.usedTokens)} / {formatTokens(limit.limitTokens)} tokens
              </span>
              {limit.reset && <span>{limit.reset}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Bar({ pct, className = '' }: { pct: number; className?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-line ${className}`}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: waterColor(pct) }} />
    </div>
  )
}

function StackedBar({ segments, className = '' }: { segments: ContextSegment[]; className?: string }) {
  const bars = segments.filter((segment) => !segment.deferred)
  return (
    <div className={`flex h-2 w-full overflow-hidden rounded-full bg-line ${className}`}>
      {bars.map((segment) => (
        <div key={segment.id} style={{ width: `${segment.pct ?? 0}%`, background: TONE[segment.tone] }} title={`${segment.label} · ${segment.tokens}`} />
      ))}
    </div>
  )
}

function SegmentRow({ seg, windowTokens }: { seg: ContextSegment; windowTokens?: number }) {
  const muted = seg.deferred || seg.tone === 'free'
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: TONE[seg.tone], opacity: seg.deferred ? 0.5 : 1 }} />
      <span className={`min-w-0 flex-1 truncate ${muted ? 'text-ink-faint' : 'text-ink'}`}>
        {seg.label}{seg.count !== undefined && !seg.deferred && <span className="text-ink-faint"> · {seg.count}</span>}
      </span>
      <span className="shrink-0 tabular-nums text-ink-faint">{seg.tokens}</span>
      <span className="w-12 shrink-0 text-right tabular-nums text-ink-soft">
        {seg.pct !== undefined && windowTokens !== undefined ? formatUsagePercent(seg.rawTokens, windowTokens) : seg.deferred && seg.count !== undefined ? seg.count : '—'}
      </span>
    </div>
  )
}
