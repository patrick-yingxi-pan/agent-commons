import type {
  AddedContext,
  AttachContextRequest,
  Attachment,
  Connector,
  EscalationProposal,
  Message,
  PanelFocus,
  RelationGraph,
  Repo,
  Session,
  SessionContextOperation,
  Workspace,
} from '../types'
import { opAppliedInGraph } from '../../contract/graph.ts'
import { panelFocusInWorkspace } from '../../contract/entities.ts'
import { workspaceFolders } from '../../contract/workspaceFolders.ts'

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
 *  Sessions list; the controller's activeSession falls back to it. */
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
import { parseFsRecentKey } from '../../contract/index.ts'

/** The persistent binding(s) an attached context writes through to the server
 *  (Primitive 1 — the binding-of-record the effect-mediation path resolves
 *  against). ONE mapping for every host of the attach funnel — the singleton
 *  controller and the split panes alike — so the two can't drift. Repos and
 *  connectors / attachments key on their own id. A folder keys on its OWN
 *  source id (the id its artifacts carry, which removeFolder detaches by) —
 *  NOT the shared workspace panel id — so attaching a second folder doesn't
 *  overwrite the first folder's binding-of-record (and its scope). `scope` is
 *  the resource boundary (a path for folder / repo, `'*'` otherwise);
 *  files / photos expand to one binding per attachment. */
export function bindingsFor(ctx: AddedContext): AttachContextRequest[] {
  switch (ctx.kind) {
    case 'folder': {
      // The folder key is source-qualified (`<source>::<path>`); its scope is the
      // path within the source, and `source` records which host it came from.
      const folderId = ctx.folder?.id ?? ctx.artifacts[0]?.source?.id ?? slug(ctx.label)
      const scope = ctx.folder?.snapshot?.path ?? parseFsRecentKey(folderId)?.entryId ?? ctx.label
      return [{ id: folderId, type: 'folder', label: ctx.label, scope, source: ctx.source }]
    }
    case 'repo':
      return [{ id: repoIdForLabel(ctx.label), type: 'repo', label: ctx.label, scope: ctx.path ?? '*' }]
    case 'connector':
      return [{ id: ctx.connector.id, type: 'connector', label: ctx.connector.label, scope: '*' }]
    case 'mcp':
      return [{ id: ctx.connector.id, type: 'mcp', label: ctx.connector.label, scope: '*' }]
    case 'files':
      return ctx.attachments.map((a): AttachContextRequest => ({
        id: a.id,
        type: 'files',
        label: a.label,
        scope: parseFsRecentKey(a.id)?.entryId ?? '*',
        source: a.source,
      }))
    case 'photos':
      return ctx.attachments.map((a): AttachContextRequest => ({
        id: a.id,
        type: 'photos',
        label: a.label,
        scope: parseFsRecentKey(a.id)?.entryId ?? '*',
        source: a.source,
      }))
    default:
      return []
  }
}

// Branch names for the seed sessions that carry a repo. Demo seed data, not a
// general registry — context attached at runtime brings its own branch (see the
// controller's handleAddContext), so anything not seeded is 'main'.
const SEED_BRANCHES: Record<string, string> = {
  'auth-refactor': 'refactor/auth-middleware',
}

export function branchFor(id: string) {
  return SEED_BRANCHES[id] ?? 'main'
}

// The repo's remote (owner/name) shown on the chip for the seed sessions that
// carry one — distinct from the branch, which shows in the repo panel.
// Runtime-attached repos carry their own remote.
const SEED_REMOTES: Record<string, string> = {
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
 *  artifacts) and its repo (if it has files/diff/terminal). */
