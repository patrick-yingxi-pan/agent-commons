/** Tests for the portable backup/restore tool (scripts/snapshot.ts).
 *
 *  Two things to lock:
 *   1. save → break → restore round-trips canonical state, including across the
 *      JSON ↔ SQLite backend boundary (the whole point: click, then roll back).
 *   2. The COMPREHENSIVENESS INVARIANT: `build` produces a snapshot that populates
 *      EVERY persisted slice — every graph sub-map, plus sessions/bindings/
 *      workspaces/schedules/recents/savedContexts/seq. If a future field is added
 *      to PersistedState but the builder forgets to exercise it, this fails — so
 *      "the comprehensive playground" stays comprehensive as the store grows.
 *
 *  DATA_FILE is pointed at throwaway temp paths so the real `.data/store.json` is
 *  never touched (mirrors server/persistence/persist.test.ts). */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { saveSnapshot, restoreSnapshot, listSnapshots, snapshotPath, buildComprehensive } from '../../scripts/snapshot.ts'
import { STORE_VERSION, type PersistedState } from './persist.ts'
import { SqliteBackend } from './sqlite.ts'
import {
  RECOVERY_SNAPSHOT_RETENTION,
  ensureDailyRecoverySnapshot,
  recoverySnapshotName,
} from './backup.ts'
import { accounts } from '../accounts.ts'

const TMP = join(tmpdir(), `claude-ui-snapshot-test-${process.pid}`)
const FS_STORE = join(TMP, 'fs', '.data', 'store.json')
const BUILD_STORE = join(TMP, 'build', '.data', 'store.json')
const SQLITE_STORE = join(TMP, 'sqlite', '.data', 'store.db')
const RECOVERY_STORE = join(TMP, 'recovery', 'store.json')
const RECOVERY_DIR = join(TMP, 'recovery', 'snapshots')

