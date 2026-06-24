/** ── The live session workspace (server-owned) ─────────────────────────────
 *  The session's panels — workspaces, repos, connectors, attachments — are the
 *  live view its conversation has grown. The server owns this view (so a runtime
 *  attach survives a reload, the way the conversation now does): it materializes
 *  it once from the session's flat seed fields, then mutates it as context is
 *  attached/detached. `workspaceFromSeed` is that seeding step.
 *
 *  The label/branch derivations below mirror the client's instant-render
 *  (src/data/liveSession.ts) so the seed view is identical on both sides — the
 *  client renders from the static seed for an instant, then reconciles to this. */
import type { Session, SessionWorkspace, Workspace, Repo } from '../contract/index.ts'

export const EMPTY_WORKSPACE: SessionWorkspace = {
  workspaces: [],
  repos: [],
  connectors: [],
  attachments: [],
}

/** The display name of a session's seeded workspace — its title as a `folder/`. */
function workspaceNameFor(session: Session): string {
  return (
    session.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') + '/'
  )
}

// The seed branch / remote for the two scripted sessions that carry a repo —
// demo seed data, not a general registry (mirrors src/data/liveSession.ts).
const SEED_BRANCHES: Record<string, string> = {
  'insights-launch': 'feat/insights-dashboard',
  'auth-refactor': 'refactor/auth-middleware',
}
const SEED_REMOTES: Record<string, string> = {
  'insights-launch': 'patrick-yingxi-pan/web-app',
  'auth-refactor': 'patrick-yingxi-pan/server',
}
const branchFor = (id: string) => SEED_BRANCHES[id] ?? 'main'
const remoteFor = (id: string) => SEED_REMOTES[id] ?? 'origin'

/** Materialize a session's live workspace from its flat seed fields. The demo
 *  starts empty and grows during the guided tour (client-side), so it seeds empty;
 *  every other session derives its workspace (if it has artifacts) and its repo (if
 *  it has files/diff/terminal) the same way the client's instant render does. */
export function workspaceFromSeed(session: Session): SessionWorkspace {
  if (session.isDemo) return { ...EMPTY_WORKSPACE }
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
  return { workspaces, repos, connectors: session.connectors ?? [], attachments: [] }
}
