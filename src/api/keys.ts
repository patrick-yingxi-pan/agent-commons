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
  /** A Project's in-flight sub-goal reservations (D11 coordination). */
  projectSubGoals: (projectId: string) => `project-subgoals:${projectId}`,
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
  // Served filesystem sources (Files / Photos / Folder — contract/fs.ts). Keyed per
  // source / path so each catalog + folder scan + file body caches on its own.
  fsSources: 'fs-sources',
  fsCatalog: (source: string) => `fs-catalog:${source}`,
  fsFolder: (source: string, path: string) => `fs-folder:${source}:${path}`,
  fsText: (source: string, path: string) => `fs-text:${source}:${path}`,
  projects: 'projects',
  artifacts: 'artifacts',
  schedules: 'schedules',
  relations: 'relations',
  recentRuns: 'runs-recent',
  recents: 'recents',
  /** The detective audit trail (docs/agent-commons.md, D15/OQ7) — the cross-user effect log. */
  auditLog: 'audit-log',
}

export const paths = {
  capabilities: '/capabilities',
  providers: '/providers',
  provider: (id: string) => `/providers/${encodeURIComponent(id)}`,
  systemPrompts: '/system-prompts',
  systemPrompt: (id: string) => `/system-prompts/${encodeURIComponent(id)}`,
  systemPromptProbe: (id: string) => `/system-prompts/${encodeURIComponent(id)}/probe`,
  agents: '/agents',
  agent: (id: string) => `/agents/${encodeURIComponent(id)}`,
  commissions: (projectId?: string) =>
    projectId ? `/commissions?project=${encodeURIComponent(projectId)}` : '/commissions',
  commission: (id: string) => `/commissions/${encodeURIComponent(id)}`,
  commissionAuthority: (id: string) => `/commissions/${encodeURIComponent(id)}/authority`,
  projectSubGoals: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/subgoals`,
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
  toolActivity: (id: string, activityId: string) =>
    `/sessions/${encodeURIComponent(id)}/tool-activities/${encodeURIComponent(activityId)}`,
  sessionCompact: (id: string) => `/sessions/${encodeURIComponent(id)}/compact`,
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
  // Served filesystem sources (contract/fs.ts). `fsContent` returns raw bytes (an
  // image / binary), used directly as an `<img src>` — not via `apiGet` (which
  // JSON-parses); resolve it to an absolute URL with `fsContentUrl` in client.ts.
  fsSources: '/fs/sources',
  fsCatalog: (source: string) => `/fs/catalog?source=${encodeURIComponent(source)}`,
  fsFolder: (source: string, path: string) =>
    `/fs/folder?source=${encodeURIComponent(source)}&path=${encodeURIComponent(path)}`,
  fsText: (source: string, path: string) =>
    `/fs/text?source=${encodeURIComponent(source)}&path=${encodeURIComponent(path)}`,
  fsContent: (source: string, path: string) =>
    `/fs/content?source=${encodeURIComponent(source)}&path=${encodeURIComponent(path)}`,
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
  audit: '/audit',
}