function stateNamed(title: string): PersistedState {
  return {
    version: STORE_VERSION,
    sessions: [{ id: 's1', title, caps: ['chat'], preview: title, messages: [] }],
    bindings: [],
    workspaces: [],
    schedules: [],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: {
      sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {},
      artifactSource: {}, scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {},
      extraArtifacts: [], extraProjects: [], standingApprovals: {},
    },
    seq: { session: 1, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
  } as PersistedState
}

after(() => {
  try {
    rmSync(TMP, { recursive: true, force: true })
  } catch {
    /* already gone */
  }
})

test('save → break → restore round-trips canonical live state', () => {
  process.env.PERSIST_BACKEND = 'json'
  process.env.DATA_FILE = FS_STORE
  mkdirSync(dirname(FS_STORE), { recursive: true })
  const original = stateNamed('original')
  writeFileSync(FS_STORE, JSON.stringify(original))

  const { to } = saveSnapshot('rt')
  assert.ok(existsSync(to), 'the snapshot file is written')
  if (process.platform !== 'win32') {
    assert.equal(statSync(dirname(to)).mode & 0o777, 0o700, 'the managed backup directory is private to the OS user')
    assert.equal(statSync(to).mode & 0o777, 0o600, 'portable backups are private to the OS user')
  }
  assert.throws(
    () => saveSnapshot('rt', { overwrite: false }),
    /refusing to replace existing snapshot/,
    'managed backup creation never overwrites an existing recovery point',
  )

  // "Click around and break things."
  writeFileSync(FS_STORE, JSON.stringify(stateNamed('broken')))
  restoreSnapshot('rt')

  assert.deepEqual(JSON.parse(readFileSync(FS_STORE, 'utf8')), original, 'restore brings back the canonical state')
})

test('listSnapshots reports the saved snapshot', () => {
  process.env.DATA_FILE = FS_STORE
  assert.ok(
    listSnapshots().some((s) => s.name === 'rt'),
    'the snapshot just saved shows up in the listing',
  )
})

test('daily recovery is idempotent, retains seven days, and never prunes manual backups', () => {
  process.env.PERSIST_BACKEND = 'json'
  process.env.DATA_FILE = RECOVERY_STORE
  process.env.SNAPSHOT_DIR = RECOVERY_DIR
  try {
    mkdirSync(dirname(RECOVERY_STORE), { recursive: true })
    writeFileSync(RECOVERY_STORE, JSON.stringify(stateNamed('day 1')))
    assert.equal(recoverySnapshotName(new Date('2026-08-01T23:59:00Z')), 'recovery-2026-08-01')
    assert.throws(() => recoverySnapshotName(new Date(Number.NaN)), /Invalid time value/)

    const first = ensureDailyRecoverySnapshot(new Date('2026-08-01T23:59:00Z'))
    assert.equal(first.created, true)
    const firstBytes = readFileSync(first.to, 'utf8')
    writeFileSync(RECOVERY_STORE, JSON.stringify(stateNamed('same day, newer live state')))
    const sameDay = ensureDailyRecoverySnapshot(new Date('2026-08-01T23:59:59Z'))
    assert.equal(sameDay.created, false, 'a second launch on the same UTC day reuses its recovery point')
    assert.equal(readFileSync(sameDay.to, 'utf8'), firstBytes, 'same-day startup never replaces the earlier recovery point')

    saveSnapshot('manual-forever', { overwrite: false })
    assert.throws(
      () => saveSnapshot('recovery-2026-08-11', { overwrite: false }),
      /recovery snapshot name family is reserved/,
      'manual tooling cannot create a file that automatic retention would own',
    )
    for (let day = 2; day <= 10; day += 1) {
      writeFileSync(RECOVERY_STORE, JSON.stringify(stateNamed(`day ${day}`)))
      ensureDailyRecoverySnapshot(new Date(Date.UTC(2026, 7, day, 12)))
    }

    const names = listSnapshots().map(({ name }) => name).sort()
    const recovery = names.filter((name) => name.startsWith('recovery-'))
    assert.equal(recovery.length, RECOVERY_SNAPSHOT_RETENTION)
    assert.deepEqual(recovery, [4, 5, 6, 7, 8, 9, 10].map((day) => `recovery-2026-08-${String(day).padStart(2, '0')}`))
    assert.ok(names.includes('manual-forever'), 'automatic retention never touches a manual snapshot')
  } finally {
    delete process.env.SNAPSHOT_DIR
  }
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

test('one portable snapshot restores across JSON and SQLite in both directions', () => {
  const portableDir = join(TMP, 'portable-snapshots')
  process.env.SNAPSHOT_DIR = portableDir
  process.env.DATA_FILE = FS_STORE
  process.env.DATABASE_PATH = SQLITE_STORE

  process.env.PERSIST_BACKEND = 'json'
  const jsonState = stateNamed('from JSON')
  writeFileSync(FS_STORE, JSON.stringify(jsonState))
  saveSnapshot('json-export')

  process.env.PERSIST_BACKEND = 'sqlite'
  restoreSnapshot('json-export')
  const sqlite = new SqliteBackend(SQLITE_STORE)
  assert.deepEqual(sqlite.load(), jsonState, 'a JSON export restores into SQLite')
  const sqliteState = stateNamed('from SQLite')
  sqlite.save(sqliteState)
  sqlite.close()
  saveSnapshot('sqlite-export')

  process.env.PERSIST_BACKEND = 'json'
  restoreSnapshot('sqlite-export')
  assert.deepEqual(JSON.parse(readFileSync(FS_STORE, 'utf8')), sqliteState, 'a SQLite export restores into JSON')

  delete process.env.SNAPSHOT_DIR
  delete process.env.DATABASE_PATH
})

test('an invalid portable snapshot is rejected before live storage changes', () => {
  process.env.PERSIST_BACKEND = 'json'
  process.env.DATA_FILE = FS_STORE
  const original = stateNamed('still live')
  writeFileSync(FS_STORE, JSON.stringify(original))
  const invalid = snapshotPath('invalid')
  mkdirSync(dirname(invalid), { recursive: true })
  writeFileSync(invalid, '{not json')

  assert.throws(() => restoreSnapshot('invalid'), /not readable JSON/)
  assert.deepEqual(JSON.parse(readFileSync(FS_STORE, 'utf8')), original)
})

test('build produces a snapshot covering every persisted slice', async () => {
  rmSync(BUILD_STORE, { force: true })
  process.env.DATA_FILE = BUILD_STORE
  const s = await buildComprehensive()
  const g = s.graph
  assert.equal(s.initialWorld, 'demo', 'development snapshot records its authored world')

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
  assert.ok(s.retiredSessionCreationIds?.includes('sess-new-000000000000000000000000'),
    'a removed keyed draft keeps its retirement identity')
  assert.ok(s.retiredSessionCreationIds?.includes('sess-fork-000000000000000000000000'),
    'a removed keyed conversation branch keeps its retirement identity')
  assert.ok(s.bindings.some(([sid]) => sid.startsWith('sess-')), 'the created session has an attached context')
  assert.ok(s.workspaces.some(([sid]) => sid.startsWith('sess-')), 'the created session has a live workspace')
  assert.ok(
    s.sessionPreferences?.some(([userId, rows]) =>
      userId === 'user-local' && rows.some(([sid, prefs]) => sid.startsWith('sess-') && prefs.panelFocus?.id === 'repo-playground')),
    'setSessionPreferences → viewer-scoped panel intent',
  )
  const ws = s.workspaces.find(([sid]) => sid.startsWith('sess-'))?.[1]
  assert.ok(ws && ws.repos.length > 0 && ws.workspaces.length > 0 && ws.connectors.length > 0 && ws.attachments.length > 0, 'the workspace populates all four panel kinds')
  assert.ok(s.schedules.some((t) => t.id.startsWith('s-new-')), 'a created schedule exists')
  const scheduled = s.schedules.find((t) => t.id.startsWith('s-new-'))
  assert.ok(Number.isFinite(scheduled?.nextFireAt), 'the enabled routine carries its durable next-fire cursor')
  assert.equal(scheduled?.missedFirePolicy, 'catch-up-once', 'the per-routine downtime policy is persisted')
  const completedRoutineRun = s.schedules.flatMap((t) => t.runs)
    .find((r) => r.id.startsWith('run-live-') && r.status === 'ok' && Number.isFinite(r.scheduledFor))
  assert.ok(
    completedRoutineRun,
    'a fire-time-keyed live run ran to completion (so its standing artifact was delivered)',
  )
  assert.equal(completedRoutineRun?.attempts, 1, 'the durable run preserves its completed attempt count')
  assert.equal(completedRoutineRun?.maxAttempts, 3, 'the durable run preserves its retry budget')
  assert.equal(completedRoutineRun?.nextAttemptAt, undefined, 'terminal completion clears the retry cursor')
  assert.ok(completedRoutineRun?.execution?.prompt, 'the durable run preserves its frozen executable definition')
  assert.ok(completedRoutineRun?.execution?.agentId && completedRoutineRun.execution.providerId,
    'the durable run preserves its frozen identity and endpoint binding')
  assert.ok(s.schedules.some((t) => t.enabled === false), 'a paused schedule for variety')
  assert.ok((s.savedContexts?.length ?? 0) > 0, 'saved contexts present (auth status flipped)')
  assert.ok(s.savedContexts?.some((context) => context.id === 'ctx-tenant-zeta' && context.tenantId === 'tenant-zeta'),
    'saved contexts retain their server-owned tenant partition')
  assert.ok(s.savedContexts?.some((context) => context.connectionRevision === 1),
    'a saved-context connection revision survives the durable snapshot')
  assert.ok(s.recents.repo.includes('repo-playground'), 'a recent was promoted')
  assert.ok(s.recentsByTenant?.some(([tenantId, recents]) => tenantId === 'tenant-zeta' && recents.repo.includes('repo-tenant-zeta')),
    'non-default viewer recents persist in their own partition')

  // ── Agent Commons registries exercised (D6/D9/D10/D7) ──
  assert.ok(
    s.providers?.some(([, p]) => p.label === 'Playground provider'),
    'createProvider → providers',
  )
  assert.equal(
    s.providers?.find(([, p]) => p.label === 'Playground provider')?.[1].definitionRevision,
    1,
    'the edited provider definition revision rides in the snapshot',
  )
  assert.ok(
    s.providerConfigs?.some(([, c]) => c.model === 'claude-opus-4-8'),
    'the provider config (server-only model id) rides along',
  )
  assert.ok(
    s.systemPrompts?.some(([, p]) => p.label === 'Playground research prompt'),
    'createSystemPrompt → systemPrompts',
  )
  assert.equal(
    s.systemPrompts?.find(([, p]) => p.label === 'Playground research prompt')?.[1].definitionRevision,
    1,
    'the edited prompt definition revision rides in the snapshot',
  )
  assert.ok(
    s.agents?.some(([, a]) => a.label === 'Playground research agent'),
    'createAgentFromRequest → agents',
  )
  assert.equal(
    s.agents?.find(([, a]) => a.label === 'Playground research agent')?.[1].revision,
    1,
    'the edited Agent configuration revision rides in the snapshot',
  )
  assert.ok(
    s.registryDefaults?.some(([, d]) => d.providerId && d.promptId),
    'setDefaultProvider/-SystemPrompt → registryDefaults (the per-tenant default-flag pointers)',
  )
  assert.ok(
    s.projectDefaultRoles?.some(([id, role]) => id === 'p-insights' && role === 'maintainer'),
    'setProjectDefaultRole → projectDefaultRoles (the D14 seed overlay)',
  )
  assert.ok(
    s.commissions?.some(([, c]) => c.projectId === 'p-insights'),
    'createCommission → commissions',
  )
  assert.equal(
    s.commissions?.find(([, c]) => c.agentId === s.agents?.find(([, a]) => a.label === 'Playground research agent')?.[0])?.[1].configurationRevision,
    1,
    'the edited contributor configuration revision rides in the snapshot',
  )
  assert.ok(
    s.commissionCaps?.some(([id, cap]) => id === 'p-insights' && cap === 8),
    'setCommissionCap → commissionCaps overlay (D13)',
  )
  assert.ok(
    s.auditLog?.some((e) => e.channel === 'project-effect' && e.outcome === 'fulfilled'),
    'runProjectEffect → auditLog (D15/OQ7)',
  )
  assert.ok(
    s.dispatch?.some((d) => d.id.startsWith('d-new-')),
    'addDispatch → dispatch feed (P7)',
  )
  assert.ok(
    s.openSubGoals?.some((o) => o.status === 'done' && o.resolvedBy),
    'postOpenSubGoal + standing dispatch → openSubGoals (D19, resolved state)',
  )
  assert.ok(
    s.openSubGoals?.some((o) => o.status === 'open'),
    'postOpenSubGoal → openSubGoals (D19, open/backlog state)',
  )
  assert.ok(
    s.openSubGoals?.some((o) => (o.comments?.length ?? 0) > 0),
    'commentOnOpenSubGoal → the item’s discussion thread (D23)',
  )
  assert.ok(
    s.grants?.some((g) => g.subject.id === 'p-playground' && g.note !== undefined),
    'createGrant → grants (social S1, the published share persists)',
  )
  assert.ok(
    s.discussions?.some((d) => d.anchor.ref.id === 'p-playground' && d.posts.length >= 1),
    'openDiscussion → discussions (social S2, the root thread persists)',
  )
  assert.ok(
    s.socialProposals?.some((p) => p.subject.id === 'p-playground' && p.discussionId),
    'openSocialProposal → socialProposals (S3, with its review thread minted)',
  )
  assert.ok(
    s.socialProposals?.some(
      (p) => p.delta.kind === 'artifact-patch' && Number.isSafeInteger(p.baseRevision) && typeof p.offeredBase === 'string',
    ),
    'applying proposal → durable offer revision + reviewed pre-image (PD80)',
  )
  assert.ok(
    s.grants?.some((g) => g.audience.kind === 'link' && g.audience.token.length > 0 && g.redeemedBy?.includes('tenant-playground-watcher')),
    'createGrant(link) + redeemGrant → the server-private redemption roster persists (S6)',
  )
  assert.ok(
    s.mutes?.some(([, names]) => names.includes('Playground muted actor')),
    'setMute → mutes (S5, the per-viewer earmuff slice)',
  )
  assert.ok(
    // The KEY shape too, not just the tenant: when the watch key generalized to
    // `kind:id` this generator still called the old signature, and a tenant-only
    // assertion passed happily while every watch persisted under
    // "undefined:undefined" (found in review, 2026-07-24).
    s.watches?.some(([tenantId, key]) => tenantId === 'tenant-playground-watcher' && key === 'project:p-playground'),
    'setWatch → watches (D24), keyed by subject',
  )
  assert.ok(
    (s.notifications?.length ?? 0) > 0,
    'notifyTenants fan-out → notifications inbox (D24)',
  )
  assert.ok(
    s.commonsLikes?.some(([tenantId]) => tenantId === 'tenant-playground-watcher'),
    'setCommonsLike → commonsLikes (S4, the Liked lens)',
  )
  assert.ok(
    s.views?.some(([tenantId, kind, id]) => tenantId === 'tenant-playground-watcher' && kind === 'project' && id === 'p-playground'),
    'recordView → views (S4, the Recently viewed lens)',
  )
  assert.ok(
    s.follows?.some(([tenantId, names]) => tenantId === 'tenant-beta' && names.includes('Ada Lovelace')),
    'setFollow → follows (S7, the per-viewer follow slice)',
  )
  const principalRows = s.discussions?.filter((d) => d.anchor.ref.kind === 'principal') ?? []
  const dmRow = principalRows.find((d) => d.targetTenant !== d.openerTenant)
  assert.ok(dmRow, 'openDiscussion on a principal → a DM persists as an ordinary discussion (S7)')
  assert.ok(
    // The SHAPE, not just the count: a post is self-anchored, and that identity
    // (target === opener) is what every wall branches on. A row-count assertion
    // would pass on two DMs.
    principalRows.some((d) => d.targetTenant === d.openerTenant && d.openerTenant === 'tenant-beta'),
    'openWallPost → a self-anchored discussion persists as a POST (S8)',
  )
  assert.ok(
    // The MARK's value too, not just the tenant: a read mark of 0 is
    // indistinguishable from an absent slice, so a generator that stopped
    // exercising the mutator would still satisfy a tenant-only assertion (the
    // lesson the `watches` key-shape assertion above was earned for).
    s.discussionReads?.some(([tenantId, marks]) => tenantId === 'tenant-beta' && marks.some(([did, seen]) => did === dmRow?.id && seen > 0)),
    'markDiscussionRead → discussionReads (S7, the DM inbox unread count)',
  )
  assert.ok(
    s.apiTokens?.some(([userId, rows]) => userId === 'user-ada' && rows.some((r) => r.label === 'playground token')),
    'mintApiToken → apiTokens (the bearer-token registry, PORT-9)',
  )
  assert.ok(
    // The BODY's content too, not just the key: an overlay entry holding the
    // unedited seed text would satisfy a key-only assertion while proving the
    // mutator never ran (the `watches` key-shape lesson, applied here).
    s.artifactBodies?.some(
      ([id, body]) => id.length > 0 && body.type === 'doc' && JSON.stringify(body.blocks).includes('Playground body edit'),
    ),
    'updateArtifactBlock → artifactBodies (S3, the artifact-patch body overlay), keyed by artifact id',
  )
  assert.ok(
    s.artifactBodies?.some(
      ([id, body]) => id.length > 0 && body.type === 'doc' && JSON.stringify(body.blocks).includes('portable snapshot path'),
    ),
    'save-artifact with a body → artifactBodies in the same portable snapshot',
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

  // ── A stored display name is a CACHE of its authority id (2026-08-09) ──────
  // Plant STALE names on the snapshot — exactly what a namespace rename leaves
  // behind in an existing .data/store.json — and require the boot to re-derive
  // them from the tenant ids stored beside them. Without this the seed rename
  // (Acme, Inc. → Ada Lovelace) booted the flagship demo half-renamed, its
  // seeded DM anchored on a name nobody bears.
  const stale = JSON.parse(readFileSync(BUILD_STORE, 'utf8'))
  // A runtime artifact from before tenant stamping must not come back as a
  // globally replayable row. Rehydrate owns this compatibility boundary rather
  // than requiring an old snapshot to be rewritten by hand.
  const legacyRuntimeArtifact = stale.graph.extraArtifacts.find((artifact: any) => artifact.name === 'Launch one-pager')
  assert.ok(legacyRuntimeArtifact, 'the snapshot carries a runtime-created artifact to de-stamp')
  delete legacyRuntimeArtifact.tenantId
  const dm = stale.discussions.find((d: any) => d.anchor.ref.kind === 'principal' && d.targetTenant)
  assert.ok(dm, 'the snapshot carries a principal-anchored thread to go stale')
  dm.anchor.ref.id = 'Stale, Inc.'
  dm.openedBy = 'Stale, Inc.'
  dm.posts[0].author = 'Stale, Inc.'
  const grant = stale.grants.find((g: any) => g.granterTenant)
  assert.ok(grant, 'and a grant with a granter id')
  grant.grantedBy = 'Stale, Inc.'
  // A FOLLOW has no id to re-derive from, so a rename orphans it — and the next
  // signup to take that name would silently inherit it. Orphans are pruned.
  const follower = stale.follows[0]
  assert.ok(follower, 'the snapshot carries a follow to orphan')
  follower[1] = [...follower[1], 'Stale, Inc.']

  // ── The inbox is a PROJECTION over acts (owner-reported 2026-08-09) ────────
  // Plant two LEGACY discussion bells — no postId, no actorTenant, exactly what
  // a row minted before those anchors looks like — each announcing an act that
  // cannot be found. A snapshot is where such rows live, so the sweep runs on
  // load. The third row announces a real, surviving post and must survive: a
  // sweep that took everything would pass this test having broken the feature.
  const withPosts = stale.discussions.find((d: any) => d.posts.length > 0)
  assert.ok(withPosts, 'the snapshot carries a thread to point at')
  const realActor = accounts.tenants.get(withPosts.posts[0].authorTenant)?.name
  assert.ok(realActor, 'and its author is a live tenant')
  const bell = (id: string, extra: any) => ({
    id,
    kind: 'social.replied',
    actor: realActor,
    discussionId: withPosts.id,
    tenantId: withPosts.openerTenant,
    at: withPosts.posts[0].at,
    read: false,
    ...extra,
  })
  stale.notifications = [
    ...(stale.notifications ?? []),
    bell('ntf-orphan-thread', { discussionId: 'disc-vanished' }),
    // Legacy row whose act is gone: no post survives at its instant.
    bell('ntf-orphan-act', { at: withPosts.posts[0].at + 60 * 60_000 }),
    // Legacy row a RENAME orphaned: its actor name resolves to nobody, but the
    // post it announces is right there. It MUST survive — judging a legacy row
    // by its name swept two correct bells out of the owner's own store, because
    // after a rename no legacy name resolves.
    bell('ntf-renamed-actor', { actor: 'A Name Nobody Wears Now' }),
    bell('ntf-live', {}),
  ]
  writeFileSync(BUILD_STORE, JSON.stringify(stale))

  const { store } = await import('../store/index.ts')
  store.initPersistence() // loadState(BUILD_STORE) → rehydrate replaces in-memory state from disk

  // Read back through the PUBLIC getters the routes use, not the private
  // snapshot: what the wire carries is what a stale name would have poisoned.
  const nameOf = (t: string) => accounts.tenants.get(t)?.name
  const freshDm = store.getDiscussion(dm.id, dm.openerTenant)
  assert.ok(freshDm, 'the planted thread is readable by its opener after the boot')
  assert.equal(freshDm?.anchor.ref.id, nameOf(dm.targetTenant), 'the anchor re-derives from targetTenant')
  assert.equal(freshDm?.openedBy, nameOf(dm.openerTenant), 'openedBy re-derives from openerTenant')
  assert.equal(freshDm?.posts[0].author, nameOf(dm.posts[0].authorTenant), 'a post author re-derives from authorTenant')
  const freshGrant = store.listGrants(grant.subject, grant.granterTenant).find((g) => g.id === grant.id)
  assert.equal(freshGrant?.grantedBy, nameOf(grant.granterTenant), 'grantedBy re-derives from granterTenant')
  const inbox = store.listNotifications(withPosts.openerTenant).map((n) => n.id)
  assert.ok(!inbox.includes('ntf-orphan-thread'), 'a bell into a dissolved thread is swept — its door 404s')
  assert.ok(inbox.includes('ntf-renamed-actor'), 'a bell a RENAME orphaned SURVIVES: a stale actor name is not a missing act')
  assert.ok(!inbox.includes('ntf-orphan-act'), 'a legacy bell with no post at its instant is swept')
  assert.ok(inbox.includes('ntf-live'), 'and a bell whose act is still there SURVIVES — the sweep is not a purge')

  const kept = store.listFollows(follower[0])
  assert.ok(!kept.includes('Stale, Inc.'), 'a follow naming nobody is pruned, never left to trap the next signup')
  assert.deepEqual(kept, [...follower[1]].filter((n: string) => n !== 'Stale, Inc.').sort(), 'and every live follow survives')

  const projectIds = [...store.listProjects(), ...store.relationGraph().extraProjects].map((p) => p.id)
  assert.ok(projectIds.includes('p-playground'), 'the created project survives a boot')
  const restoredSchedule = store.listSchedules().find((t) => t.id.startsWith('s-new-'))
  assert.ok(restoredSchedule, 'the created schedule survives a boot')
  assert.ok(Number.isFinite(restoredSchedule?.nextFireAt), 'its durable scheduler cursor survives the boot')
  assert.equal(restoredSchedule?.missedFirePolicy, 'catch-up-once', 'its downtime policy survives the boot')
  assert.ok(restoredSchedule?.runs.some((run) => Number.isFinite(run.scheduledFor)), 'its fire-time idempotency key survives the boot')
  assert.ok(store.relationGraph().extraArtifacts.length >= 3, 'the created artifacts survive a boot')
  assert.equal(
    store.relationGraph().extraArtifacts.find((artifact) => artifact.id === legacyRuntimeArtifact.id)?.tenantId,
    'tenant-personal',
    'a tenant-less legacy runtime artifact is restored into the default namespace',
  )

  const created = store.listSessions().find((x) => x.id.startsWith('sess-'))
  assert.ok(created, 'the created session is listed after a boot')
  const full = created && store.getSession(created.id)
  assert.ok(full && (full.messages?.length ?? 0) >= 2, 'getSession returns the rehydrated thread')
  assert.ok(full && (full.workspace?.repos.length ?? 0) > 0, 'getSession surfaces the rehydrated workspace')
  assert.equal(
    store.getSessionCreation('sess-new-000000000000000000000000', store.defaultTenantId()),
    'retired',
    'a removed keyed draft remains retired after a real boot',
  )
  assert.equal(
    store.getSessionCreation('sess-fork-000000000000000000000000', store.defaultTenantId()),
    'retired',
    'a removed keyed conversation branch remains retired after a real boot',
  )

  // The Agent Commons registries survive the boot too (D6/D9/D10/D7).
  const provider = store.listProviders().find((p) => p.label === 'Playground provider')
  assert.ok(provider, 'the created provider survives a boot')
  assert.equal(provider?.definitionRevision, 1, 'the provider definition revision survives a boot')
  assert.equal(store.providerConfig(provider?.id).model, 'claude-opus-4-8', 'its server-only config (model id) survives too')
  const prompt = store.listSystemPrompts().find((p) => p.label === 'Playground research prompt')
  assert.ok(prompt, 'the created system prompt survives a boot')
  assert.equal(prompt?.definitionRevision, 1, 'the prompt definition revision survives a boot')
  const agent = store.listAgents().find((a) => a.label === 'Playground research agent')
  assert.ok(agent && agent.providerId === provider?.id, 'the created agent (bound to the provider) survives a boot')
  assert.equal(agent?.revision, 1, 'the Agent configuration revision survives a boot')
  const commission = store.listCommissions('p-insights').find((c) => c.agentId === agent?.id)
  assert.ok(commission, 'the created commission survives a boot')
  assert.equal(commission?.configurationRevision, 1, 'the contributor configuration revision survives a boot')
  assert.equal(store.listProjects().find((p) => p.id === 'p-insights')?.commissionCap, 8, 'the D13 commission cap survives a boot')
  assert.ok(store.listAuditLog().some((e) => e.channel === 'project-effect'), 'the D15 audit trail survives a boot')
  assert.ok(store.listDispatch().some((d) => d.id.startsWith('d-new-')), 'the P7 dispatch run survives a boot')
  const backlog = store.listOpenSubGoals('p-insights')
  assert.ok(backlog.some((o) => o.status === 'done' && o.resolvedByLabel), 'a resolved D19 work item survives a boot')
  assert.ok(backlog.some((o) => o.status === 'open'), 'an open D19 work item survives a boot')

  // The social S5/S6 slices survive the boot too: the link redemption still
  // opens the subject (grantedTier reads the rehydrated redeemedBy roster),
  // and the mute list comes back through the public getter.
  assert.equal(
    store.grantedTier({ kind: 'project', id: 'p-playground' }, 'tenant-playground-watcher'),
    'view',
    'a link redemption survives a boot (S6)',
  )
  assert.ok(
    store.listMutes(store.defaultTenantId()).includes('Playground muted actor'),
    'the mute list survives a boot (S5)',
  )
})
