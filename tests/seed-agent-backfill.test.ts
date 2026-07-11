/** P9 seed reconciliation for the default Agent's provider binding — a snapshot
 *  written before the seed carried an explicit `providerId` (the strict-API change,
 *  spec MODEL-15) restores `agent-default` unbound, and its card would read "no
 *  provider bound". The code seed is authoritative: rehydrate backfills the binding.
 *  Boots through the REAL path (store.initPersistence → loadState → rehydrate);
 *  DATA_FILE points at a throwaway snapshot. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveState, STORE_VERSION } from '../server/persist.ts'
import { DEFAULT_PROVIDER_ID } from '../contract/index.ts'

const FILE = join(tmpdir(), `claude-ui-seed-agent-backfill-${process.pid}.json`)
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

test('an old snapshot’s unbound default Agent gets the seed’s provider binding on rehydrate; a user agent is untouched', async () => {
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
    // The pre-MODEL-15 shape: the seeded default agent WITHOUT a provider binding,
    // plus a fork-style definition stub that must legitimately STAY unbound.
    agents: [
      ['agent-default', { id: 'agent-default', label: 'Default agent', systemPrompt: 'b', systemPromptId: 'sp-default', tools: [], instructions: '' }],
      ['agent-fork-1', { id: 'agent-fork-1', label: 'Forked stub', systemPrompt: 'b', tools: [], instructions: '' }],
    ],
    seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 1, systemPrompt: 1, agent: 1, commission: 1 },
  }
  saveState(snap)

  const { store } = await import('../server/store.ts')
  store.initPersistence() // loadState → rehydrate (runs the seed backfill)

  assert.equal(
    store.getAgent('agent-default').providerId,
    DEFAULT_PROVIDER_ID,
    'the seeded default Agent is re-bound to the code seed’s provider',
  )
  assert.equal(
    store.getAgent('agent-fork-1').providerId,
    undefined,
    'a definition-only stub (fork/import — capability never travels) stays unbound',
  )
})
