/** Locks for the 2026-07 connectivity audit — every UI element reads its data from
 *  the LIVE source and SYNCS when it changes elsewhere. Each block below pins one
 *  fixed staleness class (see the review's findings; the pattern follows
 *  src/api/findability-freshness.test.ts: React-bound wiring is locked by source
 *  greps, behavior verified in the running app; pure helpers are unit-tested).
 *
 *  The classes: seed-mirror reads missing runtime-created projects (rail, title
 *  bar, breadcrumb); SSE cases that invalidated keys nobody reads (or nothing at
 *  all); cross-tenant composed reads cached forever; controller state that never
 *  reconciled with server pushes; a persisted filter bleeding across accounts; a
 *  copied A2A URL that wasn't dialable; the composer quick list asserting a
 *  fabricated auth status. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import { keys } from './keys.ts'
import { clampSessionFilter, DEFAULT_SESSION_FILTER } from '../lib/sessionFilter.ts'
import { clampRoutineFilter, DEFAULT_ROUTINE_FILTER } from '../lib/routineFilter.ts'

const src = (...p: string[]) => stripComments(read(join(ROOT, ...p)))
const eventCase = (events: string, name: string) => {
  const block = events.split(/case '/).find((c) => c.startsWith(name))
  assert.ok(block, `events.ts handles '${name}'`)
  return block!
}

// ── The event router: every new/widened case actually heals the surfaces ──────

test('run.*/schedule.changed refresh the schedules list (the rail pane + the section read it)', () => {
  const events = src('src', 'api', 'events.ts')
  // run.started/progress fall through to run.finished — the block lives on the last label.
  assert.ok(events.includes("case 'run.started'"), 'run.started is handled')
  assert.match(eventCase(events, 'run.finished'), /invalidate\(keys\.schedules\)/)
  assert.match(eventCase(events, 'schedule.changed'), /invalidate\(keys\.schedules\)/)
})

test('proposal.changed refreshes the review queue the bell’s door opens (once cached forever)', () => {
  const events = src('src', 'api', 'events.ts')
  assert.match(eventCase(events, 'proposal.changed'), /invalidate\(keys\.agentProposals\(e\.agentId\)\)/)
})

test('commission.changed refreshes both Contributor lists AND the directory contributor counts', () => {
  const events = src('src', 'api', 'events.ts')
  const block = eventCase(events, 'commission.changed')
  assert.match(block, /invalidate\(keys\.commissions\(e\.projectId\)\)/)
  assert.match(block, /invalidate\(keys\.commissions\(\)\)/)
  assert.match(block, /invalidatePrefix\(keys\.directoryProjects\(\)\)/)
})

test('relation.applied refreshes the D17 directories (share-project once never reached Discover)', () => {
  const events = src('src', 'api', 'events.ts')
  const block = eventCase(events, 'relation.applied')
  assert.match(block, /invalidatePrefix\(keys\.directoryProjects\(\)\)/)
  assert.match(block, /invalidatePrefix\(keys\.directoryAgents\(\)\)/)
})

test('agent.changed refreshes private configuration and public directory projections', () => {
  const events = src('src', 'api', 'events.ts')
  const block = eventCase(events, 'agent.changed')
  assert.match(block, /invalidate\(keys\.workerAgents\)/)
  assert.match(block, /e\.scope === 'directory'/)
  assert.match(block, /invalidatePrefix\(keys\.directoryAgents\(\)\)/)
  assert.match(block, /invalidatePrefix\(keys\.agentForks\(\)\)/)
  assert.match(block, /invalidatePrefix\(keys\.ownerProfile\(\)\)/)
  assert.match(block, /invalidatePrefix\(keys\.search\(\)\)/)
})

test('openwork.changed refreshes the agent directory + the S10 resolved-work family (the D13 credit)', () => {
  const events = src('src', 'api', 'events.ts')
  const block = eventCase(events, 'openwork.changed')
  assert.match(block, /invalidatePrefix\(keys\.directoryAgents\(\)\)/)
  assert.match(block, /invalidatePrefix\(keys\.agentResolvedWork\(\)\)/)
})

test('notification.changed refetches the relation graph — a bell may name a project shared after this client loaded', () => {
  const events = src('src', 'api', 'events.ts')
  assert.match(eventCase(events, 'notification.changed'), /invalidate\(keys\.relations\)/)
})

test('reservation.changed reaches the Coordination panel’s key family (it once refreshed a key nobody reads)', () => {
  const events = src('src', 'api', 'events.ts')
  assert.match(eventCase(events, 'reservation.changed'), /invalidatePrefix\(keys\.projectSubGoals\(\)\)/)
})

test('savedcontext.changed re-reads the saved-contexts snapshot (the Contexts page’s server-owned add/remove)', () => {
  const events = src('src', 'api', 'events.ts')
  assert.match(eventCase(events, 'savedcontext.changed'), /invalidate\(keys\.savedContexts\)/)
})

