import { Check, Trash2 } from 'lucide-react'
import type { Connector } from '../types'
import { connectorIconFor } from '../lib/connectors'
import { connectorDetail } from '../data/connectorDetails'
import { PanelShell } from './PanelShell'

/** The body of a connector / MCP detail — status, what it grants, and the
 *  resources / tools it exposes. Shared by the session sidebar (below) and the
 *  Contexts page's detail view so a context shows the same thing in both places.
 *  `connected` drives the status line: always true for a live session chip; the
 *  Contexts page passes the saved context's real auth state. */
export function ConnectorDetailBody({
  connector,
  connected = true,
}: {
  connector: Connector
  connected?: boolean
}) {
  const detail = connectorDetail(connector)
  const isMcp = connector.kind === 'mcp'
  // Accent matches the composer chip (MCP → teal, connector → violet).
  const accent = isMcp ? 'text-cap-mcp' : 'text-cap-connector'
  const statusLabel = isMcp
    ? connected
      ? 'Running'
      : 'Stopped'
    : connected
      ? 'Connected'
      : 'Needs auth'

  return (
    <>
      <div
        className={`flex items-center gap-1.5 text-[12px] font-medium ${
          connected ? 'text-emerald-700' : 'text-amber-700'
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        {statusLabel}
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
    </>
  )
}

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
  const isMcp = connector.kind === 'mcp'
  // Accent the panel to match its composer chip (MCP → teal, connector → violet).
  const accent = isMcp ? 'text-cap-mcp' : 'text-cap-connector'

  return (
    <PanelShell icon={<Icon size={15} className={accent} />} title={connector.label} onClose={onClose}>
      <div className="flex-1 overflow-y-auto p-3">
        <ConnectorDetailBody connector={connector} />
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
