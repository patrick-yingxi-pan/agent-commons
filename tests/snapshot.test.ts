/** Tests for the backup/restore tool (scripts/snapshot.ts).
 *
 *  Two things to lock:
 *   1. save → break → restore round-trips the live store file byte-for-byte (the
 *      whole point: click around, then roll back). Pure fs, no store.
 *   2. The COMPREHENSIVENESS INVARIANT: `build` produces a snapshot that populates
 *      EVERY persisted slice — every graph sub-map, plus sessions/bindings/
 *      workspaces/schedules/recents/savedContexts/seq. If a future field is added
 *      to PersistedState but the builder forgets to exercise it, this fails — so
 *      "the comprehensive playground" stays comprehensive as the store grows.
 *
 *  DATA_FILE is pointed at throwaway temp paths so the real `.data/store.json` is
 *  never touched (mirrors tests/persist.test.ts). */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { saveSnapshot, restoreSnapshot, listSnapshots, buildComprehensive } from '../scripts/snapshot.ts'

const TMP = join(tmpdir(), `claude-ui-snapshot-test-${process.pid}`)
const FS_STORE = join(TMP, 'fs', '.data', 'store.json')
const BUILD_STORE = join(TMP, 'build', '.data', 'store.json')

after(() => {
  try {
    rmSync(TMP, { recursive: true, force: true })
  } catch {
    /* already gone */
  }
})

test('save → break → restore round-trips the live store byte-for-byte', () => {
  process.env.DATA_FILE = FS_STORE
  mkdirSync(dirname(FS_STORE), { recursive: true })
  const original = JSON.stringify({ marker: 'original', n: 1 })
  writeFileSync(FS_STORE, original)

  const { to } = saveSnapshot('rt')
  assert.ok(existsSync(to), 'the snapshot file is written')

  // "Click around and break things."
  writeFileSync(FS_STORE, JSON.stringify({ marker: 'broken' }))
  restoreSnapshot('rt')

  assert.equal(readFileSync(FS_STORE, 'utf8'), original, 'restore brings back the exact bytes')
})

test('listSnapshots reports the saved snapshot', () => {
  process.env.DATA_FILE = FS_STORE
  assert.ok(
    listSnapshots().some((s) => s.name === 'rt'),
    'the snapshot just saved shows up in the listing',
  )
})

test('a name that escapes the snapshots dir is rejected', () => {
  process.env.DATA_FILE = FS_STORE
  assert.throws(() => saveSnapshot('../escape'), /invalid snapshot name/)
  assert.throws(() => restoreSnapshot('a/b'), /invalid snapshot name/)
})

test('restore fails clearly when the snapshot does not exist', () => {
  process.env.DATA_FILE = FS_STORE
  assert.throws(() => restoreSnapshot('does-not-exist'), /no snapshot named/)
})

