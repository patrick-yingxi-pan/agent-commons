/** Unit tests for the filesystem persistence layer (server/persist.ts) — the
 *  on-disk format the store snapshots to so UI operations survive a restart.
 *  Points DATA_FILE at a throwaway temp path so it never touches the real store. */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadState, saveState, STORE_VERSION } from '../server/persist.ts'

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
  for (const f of [FILE, FILE + '.tmp']) {
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

test('loadState ignores a version mismatch so an old snapshot cannot crash a new build', () => {
  saveState({ ...sample, version: STORE_VERSION + 999 })
  assert.equal(loadState(), null)
})
