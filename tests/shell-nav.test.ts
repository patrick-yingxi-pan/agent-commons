/** ── Step 6 of the universal split (Phase 6): the singleton is GONE ──────────
 *  After the equal-panes dissolve, `useSessionWorkspace` is the SHELL's
 *  navigation controller only — boot address, URL projection, popstate,
 *  account switch, notification doors, session row mutations. Everything
 *  session-owned lives pane-side. These locks are the ratchet: they fail if
 *  the singleton's conversation machinery grows back, and they pin the four
 *  behaviors the dissolve orphaned until this step re-homed them —
 *
 *    1. the rail's active highlight derives from the FOCUSED pane (the
 *       singleton's activeId/activeSection froze at boot once every door
 *       routed into panes — a stale reader of a dissolved authority);
 *    2. a relation card's attach-context op attaches to ITS OWN session
 *       (the root bridge attached to "the active session" — same stale
 *       authority);
 *    3. the shared attach funnel OPENS the added context's panel and every
 *       remove funnel CLEARS a dangling focus (side effects the singleton's
 *       handleAddContext / valid-focus effect used to own);
 *    4. a DRAFT pane's composer attach routes through the draft funnel
 *       (a draft has no server row to bind against).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(p, 'utf8')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('the shell controller holds NO conversation state — the singleton stays dissolved', () => {
  const shell = stripComments(read(join(ROOT, 'src', 'controller', 'useSessionWorkspace.ts')))
  // No per-session subscription, no send pipeline, no section/page state, no
  // panel focus, no view-memory blob — each was a stale twin of a pane-owned
  // (or tree-owned) authority.
  for (const banned of [
    'useConversation(',
    'sendTurn',
    'setActiveSection',
    'setActiveId',
    'setFocusProjectId',
    'liveFromSession',
    'applyEscalationToLive',
    'bindingsFor',
    'setPanelPref',
    'viewMemory',
    'saveViewLocation',
  ]) {
    assert.ok(!shell.includes(banned), `useSessionWorkspace must not contain "${banned}" (pane- or tree-owned now)`)
  }
})

test("the rail's active highlight derives from the FOCUSED pane, not a singleton mirror (UI-12)", () => {
  const app = stripComments(read(join(ROOT, 'src', 'App.tsx')))
  // The Sidebar's three active props read the focused-pane derivation…
  assert.match(app, /activeId=\{railActiveSessionId\}/, 'the session highlight reads the focused pane')
  assert.match(app, /activeSection=\{railActiveSection\}/, 'the section highlight reads the focused pane')
  assert.match(app, /activeSubview=\{railActiveSubview\}/, 'the sub-view highlight reads the focused pane')
  // …and the derivation covers all three pane kinds: a conversation, its
  // context pane (highlighting the OWNING session), and a section pane's
  // REPORTED live sub-view (`at`, falling back to the door's seed).
  // Slice to the next CODE anchor (comments are stripped above).
  const block = app.slice(app.indexOf('const railActiveSessionId'), app.indexOf('const narrowBarTitle'))
  assert.match(block, /'msession'/, 'a conversation pane highlights its session row')
  assert.match(block, /'context-panel'/, 'a context pane highlights its owning conversation')
  assert.match(block, /at\.sub/, "a section pane's highlight follows its reported location")
})

test("a relation card's attach-context op attaches to ITS OWN session (no root bridge)", () => {
  const card = stripComments(read(join(ROOT, 'src', 'components', 'RelationActionCard.tsx')))
  assert.match(card, /useSessionContextCommands\(sessionId \?\? DRAFT_ID\)/, 'the card binds the session-parametric funnel')
  assert.match(card, /op\.kind === 'attach-context' && sessionId/, 'attach-context confirms through it')
  const rel = stripComments(read(join(ROOT, 'src', 'controller', 'useRelations.tsx')))
  assert.ok(!rel.includes('attachConnector'), 'the session-blind root bridge is gone from the relations store')
  assert.match(rel, /if \(op\.kind === 'attach-context'\) return/, 'a stray attach-context is never POSTed as a graph op')
})

test('the shared attach funnel opens the panel; every remove funnel clears a dangling focus', () => {
  const cmds = stripComments(read(join(ROOT, 'src', 'controller', 'useSessionContextCommands.ts')))
  assert.match(cmds, /focusForAdded\(ctx, next\)/, 'attach derives the panel to open (you see what you added)')
  assert.match(cmds, /setPanelPref\(sessionId, f\)/, 'the opened panel is remembered (FWD-2)')
  // All three remove commands run the dangling-focus guard.
  const clears = cmds.split('clearDanglingFocus(sessionId, next)').length - 1
  assert.equal(clears, 3, 'removeContexts, removeFolder and removeAttachment all clear a dangling focus')
  assert.match(cmds, /focusValidIn\(next, focus\)/, 'the guard is the shared pure rule')
})

test('the notification-door focus target is PER PANE — only the landing pane sees it', () => {
  const routes = stripComments(read(join(ROOT, 'src', 'controller', 'useShellRoutes.ts')))
  assert.match(routes, /notifPaneRef\.current = routeToFocused\(/, "routeDoor records the door's landing pane")
  const app = stripComments(read(join(ROOT, 'src', 'App.tsx')))
  assert.match(
    app,
    /pendingFocus && path === notifPaneRef\.current \? focusCtx : NO_PENDING_FOCUS/,
    'focusCtxFor answers only for the landing pane',
  )
  assert.ok(!app.includes('<FocusContext.Provider'), 'no app-wide provider — the pane-scoped one replaced it')
  const frame = stripComments(read(join(ROOT, 'src', 'components', 'MainSplit.tsx')))
  assert.match(
    frame,
    /<FocusContext\.Provider value=\{nav\.focusCtxFor\(path\)\}>\{body\}<\/FocusContext\.Provider>/,
    'PaneBody provides the pane-scoped focus context',
  )
})

test("the narrow tier's rail toggle reaches EVERY focused surface (a title-bar-less pane included)", () => {
  const app = stripComments(read(join(ROOT, 'src', 'App.tsx')))
  // Slice to the next CODE anchor (comments are stripped above).
  const block = app.slice(app.indexOf('const narrowBarTitle'), app.indexOf('const { tier } = useViewport()'))
  assert.match(block, /'msection'/, 'section pages get the NarrowBar')
  assert.match(block, /'context-panel'/, 'a pinned context pane gets it (titled after its conversation)')
  assert.match(block, /!focusedContent\s*\?\s*''/, 'the BACKGROUND gets it — its "open from the sidebar" advice needs a sidebar toggle')
})

test("a DRAFT pane's composer attach AND removes route through the draft funnel, not a server bind", () => {
  const split = stripComments(read(join(ROOT, 'src', 'components', 'ConversationPane.tsx')))
  assert.match(
    split,
    /onAddContext=\{isDraft \? \(ctx\) => draft\.attach\(ctx\) : addContext\}/,
    'the draft attach STACKS through the funnel (never the launcher reset, which wipes a thread)',
  )
  assert.match(
    split,
    /onRemoveContexts=\{isDraft \? \(fs\) => draft\.removeContexts\(fs\) : removeContexts\}/,
    'a draft chip remove purges the FWD-1 buffer instead of 404ing a server detach',
  )
  assert.match(
    split,
    /onRemoveFolder=\{isDraft \? \(id\) => draft\.removeFolder\(id\) : removeFolder\}/,
    'a draft folder remove purges its seed too',
  )
})
