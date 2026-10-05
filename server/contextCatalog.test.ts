import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildContextCatalog } from './contextCatalog.ts'

test('clean context catalog contains no development fixture candidates', () => {
  assert.deepEqual(buildContextCatalog('clean'), {
    developmentFixtures: false,
    connectors: [],
    mcp: [],
    repos: [],
    setups: [],
  })
})

test('demo context catalog preserves the fixture candidates and saved setup projections', () => {
  const catalog = buildContextCatalog('demo')
  assert.equal(catalog.developmentFixtures, true)
  assert.ok(catalog.connectors.some((option) => option.id === 'slack'))
  assert.ok(catalog.mcp.some((option) => option.id === 'postgres' && option.meta === 'Query a Postgres database'))
  assert.ok(catalog.repos.some((option) => option.id === 'gh-api' && option.origin === 'github'))
  assert.ok(catalog.repos.some((option) => option.id === 'lr-scripts' && option.origin === 'local'))
  assert.equal(catalog.setups.find((setup) => setup.id === 'stripe')?.detail, 'Saved connection',
    'a fallback description does not impersonate current connection status')

  const slack = catalog.setups.find((setup) => setup.id === 'slack')
  assert.deepEqual(slack, {
    id: 'slack',
    label: 'Slack',
    kind: 'connector',
    connectorKind: 'connector',
    status: 'connected',
    detail: 'acme.slack.com · 3 channels',
    lastUsedAt: slack?.lastUsedAt,
    sessions: 4,
  })
  assert.equal(typeof slack?.lastUsedAt, 'number')

  const newRepo = catalog.setups.find((setup) => setup.id === 'gh-api')
  assert.deepEqual(newRepo, {
    id: 'gh-api',
    label: 'acme/api-gateway',
    kind: 'repo',
    origin: 'github',
    dependsOnGitHub: true,
    status: 'connected',
    detail: 'github · main',
    lastUsedAt: null,
    sessions: 0,
  })
})

test('catalog results are detached from fixture constants', () => {
  const first = buildContextCatalog('demo')
  first.repos[0]!.files.push({ path: 'mutation.ts', status: 'added' })
  first.setups[0]!.label = 'mutated'

  const second = buildContextCatalog('demo')
  assert.ok(!second.repos[0]!.files.some((file) => file.path === 'mutation.ts'))
  assert.notEqual(second.setups[0]!.label, 'mutated')
})
