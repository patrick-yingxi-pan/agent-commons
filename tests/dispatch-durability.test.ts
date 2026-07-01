/** P7 dispatch durability — a live one-off run persists across a restart, and one caught
 *  `running` by a restart (its completing timer died with the process) is swept to `failed`
 *  on rehydrate (crash recovery), which is what makes the `'failed'` status reachable. Seed
 *  runs that are `running` for visual variety are left alone — they aren't live-minted.
 *  Mirrors the schedule daemon's stale-run sweep. Boots through the REAL rehydrate path
 *  (store.initPersistence → loadState → rehydrate). DATA_FILE points at a throwaway path. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveState, STORE_VERSION } from '../server/persist.ts'

const FILE = join(tmpdir(), `claude-ui-dispatch-durability-${process.pid}.json`)
process.env.DATA_FILE = FILE

after(() => {
  for (const f of [FILE, FILE + '.tmp']) {
    try {
      rmSync(f)
    } catch {
      /* already gone */
    }
  }
})

test('a live dispatch left running is swept to failed on rehydrate; a live done run survives; seed runs untouched', async () => {
  // A snapshot captured mid-flight: a LIVE run still `running` (timer gone), a LIVE run
  // already `done` (should survive verbatim), and a SEED run `running` for visual variety.
  const snap = {
    version: STORE_VERSION,
    sessions: [],
    bindings: [],
    workspaces: [],
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
    dispatch: [
      { id: 'd-new-9', title: 'Live in-flight', status: 'running', startedAt: 1, detail: 'Working…' },
      { id: 'd-new-8', title: 'Live finished', status: 'done', startedAt: 1, detail: 'All set.' },
      { id: 'd1', title: 'Seed variety', status: 'running', startedAt: 1, detail: 'Seed run' },
    ],
    seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 1, systemPrompt: 1, agent: 1, commission: 1, dispatch: 9 },
  }
  saveState(snap)

  const { store } = await import('../server/store.ts')
  store.initPersistence() // loadState → rehydrate (runs the dispatch sweep)

  const feed = store.listDispatch()
  const inFlight = feed.find((d) => d.id === 'd-new-9')
  assert.equal(inFlight?.status, 'failed', 'the live in-flight run was swept to failed (crash recovery)')
  assert.match(inFlight?.detail ?? '', /Interrupted by a server restart/, 'the swept run explains why it failed')

  const finished = feed.find((d) => d.id === 'd-new-8')
  assert.equal(finished?.status, 'done', 'a live run that had already finished survives verbatim')

  const seed = feed.find((d) => d.id === 'd1')
  assert.equal(seed?.status, 'running', 'a seed run is NOT swept (it is not live-minted)')
})
