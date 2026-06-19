import { Check, Trash2 } from 'lucide-react'
import type { Connector } from '../types'
import { connectorIconFor } from '../lib/connectors'
import { connectorDetail } from '../data/connectorDetails'
import { PanelShell } from './PanelShell'

/** Sidebar for a connector or MCP server: status, what it grants, the
 *  resources / tools it exposes, and a way to disconnect it. */
export function ConnectorPanel({
  connector,
  onClose,
  onDisconnect,
}: {
  connector: Connector
  onClose: () => void
  onDisconnect: () => void
}) {
  const Icon = connectorIconFor(connector.kind)
  const detail = connectorDetail(connector)
  const isMcp = connector.kind === 'mcp'
  // Accent the panel to match its composer chip (MCP → teal, connector → violet).
  const accent = isMcp ? 'text-cap-mcp' : 'text-cap-connector'

  return (
    <PanelShell icon={<Icon size={15} className={accent} />} title={connector.label} onClose={onClose}>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          {isMcp ? 'Running' : 'Connected'}
        </div>

        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{detail.blurb}</p>

        <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {isMcp ? 'Scope' : 'Access'}
        </div>
        <div className="mt-1.5 space-y-1.5">
          {detail.access.map((a, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px] text-ink">
              <Check size={14} className={`shrink-0 ${accent}`} />
              {a}
            </div>
          ))}
        </div>

        {detail.items.length > 0 && (
          <>
            <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {detail.itemsLabel}
            </div>
            <div className="mt-1.5 space-y-0.5">
              {detail.items.map((it, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg px-2 py-1.5 transition hover:bg-surface"
                >
                  <span
                    className={`min-w-0 truncate text-[13px] text-ink ${isMcp ? 'font-mono text-[12px]' : ''}`}
                  >
                    {it.label}
                  </span>
                  {it.meta && <span className="ml-2 shrink-0 text-[11px] text-ink-faint">{it.meta}</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        <button
          onClick={onDisconnect}
          className="flex items-center gap-1.5 text-[12px] font-medium text-ink-faint transition hover:text-removed"
        >
          <Trash2 size={13} />
          {isMcp ? 'Remove server' : 'Disconnect'}
        </button>
      </div>
    </PanelShell>
  )
}
