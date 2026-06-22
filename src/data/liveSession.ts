import type { Attachment, Connector, Message, Repo, Session, Workspace } from '../types'

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
  updatedLabel: 'now',
  preview: '',
}

export function withConnector(list: Connector[], c: Connector): Connector[] {
  return list.some((x) => x.id === c.id) ? list : [...list, c]
}

// `slug` / `repoIdForLabel` are id-derivation invariants the client AND server
// must agree on, so they live in the contract; re-exported here for the existing
// `../data/liveSession` import sites.
export { repoIdForLabel, slug } from '../../contract/ids.ts'

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

/** Derive the live view from a seeded session: its workspace (if it has
 *  artifacts) and its repo (if it has files/diff/terminal). The demo starts
 *  empty and grows during the guided tour, so it derives to EMPTY_LIVE. */
export function liveFromSession(session: Session): Live {
  if (session.isDemo) return EMPTY_LIVE
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
