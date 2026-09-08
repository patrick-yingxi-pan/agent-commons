import type { McpConnectionView } from '../../contract/mcpConnections.ts'
import { useMcpConnection } from '../api/mcpConnectionHooks.ts'
import { retryResourceQueries } from '../api/resourceRead.ts'
import { keys } from '../api/keys.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'

const secondaryClass = `${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[13px]`

/** Shared by the addressable Context page and the conversation's context panel.
 * Server text stays plain presentation data; no advertised tool can execute. */
export function McpCatalogBody({ connection }: { connection: McpConnectionView }) {
  return <div data-mcp-catalog className="space-y-3 text-[13px] leading-relaxed text-ink-soft">
    <p className="font-medium text-ink">{connection.status === 'connected' ? 'Catalog inspected' : connection.status === 'disconnected' ? 'Disconnected' : 'Not inspected'}</p>
    <p>Tool execution is not available yet. Inspection reads metadata; it does not approve tool calls or verify the server’s safety.</p>
    {connection.inspectedAt !== null && <p className="text-[12px]">Last inspected {new Date(connection.inspectedAt).toLocaleString()}. This is a saved catalog, not a live health check.</p>}
    {connection.tools.length === 0 ? <p>{connection.inspectedAt === null ? 'Inspect this server to see its tools.' : 'The inspected server advertised no tools.'}</p> :
      <ul className="divide-y divide-line" aria-label="Inspected tools">
        {connection.tools.map(tool => <li key={tool.name} className="min-w-0 py-3">
          <p className="break-words font-mono text-[12px] text-ink [overflow-wrap:anywhere]">{tool.name}</p>
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
