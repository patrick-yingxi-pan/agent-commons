/** Notification doors (docs/notification-routing.md, R1) — the crown guarantee:
 *  EVERY `NotificationKind` resolves to a concrete door (never a dead click), and
 *  each kind lands on the exact sub-entity its act touched. `doorFor` is the pure
 *  brain the panel + controller dispatch on; these lock it against every kind and
 *  against the legacy-row degrade. The exhaustiveness is doubly enforced: the switch
 *  has a `never` default (compile-time), and this test enumerates the runtime
 *  `NOTIFICATION_KINDS` array the type is derived from (so a new kind can't slip in
 *  without both a door and coverage). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NOTIFICATION_KINDS, type NotificationKind, type AppNotification } from '../contract/index.ts'
import { doorFor } from '../src/lib/notificationDoor.ts'

/** A fully-populated notification (all R2 ids present) — the door picks the fields
 *  relevant to the kind. */
function sample(kind: NotificationKind): AppNotification {
  return {
    id: `ntf-${kind}`,
    kind,
    at: 0,
    read: false,
    actor: 'Someone',
    projectId: 'p1',
    projectName: 'Proj',
    subGoal: 'sg',
    workItemId: 'work-1',
    commentId: 'anchor-1',
    agentId: 'a1',
    agentLabel: 'Agent',
    proposalId: 'a1-p1',
    // Social layer (S5): the subject ref's public face.
    subjectKind: 'project',
    subjectId: 'p1',
    subjectName: 'Proj',
    // The thread a `social.discussed` bell points at — its own page, the
    // deepest door of any social kind.
    discussionId: 'disc-1',
  }
}

const WORK_KINDS = NOTIFICATION_KINDS.filter((k) => k.startsWith('work.') || k === 'mentioned')
const PROPOSAL_KINDS = NOTIFICATION_KINDS.filter((k) => k.startsWith('proposal.'))

test('every NotificationKind resolves to a concrete door — no bell is a dead click', () => {
  for (const kind of NOTIFICATION_KINDS) {
    const intent = doorFor(sample(kind))
    assert.notEqual(intent.kind, 'section', `${kind} must land on something specific, not a bare section`)
  }
})

test('work.* and mentioned open the exact work item, anchoring the comment', () => {
  for (const kind of WORK_KINDS) {
    const intent = doorFor(sample(kind))
    assert.equal(intent.kind, 'workItem', `${kind} → the item`)
    assert.ok(intent.kind === 'workItem')
    assert.equal(intent.projectId, 'p1')
    assert.equal(intent.workItemId, 'work-1')
    assert.equal(intent.commentId, 'anchor-1', 'the #issuecomment-N anchor rides along')
  }
})

test('proposal.* focus the exact proposal on the agent surface', () => {
  for (const kind of PROPOSAL_KINDS) {
    const intent = doorFor(sample(kind))
    assert.equal(intent.kind, 'proposal', `${kind} → the proposal`)
    assert.ok(intent.kind === 'proposal')
    assert.equal(intent.agentId, 'a1')
    assert.equal(intent.proposalId, 'a1-p1')
  }
})

test('social.* doors land on the subject: project subjects on their page, session subjects on the Commons', () => {
  const shared = doorFor(sample('social.shared'))
  assert.deepEqual(shared, { kind: 'project', projectId: 'p1' }, 'a project subject lands on its page')
  const sessionShare = doorFor({ ...sample('social.shared'), subjectKind: 'session', subjectId: 'sess-1' })
  assert.deepEqual(sessionShare, { kind: 'section', section: 'commons' }, 'sessions have no section page — the feed carries the share')
  const disc = doorFor({ ...sample('social.offered'), subjectKind: 'discussion', subjectId: 'disc-1' })
  assert.deepEqual(disc, { kind: 'section', section: 'discussions' })
})

test('agent.forked highlights the SOURCE agent (never the fork — the leak-wall)', () => {
  const intent = doorFor(sample('agent.forked'))
  assert.equal(intent.kind, 'agent')
  assert.ok(intent.kind === 'agent')
  assert.equal(intent.agentId, 'a1', 'the source id the recipient owns')
})

test('a legacy row missing its R2 id degrades to the page/section, still not a dead click', () => {
  const legacyWork: AppNotification = { id: 'x', kind: 'work.commented', at: 0, read: false, actor: 'x', projectId: 'p9' }
  assert.equal(doorFor(legacyWork).kind, 'project', 'no workItemId → the project page (not nowhere)')

  const noProject: AppNotification = { id: 'x', kind: 'work.posted', at: 0, read: false, actor: 'x' }
  assert.equal(doorFor(noProject).kind, 'section', 'no ids at all → the section')

  const legacyProposal: AppNotification = { id: 'x', kind: 'proposal.opened', at: 0, read: false, actor: 'x', agentId: 'a9' }
  assert.equal(doorFor(legacyProposal).kind, 'agent', 'no proposalId → the agent detail')

  const noAgent: AppNotification = { id: 'x', kind: 'proposal.merged', at: 0, read: false, actor: 'x' }
  assert.equal(doorFor(noAgent).kind, 'section', 'no ids at all → the section')
})

