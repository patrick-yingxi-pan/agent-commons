/** Unit tests for the filesystem persistence layer (server/persistence/persist.ts) — the
 *  on-disk format the store snapshots to so UI operations survive a restart.
 *  Points DATA_FILE at a throwaway temp path so it never touches the real store. */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadState, PersistenceLoadError, saveState, STORE_VERSION } from './persist.ts'

const FILE = join(tmpdir(), `claude-ui-persist-test-${process.pid}.json`)
process.env.DATA_FILE = FILE

const sample = {
  version: STORE_VERSION,
  sessions: [
    {
      id: 's1',
      title: 'Hi',
      caps: ['chat'],
      preview: 'p',
      // The composer's model pick rides the session row (session-model-pick.test.ts).
      providerId: 'provider-x',
      messages: [{ id: 'm', role: 'user', content: 'x' }],
    },
  ],
  bindings: [['s1', [{ id: 'c1', type: 'repo', label: 'r', scope: '*' }]]],
  workspaces: [['s1', { workspaces: [], repos: [], connectors: [], attachments: [] }]],
  schedules: [],
  recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
  graph: {
    sessionProject: {},
    artifactProject: {},
    scheduleProject: {},
    projectContexts: {},
    artifactSource: {},
    scheduleArtifact: {},
    scheduleSession: {},
    scheduleExtraTools: {},
    extraArtifacts: [],
    extraProjects: [],
    standingApprovals: {},
  },
  // The Agent Commons registries (D6/D9/D10/D7) — one entry each so the round-trip
  // locks that they (and the server-only provider config) survive save → load.
  providers: [['provider-x', { id: 'provider-x', label: 'P', modelFamily: 'claude', effortLevels: ['Low'] }]],
  providerConfigs: [['provider-x', { model: 'claude-opus-4-8' }]],
  systemPrompts: [['sp-x', { id: 'sp-x', label: 'S', body: 'b', targetFamily: 'claude' }]],
  agents: [['agent-x', { id: 'agent-x', label: 'A', systemPrompt: 'b', tools: [], instructions: '' }]],
  commissions: [['commission-x', { id: 'commission-x', agentId: 'agent-x', projectId: 'p1' }]],
  seq: { session: 3, message: 7, schedule: 1, run: 2, artifact: 0, provider: 1, systemPrompt: 1, agent: 1, commission: 1 },
}

afterEach(() => {
  for (const f of [FILE, FILE + '.tmp', FILE + '.corrupt']) {
    try {
      rmSync(f)
    } catch {
      /* already gone */
    }
  }
})

test('saveState → loadState round-trips the snapshot', () => {
  saveState(sample)
  assert.ok(existsSync(FILE), 'the snapshot file is written')
  assert.deepEqual(loadState(), sample, 'the loaded state equals what was saved')
})

test('loadState returns null when the file is absent (caller seeds fresh)', () => {
  try {
    rmSync(FILE)
  } catch {
    /* already gone */
  }
  assert.equal(loadState(), null)
})

test('loadState refuses to seed while an orphan atomic-write temp remains', () => {
  const recovery = JSON.stringify(sample)
  writeFileSync(`${FILE}.tmp`, recovery)
  assert.throws(() => loadState(), /recovery data remains/)
  assert.equal(existsSync(FILE), false, 'the missing live path is not recreated by load')
  assert.equal(readFileSync(`${FILE}.tmp`, 'utf8'), recovery, 'the recovery candidate remains intact')
})

test('loadState refuses an existing version mismatch without changing its bytes', () => {
  const future = JSON.stringify({ ...sample, version: STORE_VERSION + 999 })
  writeFileSync(FILE, future)
  assert.throws(() => loadState(), PersistenceLoadError)
  assert.equal(readFileSync(FILE, 'utf8'), future)
})

test('loadState refuses a structurally invalid existing snapshot in place', () => {
  const invalid = JSON.stringify({ version: STORE_VERSION })
  writeFileSync(FILE, invalid)
  assert.throws(() => loadState(), PersistenceLoadError)
  assert.equal(readFileSync(FILE, 'utf8'), invalid, 'the recovery source remains byte-for-byte intact')
  assert.equal(existsSync(FILE + '.corrupt'), false, 'startup does not rename or otherwise mutate live storage')
})

test('loadState refuses an unknown persisted initial world in place', () => {
  const invalid = JSON.stringify({ ...sample, initialWorld: 'mystery' })
  writeFileSync(FILE, invalid)
  assert.throws(() => loadState(), PersistenceLoadError)
  assert.equal(readFileSync(FILE, 'utf8'), invalid, 'the unknown discriminator is not normalized or rewritten')
})

test('loadState refuses malformed existing JSON in place', () => {
  const malformed = '{"version":'
  writeFileSync(FILE, malformed)
  assert.throws(() => loadState(), PersistenceLoadError)
  assert.equal(readFileSync(FILE, 'utf8'), malformed)
})
