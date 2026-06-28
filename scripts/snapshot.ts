/** ── Backup / restore the mock backend's storage state ─────────────────────
 *  A play-and-roll-back tool for the persisted store (`.data/store.json`, see
 *  server/persist.ts). Four subcommands:
 *
 *    save  [name]   live store  → .data/snapshots/<name>.json   (default: backup)
 *    restore [name] snapshot    → live store     (+ restart the server to load it)
 *    list           show every snapshot with size + date
 *    build [--activate]  manufacture a CLEAN, COMPREHENSIVE snapshot that exercises
 *                   every persisted slice once → .data/snapshots/comprehensive.json
 *
 *  Why `build` re-derives instead of copying the live store: the live store is the
 *  seed *plus* whatever the daemon + your clicking accreted (often thousands of
 *  runs, three features never touched). `build` boots the store on a FRESH path so
 *  it re-seeds from the source-controlled fixtures (server/data/*), then drives the
 *  REAL store mutators + relation reducer — so the snapshot can't drift from the
 *  contract, and `npm run snapshot:build` reproduces the identical playground in any
 *  clone. The `.json` outputs stay gitignored under `.data/`; only this generator
 *  is checked in.
 *
 *  Persistence loads ONCE on boot (store.initPersistence), so a `restore` only
 *  takes effect after the server restarts — the commands say so. Pure `node:fs`
 *  for save/restore/list; the store is imported lazily, only for `build`. */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dataFile, type PersistedState } from '../server/persist.ts'

/** The live store path — the SAME resolver the server reads/writes through
 *  (persist.ts owns the DATA_FILE-or-`.data/store.json` rule), imported rather
 *  than re-derived so this tool can't drift from where the store actually lives. */
export function dataFilePath(): string {
  return dataFile()
}

/** Snapshots live next to the live store, in a `snapshots/` sibling. */
export function snapshotsDir(): string {
  return join(dirname(dataFilePath()), 'snapshots')
}

/** A snapshot's path from its name. Names are restricted to a safe charset so a
 *  `restore ../../etc/passwd` can't escape the snapshots dir. */
export function snapshotPath(name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') {
    throw new Error(`invalid snapshot name: ${JSON.stringify(name)} (use letters, digits, . _ -)`)
  }
  return join(snapshotsDir(), `${name}.json`)
}

/** Copy the live store → a named snapshot. */
export function saveSnapshot(name = 'backup'): { from: string; to: string } {
  const from = dataFilePath()
  if (!existsSync(from)) {
    throw new Error(`no live store at ${from} — run the server once (npm run dev) so it writes one`)
  }
  const to = snapshotPath(name)
  mkdirSync(snapshotsDir(), { recursive: true })
  copyFileSync(from, to)
  return { from, to }
}

/** Copy a named snapshot → the live store. Caller must restart the server. */
export function restoreSnapshot(name = 'backup'): { from: string; to: string } {
  const from = snapshotPath(name)
  if (!existsSync(from)) {
    throw new Error(`no snapshot named "${name}" at ${from} — run \`snapshot list\` to see what exists`)
  }
  const to = dataFilePath()
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  return { from, to }
}