export function liveFromSession(session: Session): Live {
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

/** ── Resurfacing a held escalation (C28) ─────────────────────────────────────
 *  An escalation proposal is PERSISTED on the assistant message that carried it,
 *  but the pending consent card once lived only in controller state set by the
 *  live stream event — so any load path (reopen, reload, reattach-after-finish,
 *  the relay transport's long turns) showed the reply text and silently dropped
 *  the card, leaving the proposal unapprovable. The record is the authority
 *  (C25's rule): derive the still-pending proposal FROM the loaded session —
 *  the newest assistant-carried escalation whose effect isn't applied yet.
 *  Applied-ness reads the same records the approval writes: a project escalation
 *  is the `create-project` op `approveEscalation` submits (`opAppliedInGraph`);
 *  a workspace/repo escalation lands panels on the session itself. With no graph
 *  loaded a project proposal returns null — never re-offer what may already be
 *  approved. */
export function unresolvedEscalation(
  session: Pick<Session, 'id' | 'title' | 'messagePage'>,
  live: Live,
  graph: RelationGraph | undefined,
): { messageId: string; escalation: EscalationProposal } | null {
  // A bounded tail may not contain the message carrying the newest proposal.
  // The page metadata projects that one carrier without inserting a non-
  // contiguous message into the timeline; treat it as the newest candidate.
  const fallback = session.messagePage?.latestEscalation
  const candidates =
    fallback && !live.messages.some((message) => message.id === fallback.messageId)
      ? [...live.messages, { id: fallback.messageId, role: 'assistant' as const, content: '', escalation: fallback.escalation }]
      : live.messages
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const m = candidates[i]
    if (m.role !== 'assistant' || !m.escalation) continue
    const esc = m.escalation
    const held = { messageId: m.id, escalation: esc }
    if (esc.kind === 'project') {
      if (!graph) return null
      // Applied = the PROJECT EXISTS — deliberately not the filing: approval
      // creates the project (and files atomically when asked), so a missing
      // filing later means the user MOVED ON (unfiled, refiled elsewhere), and
      // re-offering the create card would un-happen their decision. Same
      // derivation `EscalationOutcome` renders the confirmed face from.
      const applied = opAppliedInGraph(graph, {
        kind: 'create-project',
        projectId: esc.project.id,
        projectName: esc.project.name,
        projectDescription: esc.project.description,
      })
      return applied === false ? held : null
    }
    if (esc.kind === 'workspace') return live.workspaces.length ? null : held
    return live.repos.length ? null : held
  }
  return null
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
      if (ctx.folder) {
        if (l.workspaces.some((workspace) => workspaceFolders(workspace).some((folder) => folder.id === ctx.folder!.id))) return l
        const index = l.workspaces.length ? 0 : -1
        if (index < 0) {
          return { ...l, workspaces: [...l.workspaces, { id: WS_ID, label: 'Workspace', artifacts: ctx.folder.snapshot ? [] : ctx.artifacts, folders: [ctx.folder] }] }
        }
        const workspaces = [...l.workspaces]
        const existing = workspaces[index]!
        const addedArtifacts = ctx.folder.snapshot ? [] : ctx.artifacts.filter((artifact) => !existing.artifacts.some((current) => current.id === artifact.id))
        workspaces[index] = { ...existing, artifacts: [...existing.artifacts, ...addedArtifacts], folders: [...(existing.folders ?? []), ctx.folder] }
        return { ...l, workspaces }
      }

      // Legacy/local folder imports keep their artifact-based representation.
      const index = l.workspaces.length ? 0 : -1
      if (index < 0) return { ...l, workspaces: [{ id: WS_ID, label: 'Workspace', artifacts: ctx.artifacts }] }
      const workspaces = [...l.workspaces]
      const existing = workspaces[index]!
      const seen = new Set(existing.artifacts.map((a) => a.id))
      const added = ctx.artifacts.filter((a) => !seen.has(a.id))
      if (added.length === 0) return l
      workspaces[index] = { ...existing, artifacts: [...existing.artifacts, ...added] }
      return { ...l, workspaces }
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

/** Apply an APPROVED escalation's panels to the live session (the model half of
 *  the consent flow): attach the workspace (labelled with the user-chosen root)
 *  or the repo + its connectors. Id-guarded, so a replayed beat can't duplicate
 *  a panel. ONE funnel for every conversation surface — the primary thread's
 *  controller and a split pane's approval both apply through here (universal
 *  split Phase 3). A 'project' escalation doesn't touch the live state (it is a
 *  relation op); callers route it to applyRelationOp. */
export function applyEscalationToLive(l: Live, esc: EscalationProposal, workspaceLabel: string): Live {
  const next: Live = { ...l }
  if (esc.kind === 'workspace' && !l.workspaces.some((w) => w.id === 'ws-demo')) {
    next.workspaces = [...l.workspaces, { id: 'ws-demo', label: workspaceLabel, artifacts: esc.artifacts }]
  }
  if (esc.kind === 'repo' && !l.repos.some((r) => r.id === 'repo-demo')) {
    next.repos = [
      ...l.repos,
      {
        id: 'repo-demo',
        label: esc.remote,
        origin: 'github',
        remote: esc.remote,
        branch: esc.branch,
        files: esc.files,
        diff: esc.diff,
        terminal: esc.terminal,
      },
    ]
    next.connectors = esc.connectors.reduce(withConnector, l.connectors)
  }
  return next
}

/** The binding-of-record an approved escalation persists (the same two-facet
 *  write a manual attach does) — null for a 'project' escalation (no panel). */
export function escalationBinding(
  esc: EscalationProposal,
  workspaceLabel: string,
  workspaceRoot?: string,
): { id: string; type: 'folder' | 'repo'; label: string; scope: string } | null {
  if (esc.kind === 'workspace') return { id: 'ws-demo', type: 'folder', label: workspaceLabel, scope: workspaceRoot ?? '*' }
  if (esc.kind === 'repo') return { id: 'repo-demo', type: 'repo', label: esc.remote, scope: '*' }
  return null
}

/** The view-facing shape of a held consent prompt — what the EscalationPrompt
 *  needs to render (a workspace beat's root choices; a repo beat's service
 *  name; a project beat's name). The shared derivation for the primary thread
 *  and the split panes. */
export function approvalView(esc: EscalationProposal) {
  if (esc.kind === 'workspace') {
    return { kind: 'workspace', rootChoices: esc.rootChoices.length ? esc.rootChoices : ['~/'] } as const
  }
  if (esc.kind === 'project') {
    return { kind: 'project', projectName: esc.project.name } as const
  }
  return { kind: 'repo', connectorLabel: esc.connectorLabel } as const
}

/** The panel to open for a just-attached context, so you see what you added — the
 *  shared rule for the manual attach funnel and the pre-attached entry shortcuts
 *  (FWD-1). `live` is the post-attach state (a folder merges into the shared
 *  workspace, so its id is read from there). Pure, so it's unit-tested directly. */
export function focusForAdded(ctx: AddedContext, live: Live): PanelFocus | null {
  switch (ctx.kind) {
    case 'folder': {
      const containing = ctx.folder
        ? live.workspaces.find((workspace) => workspaceFolders(workspace).some((folder) => folder.id === ctx.folder!.id))
        : undefined
      return { kind: 'workspace', id: containing?.id ?? live.workspaces[0]?.id ?? WS_ID }
    }
    case 'repo':
      return { kind: 'repo', id: repoIdForLabel(ctx.label) }
    case 'connector':
    case 'mcp':
      return { kind: 'connector', id: ctx.connector.id }
    case 'files':
    case 'photos': {
      const first = ctx.attachments[0]
      return first ? { kind: first.kind, id: first.id } : null
    }
    default:
      return null
  }
}

/** Whether a panel focus still names a context PRESENT in `live` — the guard
 *  every remove funnel runs so a session's open panel can't dangle on a context
 *  that was just detached (the pane projection would otherwise keep rendering
 *  the "no longer attached" placeholder forever). Pure; shared by every host. */
export function focusValidIn(l: Live, focus: PanelFocus): boolean {
  return panelFocusInWorkspace(workspaceOf(l), focus)
}

/** Bucket a remove's PanelFocus targets by context kind — the ONE id-grouping
 *  `removeContextsFromLive` filters by AND the draft funnel's buffer purge
 *  mirrors (the purge must drop exactly the seeds the remove dropped, or a
 *  removed chip re-attaches at materialization). */
export function bucketFocuses(focuses: PanelFocus[]): {
  wsIds: Set<string>
  repoIds: Set<string>
  connIds: Set<string>
  attIds: Set<string>
} {
  const ids = (kind: PanelFocus['kind']) => new Set(focuses.filter((f) => f.kind === kind).map((f) => f.id))
  return { wsIds: ids('workspace'), repoIds: ids('repo'), connIds: ids('connector'), attIds: new Set([...ids('file'), ...ids('photo')]) }
}

/** Resolve visible panel targets back to their authorization bindings. A
 * workspace panel may merge several source folders, whose binding ids are the
 * source ids rather than the shared panel id; include both so seeded/escalated
 * workspaces and multi-folder workspaces are each detached correctly. */
export function detachOperationsForFocuses(live: Live, focuses: PanelFocus[]): SessionContextOperation[] {
  const { wsIds, repoIds, connIds, attIds } = bucketFocuses(focuses)
  const ids = new Set<string>([...repoIds, ...connIds, ...attIds])
  for (const workspace of live.workspaces) {
    if (!wsIds.has(workspace.id)) continue
    ids.add(workspace.id)
    for (const artifact of workspace.artifacts) if (artifact.source?.id) ids.add(artifact.source.id)
    for (const folder of workspace.folders ?? []) ids.add(folder.id)
  }
  return [...ids].map((contextId) => ({ action: 'detach' as const, contextId }))
}

/** Remove one or more attached contexts in a single update (a repo + its orphaned
 *  GitHub connector, a connector + its dependent repos, or just a connector). */
export function removeContextsFromLive(l: Live, focuses: PanelFocus[]): Live {
  const { wsIds, repoIds, connIds, attIds } = bucketFocuses(focuses)
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
  const workspaces = l.workspaces
    .map((w) => {
      const artifacts = w.artifacts.filter((a) => a.source?.id !== sourceId)
      const folders = w.folders?.filter((folder) => folder.id !== sourceId)
      if (artifacts.length === w.artifacts.length && (folders?.length ?? 0) === (w.folders?.length ?? 0)) return w
      if (artifacts.length === 0 && (folders?.length ?? 0) === 0) return null
      return { ...w, artifacts, ...(w.folders ? { folders: folders ?? [] } : {}) }
    })
    .filter((w): w is Workspace => w !== null)
  return {
    ...l,
    workspaces,
  }
}

/** Remove a single file/photo attachment. */
export function removeAttachmentFromLive(l: Live, id: string): Live {
  return { ...l, attachments: l.attachments.filter((a) => a.id !== id) }
}
