import type { AddedContext, Attachment, Connector, Message, PanelFocus, Repo, Session, Workspace } from '../types'

/** ── Model: the live session ──────────────────────────────────────────────
 *  Pure domain logic for the unit a user works in. A `Session` (sessions.ts) is
 *  the persisted seed; `Live` is the in-memory shape the controller drives as
 *  context attaches. No React here — just data and the rules that derive it. */

/** Everything that makes up the live view of the open session. Workspaces and
 *  repos are arrays because a session can hold more than one of each — the same
 *  as connectors and attachments. */
export interface Live {
  messages: Message[]
  workspaces: Workspace[]
  repos: Repo[]
  connectors: Connector[]
  attachments: Attachment[]
}

export const EMPTY_LIVE: Live = {
  messages: [],
  workspaces: [],
  repos: [],
  connectors: [],
  attachments: [],
}

/** The single shared workspace created when folders are attached to a session
 *  that doesn't already have one (seeded/demo sessions bring their own). */
export const WS_ID = 'ws-active'

/** A brand-new, unsent session. "New session" opens this — an empty thread with
 *  the composer ready. Nothing is saved until you send, so it isn't in the
 *  recents list; the controller's activeSession falls back to it. */
export const DRAFT_ID = 'draft'
export const DRAFT_SESSION: Session = {
  id: DRAFT_ID,
  title: 'New session',
  caps: ['chat'],
  preview: '',
}

export function withConnector(list: Connector[], c: Connector): Connector[] {
  return list.some((x) => x.id === c.id) ? list : [...list, c]
}

// `slug` / `repoIdForLabel` are id-derivation invariants the client AND server
// must agree on, so they live in the contract; imported for use here (the attach
// rules) and re-exported for the existing `../data/liveSession` import sites.
import { repoIdForLabel, slug } from '../../contract/ids.ts'
export { repoIdForLabel, slug }

// Branch names for the two scripted seed sessions that carry a repo. Demo seed
// data, not a general registry — context attached at runtime brings its own
// branch (see the controller's handleAddContext), so anything not seeded is 'main'.
const SEED_BRANCHES: Record<string, string> = {
  'insights-launch': 'feat/insights-dashboard',
  'auth-refactor': 'refactor/auth-middleware',
}

export function branchFor(id: string) {
  return SEED_BRANCHES[id] ?? 'main'
}

// The repo's remote (owner/name) shown on the chip for the scripted seed
// sessions — distinct from the branch, which shows in the repo panel.
// Runtime-attached repos carry their own remote.
const SEED_REMOTES: Record<string, string> = {
  'insights-launch': 'patrick-yingxi-pan/web-app',
  'auth-refactor': 'patrick-yingxi-pan/server',
}

export function remoteFor(id: string) {
  return SEED_REMOTES[id] ?? 'origin'
}

export function workspaceNameFor(session: Session) {
  return (
    session.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') + '/'
  )
}

/** The chip/panel label for a user-chosen cowork root: its last path segment,
 *  e.g. `~/work/insights-launch/` → `insights-launch/`. Keeps the workspace's
 *  label in the same `folder/` style whichever root the user picks. */
export function folderLabel(path: string) {
  const trimmed = path.replace(/\/+$/, '')
  const base = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return base ? base + '/' : path
}

/** Derive the live view from a seeded session: its workspace (if it has
 *  artifacts) and its repo (if it has files/diff/terminal). The demo starts
 *  empty and grows during the guided tour, so it derives to EMPTY_LIVE. */
export function liveFromSession(session: Session): Live {
  if (session.isDemo) return EMPTY_LIVE
  // The server owns the live workspace (runtime attaches persist into it). When the
  // session carries one — a server read / the select-time reconcile — project it
  // directly; otherwise derive from the flat seed fields, which is the instant
  // render off the static-seed copy, before the server reconcile replaces it.
  if (session.workspace) {
    return { messages: session.messages ?? [], ...session.workspace }
  }
  const workspaces: Workspace[] = session.artifacts?.length
    ? [{ id: `ws-${session.id}`, label: workspaceNameFor(session), artifacts: session.artifacts }]
    : []
  const hasRepo = !!(session.files?.length || session.diff?.length || session.terminal?.length)
  const repos: Repo[] = hasRepo
    ? [
        {
          id: `repo-${session.id}`,
          label: remoteFor(session.id),
          origin: 'github',
          remote: remoteFor(session.id),
          branch: branchFor(session.id),
          files: session.files ?? [],
          diff: session.diff ?? [],
          terminal: session.terminal ?? [],
        },
      ]
    : []
  return {
    messages: session.messages ?? [],
    workspaces,
    repos,
    connectors: session.connectors ?? [],
    attachments: [],
  }
}

