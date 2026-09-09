import type { McpConnectionView } from '../../contract/mcpConnections.ts'
import { useMcpConnection } from '../api/mcpConnectionHooks.ts'
import { retryResourceQueries } from '../api/resourceRead.ts'
import { keys } from '../api/keys.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'

const secondaryClass = `${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[13px]`

/** Shared by the addressable Context page and the conversation's context panel.
 * Server text stays plain presentation data; execution remains behind a separate
 * conversation attachment and per-call approval. */
export function McpCatalogBody({ connection }: { connection: McpConnectionView }) {
  const approvalRequired = connection.execution === 'approval-required'
  const executable = new Set(approvalRequired ? connection.executableTools ?? [] : [])
  const executionCopy = approvalRequired
    ? 'This server is available in conversations. Every tool call requires your approval; inspection alone never approves a call or verifies the server’s safety.'
    : connection.status === 'disconnected'
      ? 'Reconnect and inspect this server before attaching it again. Its saved catalog is metadata, not live server health or approval.'
      : connection.inspectedAt !== null && connection.executableTools === undefined
        ? 'Refresh this catalog before attaching the server. Its saved tools remain visible, but none are currently admitted for execution.'
        : connection.inspectedAt !== null
          ? 'None of the advertised tools meet the supported schema policy. Review the server or its tool definitions before inspecting again.'
        : 'Inspect this server before attaching it. Inspection reads untrusted metadata and never runs or approves a tool.'
  return <div data-mcp-catalog className="space-y-3 text-[13px] leading-relaxed text-ink-soft">
    <p className="font-medium text-ink">{connection.status === 'connected' ? 'Catalog inspected' : connection.status === 'disconnected' ? 'Disconnected' : 'Not inspected'}</p>
    <p>{executionCopy}</p>
    {connection.inspectedAt !== null && <p className="text-[12px]">Last inspected {new Date(connection.inspectedAt).toLocaleString()}. This is a saved catalog, not a live health check.</p>}
    {connection.tools.length === 0 ? <p>{connection.inspectedAt === null ? 'Inspect this server to see its tools.' : 'The inspected server advertised no tools.'}</p> :
      <ul className="divide-y divide-line" aria-label="Inspected tools">
        {connection.tools.map(tool => <li key={tool.name} className="min-w-0 py-3">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="min-w-0 break-words font-mono text-[12px] text-ink [overflow-wrap:anywhere]">{tool.name}</p>
            <span className={`shrink-0 text-[11px] ${executable.has(tool.name) ? 'text-ok-text' : 'text-ink-faint'}`}>
              {executable.has(tool.name) ? 'Available with approval' : 'Unavailable'}
            </span>
          </div>
          {tool.title && <p className="break-words text-ink [overflow-wrap:anywhere]">{tool.title}</p>}
          {tool.description && <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{tool.description}</p>}
        </li>)}
      </ul>}
  </div>
}

export function McpConnectionPreview({ id }: { id: string }) {
  const read = useMcpConnection(id)
  if (read.data) return <McpCatalogBody connection={read.data} />
  return <div className="space-y-2 text-[13px] text-ink-soft">
    <p role="status">{read.status === 'error' ? 'This server catalog could not be loaded or is unavailable to this account.' : 'Loading server catalog…'}</p>
    {read.status === 'error' && <button className={secondaryClass} onClick={() => retryResourceQueries([keys.mcpConnection(id)])}>Retry catalog</button>}
  </div>
}