test('routine context readiness reads the live registry and respects connector kind', () => {
  const section = src('src', 'components', 'SectionView.tsx')
  const panel = section.slice(section.indexOf('function ContextToolsPanel('), section.indexOf('const FREQ_OPTIONS'))
  assert.match(panel, /useSavedContexts\(\)/, 'the routine panel reads live saved contexts')
  assert.match(panel, /context\.kind === 'mcp'/, 'MCP tools resolve only against MCP contexts')
  assert.match(panel, /context\.kind === 'connector'/, 'connector tools resolve only against connector contexts')
  assert.doesNotMatch(panel, /t\.needsAuth/, 'seed-time auth hints do not override runtime readiness')
})

test('the new prefix families follow the convention invalidatePrefix depends on', () => {
  assert.equal(keys.projectSubGoals(), 'project-subgoals')
  assert.equal(keys.projectSubGoals('p1'), 'project-subgoals:p1')
  assert.equal(keys.agentResolvedWork(), 'agent-resolved-work')
  assert.equal(keys.agentResolvedWork('a1'), 'agent-resolved-work:a1')
})

// ── Cross-tenant composed reads revalidate on mount (the SWR layer) ────────────

test('the directories + the resolved-work list revalidate on mount — another tenant’s acts have no event path here', () => {
  const hooks = read(join(ROOT, 'src', 'api', 'hooks.ts'))
  const fnBlock = (name: string) => {
    const m = hooks.match(new RegExp(`export function ${name}[\\s\\S]*?\\n\\}`))
    assert.ok(m, `${name} exists`)
    return m![0]
  }
  assert.match(fnBlock('useProjectDirectory'), /true,\s*true\)/, 'useProjectDirectory passes revalidate')
  assert.match(fnBlock('useAgentDirectory'), /true,\s*true\)/, 'useAgentDirectory passes revalidate')
  assert.match(fnBlock('useAgentResolvedWork'), /enabled,\s*true\)/, 'useAgentResolvedWork revalidates when its dialog opens')
})

// ── The controller reconciles the OPEN thread with server pushes (C26) ─────────