/** Every snapshot, newest first. */
export function listSnapshots(): { name: string; sizeKB: number; modified: Date }[] {
  const dir = snapshotsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const st = statSync(join(dir, f))
      return { name: f.replace(/\.json$/, ''), sizeKB: Math.round((st.size / 1024) * 10) / 10, modified: st.mtime }
    })
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Manufacture the comprehensive playground by driving the real store. Assumes
 *  `process.env.DATA_FILE` already points at a FRESH (absent) path: the store
 *  re-seeds from the fixtures, then every mutator below persists to that file.
 *  Returns the resulting snapshot (for the test's coverage invariant). Run once
 *  per process — the store is a singleton, so a second call would layer on the
 *  first rather than re-seed. */
export async function buildComprehensive(): Promise<PersistedState> {
  const { store } = await import('../server/store.ts')
  const { loadState } = await import('../server/persist.ts')

  // Re-seed from the source-controlled fixtures (no file at DATA_FILE → seed,
  // then write the baseline). Every store mutation from here persists.
  store.initPersistence()

  const PROJECT_ID = 'p-playground'
  const PROJECT_NAME = 'Playground project'

  const seedArtifacts = store.listArtifacts()
  const seedSchedules = store.listSchedules()
  const seedContexts = store.savedContexts().contexts
  const a0 = seedArtifacts[0]
  const a1 = seedArtifacts[1]

  // ── Projects ── a created project (extraProjects) the rest files into.
  store.applyRelationOp({
    kind: 'create-project',
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
    projectDescription: 'A created project, here to exercise every relation and feature.',
  })

  // ── Sessions ── a created thread with a real exchange, an attached context
  // (bindings), a full workspace (every panel kind), and filed into the project.
  const session = store.createSession('Draft the launch one-pager for the insights dashboard')
  store.appendMessage(session.id, {
    id: store.mintMessageId('user'),
    role: 'user',
    content: 'Draft the launch one-pager for the insights dashboard — metric-led, one screen.',
  })
  store.appendMessage(session.id, {
    id: store.mintMessageId('assistant'),
    role: 'assistant',
    content: 'Here is a first pass — lead with weekly-active-teams, then the mechanism. Draft is in the workspace on the right.',
  })
  store.attachContext(session.id, {
    id: 'repo-playground',
    type: 'repo',
    label: 'insights-dashboard',
    scope: '~/projects/insights-dashboard',
  })
  store.setSessionWorkspace(session.id, {
    workspaces: [
      {
        id: `ws-${session.id}`,
        label: 'insights/',
        artifacts: [{ id: 'wsa-1', name: 'launch-one-pager.md', kind: 'doc', meta: 'Draft · 1 screen' }],
      },
    ],
    repos: [
      {
        id: 'repo-playground',
        label: 'patrick-yingxi-pan/web-app',
        origin: 'github',
        remote: 'patrick-yingxi-pan/web-app',
        branch: 'feat/insights-dashboard',
        files: [
          { path: 'src/insights/page.tsx', status: 'added' },
          { path: 'src/insights/flag.ts', status: 'modified' },
        ],
        diff: [
          { kind: 'hunk', text: 'src/insights/page.tsx' },
          { kind: 'add', text: '+ export const InsightsPage = () => <Dashboard flag="insights_dashboard" />' },
        ],
        terminal: ['$ npm test -- insights', 'PASS  src/insights/page.test.tsx (1.2s)', 'Tests: 8 passed, 8 total'],
      },
    ],
    connectors: [{ id: 'gh-mcp', label: 'GitHub', kind: 'github' }],
    attachments: [{ id: 'att-1', label: 'gtm-brief.md', kind: 'file' }],
  })
  store.applyRelationOp({
    kind: 'file-session',
    sessionId: session.id,
    sessionTitle: session.title,
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
  })

  // ── Artifacts ── created (filed + unfiled), and seed artifacts moved around.
  store.applyRelationOp({
    kind: 'save-artifact',
    artifact: { name: 'Launch one-pager', kind: 'doc', meta: 'Created here', excerpt: 'Metric-led summary of the insights launch.' },
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
  })
  store.applyRelationOp({
    kind: 'save-artifact',
    artifact: { name: 'Launch email', kind: 'email', meta: 'Created here', excerpt: 'Announce the dashboard to the team.' },
  })
  if (a0) {
    store.applyRelationOp({ kind: 'refile-artifact', artifactId: a0.id, artifactName: a0.name, projectId: PROJECT_ID, projectName: PROJECT_NAME })
    store.applyRelationOp({ kind: 'set-artifact-source', artifactId: a0.id, artifactName: a0.name, contextLabel: '~/code/insights-web' })
  }
  if (a1) {
    store.applyRelationOp({ kind: 'refile-artifact', artifactId: a1.id, artifactName: a1.name, projectId: null, projectName: '' })
  }

  // ── Project ↔ Context ── scope a repo to the created project.
  store.applyRelationOp({
    kind: 'scope-context',
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
    context: { kind: 'repo', label: 'patrick-yingxi-pan/web-app', meta: 'feat/insights-dashboard' },
  })

  // ── Agent Commons (D6/D9/D10/D7) ── a created Model provider (with its server-only
  // config), a library system prompt, a worker Agent bound to both through the D8
  // funnel, and a Commission onto a seed project — so all four registries (and their
  // id counters) are exercised once, keeping persistence coverage comprehensive.
  const provider = store.createProvider(
    {
      label: 'Playground provider',
      modelFamily: 'claude',
      effortLevels: ['Low', 'Medium', 'High'],
      authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] },
    },
    { model: 'claude-opus-4-8' },
  )
  const prompt = store.createSystemPrompt({
    label: 'Playground research prompt',
    body: 'You are a focused research assistant. Cite primary sources and stay terse.',
    targetFamily: 'claude',
  })
  const playgroundAgent = store.createAgentFromRequest({
    label: 'Playground research agent',
    providerId: provider.id,
    systemPromptId: prompt.id,
    instructions: 'Prefer primary sources.',
  })
  store.createCommission({ agentId: playgroundAgent.id, projectId: 'p-insights' })

  // ── Schedules ── a created routine, linked to the project, carrying all three
  // standing approvals, then RUN once (awaited) so it delivers its standing
  // artifact and lands a completed live run.
  let createdScheduleId = ''
  if (seedSchedules[0]) {
    const cloned = JSON.parse(JSON.stringify(seedSchedules[0])) as Record<string, unknown>
    delete cloned.id
    const created = store.addSchedule({
      ...(cloned as Omit<import('../contract/index.ts').ScheduledTask, 'id'>),
      name: 'Playground weekly digest',
      enabled: true,
      lastStatus: 'pending',
      runs: [],
      projectId: undefined,
    })
    createdScheduleId = created.id
    store.applyRelationOp({ kind: 'link-schedule-project', scheduleId: created.id, scheduleName: created.name, projectId: PROJECT_ID, projectName: PROJECT_NAME })
    store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: created.id, scheduleName: created.name, cadence: created.cadence, artifactName: 'Weekly digest' })
    store.applyRelationOp({ kind: 'set-schedule-session', scheduleId: created.id, scheduleName: created.name, cadence: created.cadence, sessionLabel: 'Weekly digest run' })
    store.applyRelationOp({ kind: 'schedule-add-tool', scheduleId: created.id, scheduleName: created.name, cadence: created.cadence, tool: { id: 'linear', label: 'Linear', tone: 'connector' } })
  }
  // Disable a different seed schedule so the playground shows a paused routine too.
  if (seedSchedules[1]) store.setScheduleEnabled(seedSchedules[1].id, false)

  // ── Recents ── promote the attached repo + a connector to the front.
  store.pushRecent('repo', 'repo-playground')
  store.pushRecent('connector', 'gh-mcp')

  // ── Contexts (Contexts page) ── flip auth status both directions.
  const connected = seedContexts.find((c) => c.kind === 'connector' && c.status === 'connected')
  const needsAuth = seedContexts.find((c) => c.kind === 'connector' && c.status === 'needs-auth')
  if (connected) store.setConnectorStatus(connected.id, 'needs-auth')
  if (needsAuth) store.setConnectorStatus(needsAuth.id, 'connected')

  // Run the created routine and wait for it to finish (it steps one beat at a
  // time, then a final beat applies the standing-approved artifact save). Poll the
  // REAL run record for a terminal state rather than hard-coding the store's step
  // cadence — so this stays correct if that timing constant ever changes.
  if (createdScheduleId) {
    store.runSchedule(createdScheduleId)
    const settled = () => {
      const run = store
        .listSchedules()
        .find((t) => t.id === createdScheduleId)
        ?.runs.find((r) => r.id.startsWith('run-live-'))
      return run !== undefined && run.status !== 'running'
    }
    const deadline = Date.now() + 15_000
    while (!settled() && Date.now() < deadline) await delay(50)
  }

  const state = loadState()
  if (!state) throw new Error('buildComprehensive: the snapshot did not persist (no file at DATA_FILE)')
  return state
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function fmt(p: string): string {
  // Show a repo-relative path when possible, else the absolute one.
  const rel = p.startsWith(process.cwd()) ? p.slice(process.cwd().length + 1) : p
  return rel.replace(/\\/g, '/')
}