test('a door never carries a tenant id — only public-face entity ids (the D24 leak-wall, structurally)', () => {
  // Each key here is a deliberate declaration that the id is a PUBLIC face. A
  // discussion id (`disc-N`) qualifies like a work item's or a proposal's: a
  // sequential entity id, and `social.discussed` only reaches recipients who can
  // read that thread by construction (its anchor's owner, or a participant).
  // `ownerName` (S7, the `social.followed` door) is a DISPLAY NAME — the D21
  // public handle that `/u/:name` already addresses and that every REDACTED
  // wire face already carries. It belongs here for the same reason the ids do:
  // it is the public identity, and the alternative (a tenant id) is exactly
  // what this test exists to keep out.
  const allowed = new Set(['kind', 'projectId', 'workItemId', 'proposalId', 'agentId', 'commentId', 'discussionId', 'ownerName', 'section'])
  for (const kind of NOTIFICATION_KINDS) {
    for (const key of Object.keys(doorFor(sample(kind)))) {
      assert.ok(allowed.has(key), `${kind} door exposes only public-face keys; found "${key}"`)
    }
  }
})

test('social.discussed lands on the THREAD, not its subject — the post is on that page', () => {
  const intent = doorFor(sample('social.discussed'))
  assert.equal(intent.kind, 'discussion')
  assert.ok(intent.kind === 'discussion')
  assert.equal(intent.discussionId, 'disc-1')
  // A row minted before the id field degrades to the section — still not a
  // dead click (the rule every other kind keeps).
  const legacy = { ...sample('social.discussed'), discussionId: undefined }
  const degraded = doorFor(legacy)
  assert.equal(degraded.kind, 'section')
  assert.ok(degraded.kind === 'section')
  assert.equal(degraded.section, 'discussions')
})

/** ── A bell is an interruption, so Back is the way home ──────────────────────
 *  Owner directive, 2026-08-08: *"the back button should honestly link to
 *  previous page in history. In the case the page is opened from notifications,
 *  the back button should link to it as well."*
 *
 *  Chrome doors reset the back stack — deliberate top-level navigation starts
 *  fresh (ADAPT-18, GitHub's top-nav rule), and the rail and the palette still
 *  do. The notification panel is the exception the rule needed: you did not ASK
 *  to go anywhere, you were told something happened. Landing with no way back
 *  makes answering a bell cost you your place.
 *
 *  Locked structurally, because the wiring is what rots: the panel takes ONE
 *  bundle (so no door can be wired with the wrong flavour), the two flavours
 *  come from ONE body (so a new door can't be born with only one), and the
 *  pushing bundle is what App hands the panel. */
test('the bell’s doors carry their origin — one bundle, from one body', async () => {
  const { filesUnder, read, ROOT, stripComments } = await import('./helpers/source.ts')
  const { join } = await import('node:path')
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'useSessionWorkspace.ts'))).replace(/\s+/g, ' ')

  // ONE body, two bindings — the plain set and the pushed set.
  assert.match(controller, /makeDoors = useCallback\(\(push\?: boolean\)/, 'the doors are minted by one parameterized factory')
  assert.match(controller, /const doors = useMemo\(\(\) => makeDoors\(\)/, 'the plain flavour: chrome navigation starts fresh')
  assert.match(controller, /pushingDoors = useMemo\(\(\) => makeDoors\(true\)/, 'the pushed flavour: a bell carries its origin')
  // The push has to reach the router, or both bundles would behave identically.
  assert.match(controller, /routeDoor\?\.\(section, seed, push\)/, 'the seeded doors pass it through')
  assert.match(controller, /routeSection\?\.\(s, sub \?\? null, push\)/, '…and so does the bare-section one')

  // The panel takes the BUNDLE. Seven separate handlers is where one of them
  // silently keeps the wrong flavour — the shape this test exists to prevent.
  const panel = stripComments(read(join(ROOT, 'src', 'components', 'NotificationsPanel.tsx'))).replace(/\s+/g, ' ')
  assert.match(panel, /doors: NotificationDoors/, 'the panel takes one doors bundle')
  assert.doesNotMatch(panel, /onOpen(Project|Section|WorkItem|Proposal|Agent|Discussion|Owner)\??:/, 'no per-door prop survives to be mis-wired')

  const app = stripComments(read(join(ROOT, 'src', 'App.tsx'))).replace(/\s+/g, ' ')
  assert.match(app, /<NotificationsPanel[^>]*doors=\{pushingDoors\}/, 'App hands the panel the PUSHING bundle')

  // And the rule stays an exception: nothing else in the tree opts in.
  const users: string[] = []
  for (const f of filesUnder('src')) {
    const rel = f.replace(/\\/g, '/').split('/src/')[1]
    if (rel === 'controller/useSessionWorkspace.ts') continue
    if (/pushingDoors/.test(stripComments(read(f)))) users.push(rel)
  }
  assert.deepEqual(users, ['App.tsx'], 'the pushing bundle is wired in one place — the shell view')
})