test('session pushes reach the panes through the one narrow seam (one-door holds)', () => {
  const events = src('src', 'api', 'events.ts')
  assert.match(eventCase(events, 'session.updated'), /notifySessionPush\(e\.session\.id\)/)
  assert.match(eventCase(events, 'session.contexts.changed'), /notifySessionPush\(e\.sessionId\)/)
  // Every visible conversation subscribes for its own session now (Phase 6 —
  // the pane controller replaced the singleton's one-active-thread watcher),
  // and the push re-read runs the SAME shared reconcile tail as the mount
  // recipe (reconcileNow — one loadSession, one mid-stream transcript guard).
  const controller = src('src', 'controller', 'usePaneConversation.ts')
  assert.match(controller, /onSessionPush\(\(sid\) => \{/, 'each pane subscribes')
  // The mid-stream guard reads the SESSION'S OWN entry (the generation flags
  // live in the keyed conversation store).
  const busyGuard = controller.slice(
    controller.indexOf('if (now.busy || now.typing)'),
    controller.indexOf('if (!conversations.reconcile'),
  )
  assert.match(busyGuard, /reconcilePanelPreference\(sessionId, s, reconciled\)/, 'orthogonal panel intent remains live mid-stream')
  assert.match(busyGuard, /return/, 'a mid-stream transcript is never stomped by the authoritative reconcile')
  const push = controller.slice(controller.indexOf('onSessionPush(('))
  assert.match(push.slice(0, 300), /reconcileNow\(sessionId\)/, 'the push re-read is the same shared server reconcile the mount recipe uses')
})

test('ambient sync health is earned by hello and degraded by every stream failure (SYNC-10)', () => {
  const events = src('src', 'api', 'events.ts')
  assert.match(eventCase(events, 'hello'), /ambientSyncHealth\.signal\('hello'\)/,
    'the identity/resume-validated hello is the only live proof')
  const error = events.slice(events.indexOf('opened.onerror ='))
  assert.match(error.slice(0, 350), /ambientSyncHealth\.signal\('error'\)/,
    'EventSource errors disclose degraded live updates')
  const accountSwitch = events.slice(events.indexOf('onAccountSwitch(() =>'))
  assert.match(accountSwitch.slice(0, 300), /ambientSyncHealth\.signal\('account-switch'\)/,
    'an expected account rebind does not carry the prior account warning')
  assert.match(events, /const opened = new EventSource\([\s\S]*source = opened/,
    'each callback can prove which EventSource instance owns it')
  assert.equal((events.match(/if \(source !== opened\) return/g) ?? []).length, 2,
    'both late frames and late errors from a retired account are fenced')
  assert.doesNotMatch(events, /source\.onopen|navigator\.onLine/,
    'a socket or network link is not identity-validated replay continuity')
})

// ── Seed-mirror reads replaced by the live registry (C12/C22/C23/C24) ─────────

test('the rail reads the LIVE project registry, not the seed-only /projects mirror', () => {
  const sidebar = src('src', 'components', 'Sidebar.tsx')
  assert.doesNotMatch(sidebar, /useProjects/, 'the seed-only hook is gone from the rail')
  assert.match(sidebar, /const projects = useMemo\(\(\) => allProjects\(\), \[allProjects\]\)/, 'the rail reads allProjects()')
})

test('the open thread’s title bar renders the LIVE session row (a rename shows immediately)', () => {
  // Every conversation renders through ConversationPane now (Phase 6 — no
  // singleton surface): its title bar must read the cache-refreshed row from
  // useSessions, never a creation-time snapshot.
  const split = src('src', 'components', 'ConversationPane.tsx')
  assert.match(
    split,
    /\(useSessions\(\)\.data \?\? \[\]\)\.find\(\(s\) => s\.id === sessionId\) \?\? peek<Session>\(keys\.session\(sessionId\)\)/,
    'the pane resolves the LIVE row (list, falling back to the loadSession cache for run sessions)',
  )
  assert.match(split, /<SessionTitleBar\s+session=\{\s*row \?\?/, 'the title bar gets the cache-refreshed row (with the draft/run fallback)')
})

test('the session→project breadcrumb resolves runtime-created projects too', () => {
  const rel = src('src', 'controller', 'useRelations.tsx')
  const block = rel.slice(rel.indexOf('projectForSessionId: (sid)'))
  // `merged()`, not a second spread of the same two lists: since 2026-08-13 that
  // helper also applies the description overlay, so re-spreading here would have
  // resolved the project and then handed the breadcrumb a stale description —
  // right about which project, wrong about what it says.
  assert.match(block.slice(0, 300), /merged\(\)\.find/, 'searches the same merged list allProjects() serves')
})

// ── The persisted rail filter clamps at render, never in storage (C16) ────────

test('a dangling projectId filter reads as "all" instead of hiding every row', () => {
  const valid = new Set(['p-live'])
  const stored = { ...DEFAULT_SESSION_FILTER, projectId: 'p-other-tenant' }
  assert.equal(clampSessionFilter(stored, valid).projectId, 'all', 'foreign id clamps at render')
  assert.equal(clampSessionFilter({ ...stored, projectId: 'p-live' }, valid).projectId, 'p-live', 'a live id passes')
  assert.equal(clampSessionFilter({ ...stored, projectId: 'all' }, valid).projectId, 'all')
  const r = { ...DEFAULT_ROUTINE_FILTER, projectId: 'p-other-tenant' }
  assert.equal(clampRoutineFilter(r, valid).projectId, 'all')
  assert.equal(clampRoutineFilter({ ...r, projectId: 'p-live' }, valid).projectId, 'p-live')
  // …and the Sidebar actually applies the clamp to both persisted blobs.
  const sidebar = src('src', 'components', 'Sidebar.tsx')
  assert.match(sidebar, /clampSessionFilter\(rawFilter, projectIds\)/)
  assert.match(sidebar, /clampRoutineFilter\(rawRoutineFilter, projectIds\)/)
})

// ── The A2A card link is dialable from OUTSIDE this browser (C19) ──────────────

test('the copied A2A card URL resolves to an absolute URL (a bare /api/v1 path is undialable by a peer)', () => {
  const commands = src('src', 'api', 'commands.ts')
  assert.match(
    commands,
    /new URL\(`\$\{API_BASE\}\$\{paths\.a2aAgentCard\(id\)\}`, window\.location\.origin\)\.toString\(\)/,
  )
})

// ── The composer quick list reads the saved-contexts REGISTRY (N2) ─────────────

test('the Add-context quick list derives each row’s auth dot from the registry, never asserting it', () => {
  const picker = src('src', 'components', 'AddContextButton.tsx')
  assert.match(picker, /useSavedContexts\(\)/, 'the picker reads the registry the Contexts page mutates')
  assert.match(picker, /savedStatus\.get\(o\.id\)/, 'the row status is a registry lookup')
  assert.doesNotMatch(picker, /accentDot/, 'the fabricated always-green dot is gone')
  assert.match(picker, /Needs auth — reconnect from Contexts/, 'a disconnected row says so')
})

// ── The Contexts page’s add/remove is server-owned (N1) ────────────────────────

test('the Contexts page routes add/remove through the server commands, not view state', () => {
  const view = src('src', 'components', 'SectionView.tsx')
  assert.match(view, /void addSavedContext\(ctx\)/)
  assert.match(view, /void removeSavedContext\(id\)/)
  assert.doesNotMatch(view, /const \[removed, setRemoved\]/, 'the evaporating local hide-set is gone')
  assert.doesNotMatch(view, /const \[extra, setExtra\]/, 'the evaporating local add-list is gone')
})

// ── The artifact "From ‹conversation›" door joins on the stable id (N3) ────────

test('the gallery resolves an artifact’s source session by ID first; the mutable title is a seed fallback', () => {
  const view = src('src', 'components', 'SectionView.tsx')
  assert.match(view, /a\.sourceSessionId && sessions\.some\(\(s\) => s\.id === a\.sourceSessionId\)/)
  assert.match(view, /sourceSessionOf\(openArtifact\)/, 'the door uses the id-first resolver')
})
