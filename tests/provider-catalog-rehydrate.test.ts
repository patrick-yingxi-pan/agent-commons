/** A pre-catalog snapshot must not strip the seeded default provider's model
 *  catalog: `ModelProvider.models` on the default row is CODE-owned (one record
 *  set derives it AND the mock endpoint's `/v1/models` — server/model/catalog.ts),
 *  so rehydrate re-stamps it when the snapshot predates the field — the same
 *  re-stamp rule as seed tenancy (P9). A snapshot that DOES carry a catalog (a
 *  runtime refresh / a created provider's static list) wins verbatim. Boots
 *  through the REAL rehydrate path; DATA_FILE points at a throwaway file. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveState, STORE_VERSION } from '../server/persist.ts'
import { seedModels } from '../server/model/catalog.ts'
import { DEFAULT_PROVIDER_ID } from '../contract/index.ts'

const FILE = join(tmpdir(), `claude-ui-provider-catalog-rehydrate-${process.pid}.json`)
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

test('rehydrate re-stamps the default provider’s code-owned catalog; a stored catalog wins verbatim', async () => {
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
    // A pre-catalog build persisted the default provider WITHOUT `models`, plus a
    // created provider whose stored static catalog must survive the re-stamp.
    providers: [
      [DEFAULT_PROVIDER_ID, { id: DEFAULT_PROVIDER_ID, label: 'Anthropic', modelFamily: 'claude', effortLevels: ['Low', 'Medium', 'High'] }],
      ['provider-2', { id: 'provider-2', label: 'Static kept', modelFamily: 'llama', effortLevels: ['Standard'], models: [{ id: 'kept-1', label: 'Kept model' }], catalogSource: 'static' }],
    ],
    providerConfigs: [[DEFAULT_PROVIDER_ID, {}], ['provider-2', {}]],
    seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 2, systemPrompt: 1, agent: 1, commission: 1, dispatch: 0 },
  }
  saveState(snap)

  const { store } = await import('../server/store.ts')
  store.initPersistence() // loadState → rehydrate (runs the catalog re-stamp)

  const providers = store.listProviders()
  const def = providers.find((p) => p.id === DEFAULT_PROVIDER_ID)
  assert.deepEqual(def?.models, seedModels(), 'the code-owned catalog is back after a pre-catalog snapshot')
  assert.equal(def?.catalogSource, 'listed')

  const kept = providers.find((p) => p.id === 'provider-2')
  assert.deepEqual(kept?.models, [{ id: 'kept-1', label: 'Kept model' }], 'a stored catalog survives verbatim')
  assert.equal(kept?.catalogSource, 'static')
})
