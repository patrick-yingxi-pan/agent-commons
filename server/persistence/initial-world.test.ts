/** First-boot world integration locks. Each boot runs in a fresh child process
 * because store state is intentionally module-singleton/import-time state. */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { PersistedState } from './format.ts'

const ROOT = new URL('../..', import.meta.url)
const STORE_MODULE = new URL('../store/index.ts', import.meta.url).href
const ACCOUNTS_MODULE = new URL('../accounts.ts', import.meta.url).href
const TMP = mkdtempSync(join(tmpdir(), 'agent-commons-initial-world-'))

after(() => rmSync(TMP, { recursive: true, force: true }))

interface WorldSummary {
  sessions: number
  projects: number
  extraProjects: number
  artifacts: number
  artifactContentKeys: string[]
  schedules: number
  providers: string[]
  prompts: string[]
  agents: string[]
  contextCatalog: { developmentFixtures: boolean; connectors: number; mcp: number; repos: number; setups: number }
  accounts: string[]
  identity: { userId: string; tenantId: string }
}

function boot(file: string, requested: 'demo' | 'clean', backend: 'mock' | 'remote' = 'mock'): WorldSummary {
  const source = `
    const { store } = await import(${JSON.stringify(STORE_MODULE)})
    const { accounts } = await import(${JSON.stringify(ACCOUNTS_MODULE)})
    store.initPersistence()
    console.log(JSON.stringify({
      sessions: store.listSessions().length,
      projects: store.listProjects().length,
      extraProjects: store.relationGraph().extraProjects.length,
      artifacts: store.listArtifacts().length,
      artifactContentKeys: Object.keys(store.artifactContent(store.identity().tenant.id)).sort(),
      schedules: store.listSchedules().length,
      providers: store.listProviders().map((row) => row.id),
      prompts: store.listSystemPrompts().map((row) => row.id),
      agents: store.listAgents().map((row) => row.id),
      contextCatalog: (() => {
        const catalog = store.contextCatalog()
        return {
          developmentFixtures: catalog.developmentFixtures,
          connectors: catalog.connectors.length,
          mcp: catalog.mcp.length,
          repos: catalog.repos.length,
          setups: catalog.setups.length,
        }
      })(),
      accounts: [...accounts.users.keys()],
      identity: { userId: store.identity().user.id, tenantId: store.identity().tenant.id },
    }))
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      INITIAL_WORLD: requested,
      PERSIST_BACKEND: 'json',
      DATA_FILE: file,
      BACKEND: backend,
    },
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout) as WorldSummary
}

test('a clean first boot contains infrastructure but no fictional user world, and stays clean', () => {
  const file = join(TMP, 'clean.json')
  const first = boot(file, 'clean')
  assert.deepEqual(first, {
    sessions: 0,
    projects: 0,
    extraProjects: 0,
    artifacts: 0,
    artifactContentKeys: [],
    schedules: 0,
    providers: ['provider-anthropic'],
    prompts: ['sp-default'],
    agents: ['agent-default'],
    contextCatalog: { developmentFixtures: false, connectors: 0, mcp: 0, repos: 0, setups: 0 },
    accounts: ['user-local'],
    identity: { userId: 'user-local', tenantId: 'tenant-personal' },
  })

  const stored = JSON.parse(readFileSync(file, 'utf8')) as PersistedState
  assert.equal(stored.initialWorld, 'clean')
  for (const rows of [
    stored.sessions,
    stored.modelPreferences,
    stored.schedules,
    stored.savedContexts,
    stored.dispatch,
    stored.commissions,
    stored.grants,
    stored.discussions,
    stored.socialProposals,
  ]) assert.deepEqual(rows, [], 'a user-authored/showcase slice starts empty')
  assert.deepEqual(stored.recents, { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] })
  assert.deepEqual(stored.recentsByTenant, [], 'clean first boot carries no other viewer’s recent ids')
  assert.deepEqual(stored.graph.extraProjects, [])
  assert.deepEqual(stored.graph.extraArtifacts, [])

  assert.deepEqual(boot(file, 'demo'), first, 'the persisted world wins over a changed environment on restart')
})

test('a clean hosted first boot has no account until signup and its front-door identity is anonymous', () => {
  const file = join(TMP, 'web-clean.json')
  const first = boot(file, 'clean', 'remote')
  assert.deepEqual(first.accounts, [])
  assert.deepEqual(first.artifactContentKeys, [], 'a clean hosted world exposes no demo bodies')
  assert.deepEqual(first.identity, { userId: 'user-anonymous', tenantId: 'tenant-anonymous' })

  const stored = JSON.parse(readFileSync(file, 'utf8')) as PersistedState
  assert.deepEqual(stored.accountUsers, [])
  assert.deepEqual(stored.accountTenants, [])
  assert.deepEqual(stored.memberships, [])
  assert.deepEqual(boot(file, 'demo', 'remote'), first, 'the hosted clean world remains stored across restart')
})

test('an established historical/demo database is never cleaned by a release environment', () => {
  const file = join(TMP, 'demo.json')
  const first = boot(file, 'demo')
  assert.ok(first.sessions > 0)
  assert.ok(first.projects > 0)
  assert.ok(first.extraProjects > 0)
  assert.ok(first.artifacts > 0)
  assert.ok(first.artifactContentKeys.includes('a1'), 'demo owner retains readable seed bodies')
  assert.ok(first.schedules > 0)
  assert.equal(first.contextCatalog.developmentFixtures, true)
  assert.ok(first.contextCatalog.connectors > 0)
  assert.ok(first.contextCatalog.mcp > 0)
  assert.ok(first.contextCatalog.repos > 0)
  assert.ok(first.accounts.includes('user-ada'))

  assert.deepEqual(boot(file, 'clean'), first, 'changing INITIAL_WORLD cannot reinterpret existing data')
  const stored = JSON.parse(readFileSync(file, 'utf8')) as PersistedState
  assert.equal(stored.initialWorld, 'demo')
})