/** The session's panels alone (no messages) — the server-owned `SessionWorkspace`
 *  shape, for write-through after a panel mutation. */
export function workspaceOf(l: Live) {
  return { workspaces: l.workspaces, repos: l.repos, connectors: l.connectors, attachments: l.attachments }
}

// ── Pure panel mutations ────────────────────────────────────────────────────
// The single attach funnel + the chip removals, as pure (Live, …) → Live rules.
// The controller computes the next Live with these, sets it, and writes the
// resulting workspace through to the server (the system of record).

/** Attach a context's panels: a folder merges its artifacts into the one shared
 *  workspace (creating it if absent); a repo / connector / file dedups by id, so
 *  re-attaching is a no-op. */
export function addContextToLive(l: Live, ctx: AddedContext): Live {
  switch (ctx.kind) {
    case 'folder': {
      const existing = l.workspaces[0]
      if (!existing) {
        return { ...l, workspaces: [{ id: WS_ID, label: 'Workspace', artifacts: ctx.artifacts }] }
      }
      const seen = new Set(existing.artifacts.map((a) => a.id))
      const added = ctx.artifacts.filter((a) => !seen.has(a.id))
      if (added.length === 0) return l
      return { ...l, workspaces: [{ ...existing, artifacts: [...existing.artifacts, ...added] }] }
    }
    case 'repo': {
      const id = repoIdForLabel(ctx.label)
      if (l.repos.some((r) => r.id === id)) return l
      const repo: Repo = {
        id,
        label: ctx.label,
        origin: ctx.origin,
        path: ctx.path,
        remote: ctx.remote,
        branch: ctx.branch,
        files: ctx.files,
        diff: ctx.diff,
        terminal: ctx.terminal,
      }
      return { ...l, repos: [...l.repos, repo] }
    }
    case 'connector':
    case 'mcp':
      return { ...l, connectors: withConnector(l.connectors, ctx.connector) }
    case 'files':
    case 'photos': {
      const seen = new Set(l.attachments.map((a) => a.id))
      const added = ctx.attachments.filter((a) => !seen.has(a.id))
      if (added.length === 0) return l
      return { ...l, attachments: [...l.attachments, ...added] }
    }
    default:
      return l
  }
}

/** Remove one or more attached contexts in a single update (a repo + its orphaned
 *  GitHub connector, a connector + its dependent repos, or just a connector). */
export function removeContextsFromLive(l: Live, focuses: PanelFocus[]): Live {
  const ids = (kind: PanelFocus['kind']) => new Set(focuses.filter((f) => f.kind === kind).map((f) => f.id))
  const wsIds = ids('workspace')
  const repoIds = ids('repo')
  const connIds = ids('connector')
  const attIds = new Set([...ids('file'), ...ids('photo')])
  return {
    ...l,
    workspaces: l.workspaces.filter((w) => !wsIds.has(w.id)),
    repos: l.repos.filter((r) => !repoIds.has(r.id)),
    connectors: l.connectors.filter((c) => !connIds.has(c.id)),
    attachments: l.attachments.filter((a) => !attIds.has(a.id)),
  }
}

/** Remove one source folder from the shared workspace: drop the artifacts it
 *  contributed, and drop the workspace itself if that empties it. Seeded/default
 *  artifacts (no source) are never touched. */
export function removeFolderFromLive(l: Live, sourceId: string): Live {
  return {
    ...l,
    workspaces: l.workspaces
      .map((w) => ({ ...w, artifacts: w.artifacts.filter((a) => a.source?.id !== sourceId) }))
      .filter((w) => w.artifacts.length > 0),
  }
}

/** Remove a single file/photo attachment. */
export function removeAttachmentFromLive(l: Live, id: string): Live {
  return { ...l, attachments: l.attachments.filter((a) => a.id !== id) }
}
