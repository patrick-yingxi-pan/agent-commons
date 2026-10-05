import type { ContextCatalog, ConnectorCatalogOption, RepoCatalogOption, SavedContext } from '../contract/contexts.ts'
import { CONNECTOR_OPTIONS, GITHUB_REPO_OPTIONS, LOCAL_REPO_OPTIONS, MCP_OPTIONS } from './data/contextOptions.ts'
import { SAVED_CONTEXTS } from './data/savedContexts.ts'
import type { InitialWorld } from './initialWorld.ts'

const SAVED_BY_ID = new Map(SAVED_CONTEXTS.map((context) => [context.id, context]))

function repoBasename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

function connectorSetup(option: ConnectorCatalogOption): SavedContext {
  const seeded = SAVED_BY_ID.get(option.id)
  if (seeded) return structuredClone(seeded)
  return {
    id: option.id,
    label: option.label,
    kind: 'connector',
    connectorKind: option.kind ?? 'connector',
    status: 'connected',
    detail: 'Saved connection',
    lastUsedAt: null,
    sessions: 0,
  }
}

function mcpSetup(option: (typeof MCP_OPTIONS)[number]): SavedContext {
  const seeded = SAVED_BY_ID.get(option.id)
  if (seeded) return structuredClone(seeded)
  return {
    id: option.id,
    label: option.label,
    kind: 'mcp',
    status: 'connected',
    detail: option.meta,
    lastUsedAt: null,
    sessions: 0,
  }
}

function githubRepoSetup(option: (typeof GITHUB_REPO_OPTIONS)[number]): SavedContext {
  const seeded = SAVED_BY_ID.get(option.id)
  if (seeded) return structuredClone(seeded)
  return {
    id: option.id,
    label: option.remote,
    kind: 'repo',
    origin: 'github',
    dependsOnGitHub: true,
    status: 'connected',
    detail: `github · ${option.branch}`,
    lastUsedAt: null,
    sessions: 0,
  }
}

function localRepoSetup(option: (typeof LOCAL_REPO_OPTIONS)[number]): SavedContext {
  const seeded = SAVED_BY_ID.get(option.id)
  if (seeded) return structuredClone(seeded)
  return {
    id: option.id,
    label: repoBasename(option.path),
    kind: 'repo',
    origin: 'local',
    dependsOnGitHub: !!option.remote,
    status: 'connected',
    detail: `${option.path} · ${option.branch}${option.remote ? '' : ' · local only'}`,
    lastUsedAt: null,
    sessions: 0,
  }
}

/** Build the catalog for the persisted first-run world. Cloning on every read
 * keeps callers from mutating the fixture source or another projection. */
export function buildContextCatalog(world: InitialWorld): ContextCatalog {
  if (world === 'clean') {
    return { developmentFixtures: false, connectors: [], mcp: [], repos: [], setups: [] }
  }

  const connectors = structuredClone(CONNECTOR_OPTIONS)
  const mcp = structuredClone(MCP_OPTIONS)
  const repos: RepoCatalogOption[] = [
    ...structuredClone(GITHUB_REPO_OPTIONS).map((repo) => ({ ...repo, origin: 'github' as const })),
    ...structuredClone(LOCAL_REPO_OPTIONS).map((repo) => ({ ...repo, origin: 'local' as const })),
  ]
  const setups = [
    ...connectors.map(connectorSetup),
    ...mcp.map(mcpSetup),
    ...GITHUB_REPO_OPTIONS.map(githubRepoSetup),
    ...LOCAL_REPO_OPTIONS.map(localRepoSetup),
  ]
  return { developmentFixtures: true, connectors, mcp, repos, setups }
}