test('build produces a snapshot covering every persisted slice', async () => {
  rmSync(BUILD_STORE, { force: true })
  process.env.DATA_FILE = BUILD_STORE
  const s = await buildComprehensive()
  const g = s.graph

  // ── every graph sub-map exercised (one relation op per pair) ──
  assert.ok(g.extraProjects.some((p) => p.id === 'p-playground'), 'create-project → extraProjects')
  assert.ok(g.extraArtifacts.length >= 3, 'save-artifact ×2 + standing run → extraArtifacts')
  assert.ok(g.extraArtifacts.some((a) => a.projectId === 'p-playground'), 'a created artifact filed under the project')
  assert.ok(g.extraArtifacts.some((a) => !a.projectId), 'a created artifact left unfiled')
  assert.ok(Object.keys(g.sessionProject).length > 0, 'file-session → sessionProject')
  assert.ok(Object.keys(g.artifactProject).length > 0, 'refile-artifact → artifactProject')
  assert.ok(Object.values(g.artifactProject).includes(''), 'an artifact unfiled (mapped to "")')
  assert.ok(Object.keys(g.scheduleProject).length > 0, 'link-schedule-project → scheduleProject')
  assert.ok(Object.keys(g.projectContexts).length > 0, 'scope-context → projectContexts')
  assert.ok(Object.keys(g.artifactSource).length > 0, 'set-artifact-source → artifactSource')
  assert.ok(Object.keys(g.scheduleArtifact).length > 0, 'set-schedule-artifact → scheduleArtifact')
  assert.ok(Object.keys(g.scheduleSession).length > 0, 'set-schedule-session → scheduleSession')
  assert.ok(Object.keys(g.scheduleExtraTools).length > 0, 'schedule-add-tool → scheduleExtraTools')
  assert.ok(Object.keys(g.standingApprovals).length >= 3, 'the three standing approvals recorded')

  // ── every store-owned slice exercised ──
  const created = s.sessions.find((x) => x.id.startsWith('sess-'))
  assert.ok(created, 'a created session exists')
  assert.ok((created?.messages?.length ?? 0) >= 2, 'the created session carries its exchange')
  assert.ok(s.bindings.some(([sid]) => sid.startsWith('sess-')), 'the created session has an attached context')
  assert.ok(s.workspaces.some(([sid]) => sid.startsWith('sess-')), 'the created session has a live workspace')
  const ws = s.workspaces.find(([sid]) => sid.startsWith('sess-'))?.[1]
  assert.ok(ws && ws.repos.length > 0 && ws.workspaces.length > 0 && ws.connectors.length > 0 && ws.attachments.length > 0, 'the workspace populates all four panel kinds')
  assert.ok(s.schedules.some((t) => t.id.startsWith('s-new-')), 'a created schedule exists')
  assert.ok(
    s.schedules.some((t) => t.runs.some((r) => r.id.startsWith('run-live-') && r.status === 'ok')),
    'a live run ran to completion (so its standing artifact was delivered)',
  )
  assert.ok(s.schedules.some((t) => t.enabled === false), 'a paused schedule for variety')
  assert.ok((s.savedContexts?.length ?? 0) > 0, 'saved contexts present (auth status flipped)')
  assert.ok(s.recents.repo.includes('repo-playground'), 'a recent was promoted')

  // ── Agent Commons registries exercised (D6/D9/D10/D7) ──
  assert.ok(
    s.providers?.some(([, p]) => p.label === 'Playground provider'),
    'createProvider → providers',
  )
  assert.ok(
    s.providerConfigs?.some(([, c]) => c.model === 'claude-opus-4-8'),
    'the provider config (server-only model id) rides along',
  )
  assert.ok(
    s.systemPrompts?.some(([, p]) => p.label === 'Playground research prompt'),
    'createSystemPrompt → systemPrompts',
  )
  assert.ok(
    s.agents?.some(([, a]) => a.label === 'Playground research agent'),
    'createAgentFromRequest → agents',
  )
  assert.ok(
    s.commissions?.some(([, c]) => c.projectId === 'p-insights'),
    'createCommission → commissions',
  )
  assert.ok(
    s.commissionCaps?.some(([id, cap]) => id === 'p-insights' && cap === 8),
    'setCommissionCap → commissionCaps overlay (D13)',
  )
  assert.ok(
    s.auditLog?.some((e) => e.channel === 'project-effect' && e.outcome === 'fulfilled'),
    'runProjectEffect → auditLog (D15/OQ7)',
  )

  // ── id counters all advanced (so post-restore mints never collide) ──
  for (const k of ['session', 'message', 'schedule', 'run', 'artifact', 'provider', 'systemPrompt', 'agent', 'commission'] as const) {
    assert.ok(s.seq[k] > 0, `seq.${k} advanced`)
  }
})

test('the built snapshot boots through the real rehydrate path', async () => {
  // Consumer-side lock: whatever `build` writes must be consumable by the exact
  // server boot path the product uses (store.initPersistence → loadState →
  // rehydrate), then visible through the public getters the routes/UI read. This
  // is what keeps the snapshot's CONTENTS consistent with the code that uses them:
  // if `build` ever wrote a field rehydrate doesn't restore, these would fail.
  // (Runs after the build test, which wrote BUILD_STORE.)
  process.env.DATA_FILE = BUILD_STORE
  assert.ok(existsSync(BUILD_STORE), 'the build test wrote the snapshot this test boots')
  const { store } = await import('../server/store.ts')
  store.initPersistence() // loadState(BUILD_STORE) → rehydrate replaces in-memory state from disk

  const projectIds = [...store.listProjects(), ...store.relationGraph().extraProjects].map((p) => p.id)
  assert.ok(projectIds.includes('p-playground'), 'the created project survives a boot')
  assert.ok(store.listSchedules().some((t) => t.id.startsWith('s-new-')), 'the created schedule survives a boot')
  assert.ok(store.relationGraph().extraArtifacts.length >= 3, 'the created artifacts survive a boot')

  const created = store.listSessions().find((x) => x.id.startsWith('sess-'))
  assert.ok(created, 'the created session is listed after a boot')
  const full = created && store.getSession(created.id)
  assert.ok(full && (full.messages?.length ?? 0) >= 2, 'getSession returns the rehydrated thread')
  assert.ok(full && (full.workspace?.repos.length ?? 0) > 0, 'getSession surfaces the rehydrated workspace')

  // The Agent Commons registries survive the boot too (D6/D9/D10/D7).
  const provider = store.listProviders().find((p) => p.label === 'Playground provider')
  assert.ok(provider, 'the created provider survives a boot')
  assert.equal(store.providerModel(provider?.id), 'claude-opus-4-8', 'its server-only config (model id) survives too')
  assert.ok(store.listSystemPrompts().some((p) => p.label === 'Playground research prompt'), 'the created system prompt survives a boot')
  const agent = store.listAgents().find((a) => a.label === 'Playground research agent')
  assert.ok(agent && agent.providerId === provider?.id, 'the created agent (bound to the provider) survives a boot')
  assert.ok(store.listCommissions('p-insights').some((c) => c.agentId === agent?.id), 'the created commission survives a boot')
  assert.equal(store.listProjects().find((p) => p.id === 'p-insights')?.commissionCap, 8, 'the D13 commission cap survives a boot')
  assert.ok(store.listAuditLog().some((e) => e.channel === 'project-effect'), 'the D15 audit trail survives a boot')
})
