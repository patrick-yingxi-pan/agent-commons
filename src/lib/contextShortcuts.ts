/** ── The Add-context shortcut surface, in one place ─────────────────────────
 *  "Recent …" (files / photos / folders / repos) and "Connected" (connectors /
 *  MCP) are the two quick lists the Add-context picker shows so the thread can
 *  re-add what it has used in one click. Their shared purpose implies one rule:
 *
 *    INVARIANT — any element attached to a thread is promoted into its shortcut
 *    list, no matter how it was attached: this picker, the Browse explorer, an
 *    AI proposal (RelationActionCard → attachConnector bridge), or a side-effect
 *    attach (a repo pulling in its GitHub connector).
 *
 *  That rule was previously implicit, so promotion got bolted onto the picker's
 *  click handlers and silently missed every other path. `rememberAttached` makes
 *  it explicit and total: it maps an attached `AddedContext` back to its catalog
 *  id and promotes it, and is called once from the single attach funnel
 *  (`controller/useSessionWorkspace.handleAddContext`). Every add — from any
 *  surface — therefore updates the shortcut list by construction.
 *
 *  See [[recents]] (MRU list) and [[known]] (Connected set). */
import type { AddedContext } from '../types'
import { GITHUB_REPO_OPTIONS, LOCAL_REPO_OPTIONS } from '../data/contextOptions'
import { pushRecent } from './recents'
import { addKnownId } from './known'

/** Recover a repo's catalog id from the attached context. Local repos are keyed
 *  by working-tree path, GitHub repos by remote — each unique within its origin,
 *  so the lookup is unambiguous even when a local clone and a GitHub repo share a
 *  remote. */
function repoCatalogId(ctx: Extract<AddedContext, { kind: 'repo' }>): string | undefined {
  return ctx.origin === 'local'
    ? LOCAL_REPO_OPTIONS.find((r) => r.path === ctx.path)?.id
    : GITHUB_REPO_OPTIONS.find((r) => r.remote === ctx.remote)?.id
}

/** Promote a freshly-attached context into its shortcut list. Idempotent and
 *  safe to call on a re-attach (it just refreshes recency / membership). */
export function rememberAttached(ctx: AddedContext) {
  switch (ctx.kind) {
    case 'files':
      ctx.attachments.forEach((a) => pushRecent('files', a.id))
      break
    case 'photos':
      ctx.attachments.forEach((a) => pushRecent('photos', a.id))
      break
    case 'folder': {
      // Every artifact is tagged with the folder as its source on attach, so the
      // folder's catalog id rides along on the payload.
      const folderId = ctx.artifacts.find((a) => a.source)?.source?.id
      if (folderId) pushRecent('folder', folderId)
      break
    }
    case 'repo': {
      const id = repoCatalogId(ctx)
      if (id) pushRecent('repo', id)
      break
    }
    case 'connector':
      // Connectors use the "Connected" set, not recency — membership is the
      // shortcut. (Their catalog id is the connector id itself, e.g. `gdrive`.)
      addKnownId('connector', ctx.connector.id)
      break
    case 'mcp':
      // MCP connector ids carry an `mcp-` prefix; the catalog / Connected set is
      // keyed by the bare server id.
      addKnownId('mcp', ctx.connector.id.replace(/^mcp-/, ''))
      break
  }
}
