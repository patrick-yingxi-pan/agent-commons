import { Plug, Wrench } from 'lucide-react'
import type { ToolActivity } from '../types'

/** A read-only account of the connector/MCP tools the model called this turn, with
 *  their (mock) results (P6). Unlike RelationActionCard there is no confirm control —
 *  a read only surfaced data, so it's *activity*, not a consent-gated proposal. Shares
 *  the same card shell as the relation/escalation cards (form follows function). */
export function ToolActivityCard({ activities }: { activities: ToolActivity[] }) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-panel-2/30 shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        <Plug size={13} className="text-accent" />
        Used connected tools
      </div>
      <div className="divide-y divide-line">
        {activities.map((a, i) => (
          <div key={`${a.tool}-${i}`} className="flex items-start gap-2.5 px-3 py-2.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface text-ink-soft">
              <Wrench size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] leading-snug text-ink">
                <span className="font-medium">{a.connector}</span>
                <span className="text-ink-faint"> · {shortTool(a.tool)}</span>
              </div>
              <div className="mt-0.5 text-[12px] leading-snug text-ink-soft">{a.summary}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The bare tool name for display — drop the `mcp__slug__` / `connector__slug__`
 *  wire prefix that carries the connector routing. */
function shortTool(tool: string): string {
  const parts = tool.split('__')
  return parts.length >= 3 ? parts.slice(2).join('__') : tool
}
