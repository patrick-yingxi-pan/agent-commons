/** ── Project-context mapping ────────────────────────────────────────────────
 *  The Projects detail page reuses the session composer's "Add context" picker to
 *  scope context to a project. That picker speaks `AddedContext` (the session
 *  shape); a project stores `ProjectContext`. These pure mappers bridge the two so
 *  the same UI drives both — kept out of the component (and free of React) so they
 *  can be unit-tested. */
import type { AddedContext, Connector } from '../../contract/entities.ts'
import type { ProjectContext } from '../../contract/cowork.ts'
import type { ChipTone } from './capabilities'
import { CONNECTOR_OPTIONS, MCP_OPTIONS } from '../data/contextOptions.ts'

/** ProjectContext.kind → the shared chip palette tone (lib/capabilities), so a
 *  project's scoped context reads with the same per-type tint as a session's. */
export function projectContextTone(kind: ProjectContext['kind']): ChipTone {
  return kind === 'repo' ? 'repo' : kind === 'folder' ? 'workspace' : kind === 'doc' ? 'file' : 'connector'
}

/** Map a session-shaped `AddedContext` (what the composer's Add-context picker
 *  emits) onto the project's `ProjectContext` shape, so the very same picker can
 *  scope context to a project. Files/photos fan out one ProjectContext per
 *  attachment; the scope-context reducer dedups by stable source where available.
 *  ProjectContext has no `mcp` kind, so an MCP server reads as a connector tagged
 *  by its meta and optional opaque source id. */
export function addedToProjectContexts(ctx: AddedContext): ProjectContext[] {
  switch (ctx.kind) {
    case 'discussion':
      // Project context is descriptive metadata, not a saved-copy destination.
      // The shared picker hides this conversation-only branch on project pages.
      return []
    case 'folder':
      {
        const count = ctx.folder?.snapshot?.files.length ?? ctx.artifacts.length
        return [{ kind: 'folder', label: ctx.label, meta: `${count} file${count === 1 ? '' : 's'}` }]
      }
    case 'repo':
      return [{ kind: 'repo', label: ctx.label, meta: `${ctx.origin} · ${ctx.branch}` }]
    case 'connector':
      return [{ kind: 'connector', label: ctx.connector.label, meta: 'Connector' }]
    case 'mcp':
      return [{ kind: 'connector', label: ctx.connector.label, meta: 'MCP server', source: { kind: 'mcp', id: ctx.connector.id } }]
    case 'files':
      return ctx.attachments.map((a) => ({ kind: 'doc', label: a.label, meta: 'File' }))
    case 'photos':
      return ctx.attachments.map((a) => ({ kind: 'doc', label: a.label, meta: 'Photo' }))
  }
}

/** Reverse-map a project's scoped connectors / MCP servers into the `Connector[]`
 *  the Add-context picker reads its "Added" ticks from — using an MCP source id
 *  when present, and otherwise matching the fixture catalog by label (MCP ids carry
 *  the `mcp-` prefix the picker strips). An MCP context is distinguished by the
 *  `MCP server` meta that `addedToProjectContexts` stamps. Repos / folders / files
 *  aren't reverse-mapped; re-adding one is a harmless label-dedup no-op, so the
 *  picker just won't pre-tick them. */
export function contextsToConnectors(contexts: ProjectContext[]): Connector[] {
  const out: Connector[] = []
  for (const c of contexts) {
    if (c.kind !== 'connector') continue
    if (c.meta === 'MCP server') {
      const sourceId = c.source?.kind === 'mcp' ? c.source.id : undefined
      const opt = sourceId === undefined ? MCP_OPTIONS.find((o) => o.label === c.label) : undefined
      out.push({ id: sourceId ?? `mcp-${opt?.id ?? c.label}`, label: c.label, kind: 'mcp' })
    } else {
      const opt = CONNECTOR_OPTIONS.find((o) => o.label === c.label)
      out.push({ id: opt?.id ?? c.label, label: c.label, kind: opt?.kind ?? 'connector' })
    }
  }
  return out
}