function cmdSave(name: string): void {
  const { from, to } = saveSnapshot(name)
  console.log(`Saved  ${fmt(from)}  →  ${fmt(to)}`)
}

function cmdRestore(name: string): void {
  const { from, to } = restoreSnapshot(name)
  console.log(`Restored  ${fmt(from)}  →  ${fmt(to)}`)
  console.log('↻  Restart the server (it loads the store once on boot) to see it.')
}

function cmdList(): void {
  const snaps = listSnapshots()
  if (snaps.length === 0) {
    console.log(`No snapshots in ${fmt(snapshotsDir())} yet — try \`snapshot save\` or \`snapshot build\`.`)
    return
  }
  console.log(`Snapshots in ${fmt(snapshotsDir())}:`)
  for (const s of snaps) {
    console.log(`  ${s.name.padEnd(22)} ${String(s.sizeKB).padStart(8)} KB   ${s.modified.toISOString()}`)
  }
}

async function cmdBuild(activate: boolean): Promise<void> {
  const dir = snapshotsDir()
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, '.build-tmp.json')
  rmSync(tmp, { force: true })

  // Build against a fresh temp path so the store seeds clean, then promote it.
  const prev = process.env.DATA_FILE
  process.env.DATA_FILE = tmp
  let state: PersistedState
  try {
    state = await buildComprehensive()
  } finally {
    if (prev === undefined) delete process.env.DATA_FILE
    else process.env.DATA_FILE = prev
  }

  const target = snapshotPath('comprehensive')
  copyFileSync(tmp, target)
  rmSync(tmp, { force: true })

  const g = state.graph
  console.log(`Built comprehensive playground  →  ${fmt(target)}`)
  console.log('  covers:')
  console.log(`    sessions            ${state.sessions.length} (incl. ${state.sessions.filter((s) => s.id.startsWith('sess-')).length} created)`)
  console.log(`    bindings/workspaces ${state.bindings.length} / ${state.workspaces.length}`)
  console.log(`    projects (created)  ${g.extraProjects.length}`)
  console.log(`    artifacts (created) ${g.extraArtifacts.length}`)
  console.log(`    schedules           ${state.schedules.length} (incl. ${state.schedules.filter((s) => s.id.startsWith('s-new-')).length} created)`)
  console.log(`    standing approvals  ${Object.keys(g.standingApprovals).length}`)
  console.log(`    contexts flipped    ${(state.savedContexts ?? []).filter((c) => c.kind === 'connector').length} connectors present`)
  console.log(
    `    agent commons       ${(state.providers ?? []).length} providers / ${(state.systemPrompts ?? []).length} prompts / ${(state.agents ?? []).length} agents / ${(state.commissions ?? []).length} commissions`,
  )

  if (activate) {
    const live = dataFilePath()
    if (existsSync(live)) {
      const { to } = saveSnapshot('pre-build-backup')
      console.log(`Backed up the current live store  →  ${fmt(to)}`)
    }
    mkdirSync(dirname(live), { recursive: true })
    copyFileSync(target, live)
    console.log(`Activated as the live store  →  ${fmt(live)}`)
    console.log('↻  Restart the server to load it.')
  } else {
    console.log('Not activated. To play with it:  npm run snapshot:restore -- comprehensive  (then restart the server)')
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)
  const args = rest.filter((a) => !a.startsWith('-'))
  const flags = rest.filter((a) => a.startsWith('-'))
  try {
    switch (cmd) {
      case 'save':
        cmdSave(args[0] ?? 'backup')
        break
      case 'restore':
        cmdRestore(args[0] ?? 'backup')
        break
      case 'list':
        cmdList()
        break
      case 'build':
        await cmdBuild(flags.includes('--activate'))
        break
      default:
        console.log('Usage: node scripts/snapshot.ts <save|restore|list|build> [name] [--activate]')
        console.log('  save  [name]        live store  → .data/snapshots/<name>.json   (default: backup)')
        console.log('  restore [name]      snapshot    → live store   (restart the server after)')
        console.log('  list                show every snapshot')
        console.log('  build [--activate]  build the comprehensive playground (--activate makes it live)')
        process.exitCode = cmd ? 1 : 0
    }
  } catch (err) {
    console.error(`snapshot: ${(err as Error).message}`)
    process.exitCode = 1
  }
}

if (import.meta.main) await main()
