/** ── Locking test: pre-v2 relay capability normalisation on rehydrate ─────────
 *  A relay's tool-use capability is the MAILBOX's — code-owned, like the seed
 *  tenancy stamps (P9). v1 minted Session providers `toolUse:false` (the
 *  prose-only mailbox); the v2 framed mailbox relays tool calls, so a restored
 *  pre-v2 config must be normalised UP on load — otherwise old relays would stay
 *  pinned to a capability the code no longer has. The durable re-bind identity
 *  (the secret hash) must survive the same load untouched (§6.1). Boots through
 *  the REAL rehydrate path (store.initPersistence → loadState → rehydrate);
 *  DATA_FILE points at a throwaway path, so this file owns its own process. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveState, STORE_VERSION } from './persist.ts'
import { hashRelaySecret } from '../relay.ts'

const FILE = join(tmpdir(), `claude-ui-relay-migrate-${process.pid}.json`)
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

test('a pre-v2 session config (toolUse:false) is normalised to the mailbox’s capability; the secret hash survives', async () => {
  const SECRET = 'rv_live_pre_v2_secret'
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
    dispatch: [],
    // A v1-shaped Session provider: prose-only stamp, hashed secret.
    providers: [
      [
        'provider-91',
        { id: 'provider-91', label: 'Pre-v2 relay', modelFamily: 'claude', effortLevels: ['Default'], kind: 'session', secretHint: 'cret', tenantId: 'tenant-acme' },
      ],
    ],
    providerConfigs: [['provider-91', { kind: 'session', capabilities: { toolUse: false }, secretHash: hashRelaySecret(SECRET) }]],
    seq: { session: 0, message: 0, schedule: 0, run: 0, artifact: 0, provider: 91, systemPrompt: 1, agent: 1, commission: 1, dispatch: 0 },
  }
  saveState(snap as never)

  const { store } = await import('../store/index.ts')
  store.initPersistence() // loadState → rehydrate (runs the capability normalisation)

  const config = store.providerConfig('provider-91')
  assert.equal(config.kind, 'session', 'the provider row + config rehydrated')
  assert.equal(config.capabilities?.toolUse, true, 'the code-owned mailbox capability is re-stamped on load')
  assert.equal(store.relayProviderForSecret(SECRET), 'provider-91', 'the held secret still re-binds after the migration (§6.1)')
})
