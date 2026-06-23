/** Cache keys + API paths, defined once so a query and the event that invalidates
 *  it can't drift. `keys.*` index the client cache; `paths.*` are the URLs under
 *  `API_BASE`. Both grow per resource as reads migrate. */
import type { Connector } from '../../contract/index.ts'

export const keys = {
  capabilities: 'capabilities',
  agents: 'agents',
  agentEffects: (id: string) => `agent-effects:${id}`,
  sessions: 'sessions',
  session: (id: string) => `session:${id}`,
  dispatch: 'dispatch',
  savedContexts: 'saved-contexts',
  connectorDetail: (id: string) => `connector-detail:${id}`,
  usage: 'usage',
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
  agents: '/agents',
  agent: (id: string) => `/agents/${encodeURIComponent(id)}`,
  agentInvoke: (id: string) => `/agents/${encodeURIComponent(id)}/invoke`,
  agentEffects: (id: string) => `/agents/${encodeURIComponent(id)}/effects`,
  agentSync: (id: string) => `/agents/${encodeURIComponent(id)}/sync`,
  sessions: '/sessions',
  session: (id: string) => `/sessions/${encodeURIComponent(id)}`,
  dispatch: '/dispatch',
  savedContexts: '/saved-contexts',
  connectorDetail: (c: Connector) => {
    const q = new URLSearchParams({ id: c.id, label: c.label })
    if (c.kind) q.set('kind', c.kind)
    return `/connectors/detail?${q.toString()}`
  },
  usage: '/usage',
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
