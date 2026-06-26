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
  seq: { session: 3, message: 7, schedule: 1, run: 2, artifact: 0 },
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
