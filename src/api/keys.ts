/** Cache keys + API paths, defined once so a query and the event that invalidates
 *  it can't drift. `keys.*` index the client cache; `paths.*` are the URLs under
 *  `API_BASE`. Both grow per resource as reads migrate. */
import type { Connector } from '../../contract/index.ts'

export const keys = {
  capabilities: 'capabilities',
  providers: 'providers',
  systemPrompts: 'system-prompts',
  /** Worker Agents (docs/agent-commons.md, D6). Distinct from `runners` below — whose
   *  cache key is the legacy string 'agents' from before the D6 rename. */
  workerAgents: 'worker-agents',
  /** Commissions, keyed per project so a Project's Contributor list caches on its own. */
  commissions: (projectId?: string) => (projectId ? `commissions:${projectId}` : 'commissions'),
  /** A commission's effective (Project-clamped) authority — the D12 reach. */
  commissionAuthority: (id: string) => `commission-authority:${id}`,
  runners: 'agents',
  runnerEffects: (id: string) => `runner-effects:${id}`,
  resourceStatus: (key: string) => `resource:${key}`,
  sessions: 'sessions',
  session: (id: string) => `session:${id}`,
  sessionContexts: (id: string) => `session-contexts:${id}`,
  dispatch: 'dispatch',
  savedContexts: 'saved-contexts',
  connectorDetail: (id: string) => `connector-detail:${id}`,
  /** Keyed per session so the context-window figure tracks the open thread. */
  usage: (sessionId?: string) => (sessionId ? `usage:${sessionId}` : 'usage'),
  artifactContent: 'artifact-content',
  scheduleTemplates: 'schedule-templates',
  projects: 'projects',
  artifacts: 'artifacts',
  schedules: 'schedules',
  relations: 'relations',
  recentRuns: 'runs-recent',
  recents: 'recents',
}

export const paths = {
  capabilities: '/capabilities',
  providers: '/providers',
  provider: (id: string) => `/providers/${encodeURIComponent(id)}`,
  systemPrompts: '/system-prompts',
  systemPrompt: (id: string) => `/system-prompts/${encodeURIComponent(id)}`,
  agents: '/agents',
  agent: (id: string) => `/agents/${encodeURIComponent(id)}`,
  commissions: (projectId?: string) =>
    projectId ? `/commissions?project=${encodeURIComponent(projectId)}` : '/commissions',
  commission: (id: string) => `/commissions/${encodeURIComponent(id)}`,
  commissionAuthority: (id: string) => `/commissions/${encodeURIComponent(id)}/authority`,
  // The native-only endpoints (`/fs/pick`, `/fs/folders/:id`, `/git/repos/:id/diff`)
  // are intentionally absent here — no live UI flow calls them. They exist behind the
  // capability gate and are exercised by the contract via tests + `BACKEND=remote`
  // (which 409s them); that gate, not a client caller, is what demonstrates portability.
  runners: '/runners',
  runner: (id: string) => `/runners/${encodeURIComponent(id)}`,
  runnerInvoke: (id: string) => `/runners/${encodeURIComponent(id)}/invoke`,
  runnerEffects: (id: string) => `/runners/${encodeURIComponent(id)}/effects`,
  runnerSync: (id: string) => `/runners/${encodeURIComponent(id)}/sync`,
  resource: (key: string) => `/resources/${encodeURIComponent(key)}`,
  resourceReserve: (key: string) => `/resources/${encodeURIComponent(key)}/reserve`,
  reservationCommit: (id: string) => `/reservations/${encodeURIComponent(id)}/commit`,
  reservationRelease: (id: string) => `/reservations/${encodeURIComponent(id)}/release`,
  sessions: '/sessions',
  session: (id: string) => `/sessions/${encodeURIComponent(id)}`,
  sessionContexts: (id: string) => `/sessions/${encodeURIComponent(id)}/contexts`,
  sessionContext: (id: string, contextId: string) =>
    `/sessions/${encodeURIComponent(id)}/contexts/${encodeURIComponent(contextId)}`,
  sessionWorkspace: (id: string) => `/sessions/${encodeURIComponent(id)}/workspace`,
  dispatch: '/dispatch',
  savedContexts: '/saved-contexts',
  savedContext: (id: string) => `/saved-contexts/${encodeURIComponent(id)}`,
  connectorDetail: (c: Connector) => {
    const q = new URLSearchParams({ id: c.id, label: c.label })
    if (c.kind) q.set('kind', c.kind)
    return `/connectors/detail?${q.toString()}`
  },
  usage: (sessionId?: string) => (sessionId ? `/usage?session=${encodeURIComponent(sessionId)}` : '/usage'),
  artifactContent: '/artifact-content',
  scheduleTemplates: '/schedule-templates',
  projects: '/projects',
  artifacts: '/artifacts',
  schedules: '/schedules',
  schedule: (id: string) => `/schedules/${encodeURIComponent(id)}`,
  scheduleRun: (id: string) => `/schedules/${encodeURIComponent(id)}/run`,
  relations: '/relations',
  relationOps: '/relations/ops',
  recentRuns: '/runs/recent',
  recents: '/recents',
  recentsType: (type: string) => `/recents/${encodeURIComponent(type)}`,
}
