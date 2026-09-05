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
import { NOTIFICATION_KINDS, type NotificationKind, type AppNotification } from '../../contract/index.ts'
import { doorFor } from './notificationDoor.ts'

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
    scheduleId: 'routine-1',
    scheduleName: 'Morning brief',
    runId: 'run-1',
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

test('schedule.failed opens the exact routine and failed run', () => {
  assert.deepEqual(doorFor(sample('schedule.failed')), {
    kind: 'schedule',
    scheduleId: 'routine-1',
    runId: 'run-1',
  })
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
  const allowed = new Set(['kind', 'projectId', 'workItemId', 'proposalId', 'agentId', 'commentId', 'discussionId', 'ownerName', 'scheduleId', 'runId', 'section'])
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

test('social.reported lands on the exact moderated thread and preserves the legacy subject fallback', () => {
  assert.deepEqual(doorFor(sample('social.reported')), {
    kind: 'discussion',
    discussionId: 'disc-1',
  })
  assert.deepEqual(
    doorFor({ ...sample('social.reported'), discussionId: undefined }),
    { kind: 'project', projectId: 'p1' },
  )
})

/** ── A bell is an interruption, so Back is the way home ──────────────────────
 *  Owner directive, 2026-08-08: *"the back button should honestly link to
 *  previous page in history. In the case the page is opened from notifications,
 *  the back button should link to it as well."* Then, on being told the inbox
 *  was an overlay with no address: *"shouldn't the back button get him to the
 *  notifications page?"*
 *
 *  The first answer gave the OVERLAY's doors a pushing flavour at the shell —
 *  a rule with an exception. The second replaced it: the inbox became a PAGE,
 *  so its rows are ordinary in-page doors and carry their origin through the
 *  same funnel every other in-page door uses. The exception was deleted along
 *  with the machinery that implemented it, which is the better fix and the
 *  reason this test now asserts a SHAPE rather than a flag.
 *
 *  What must stay true: the inbox is a place (a section with a URL), its doors
 *  go through the PANE bridge (a shell door would reset the very history the
 *  page exists to be part of), and no shell-level notification doors survive to
 *  offer a second way. */
test('the inbox is a PAGE, and its rows are in-page doors', async () => {
  const { filesUnder, read, ROOT, sectionViewComponent, stripComments } = await import('../../tests/helpers/source.ts')
  const { join } = await import('node:path')
  const { pathForView, viewForPath } = await import('./urlRoutes.ts')

  // A place: registered like every other section, and addressable. Read as
  // SOURCE — `sections.tsx` carries JSX, which `node --test` cannot import.
  const sections = stripComments(read(join(ROOT, 'src', 'lib', 'sections.tsx')))
  const order = sections.slice(sections.indexOf('SECTION_ORDER'))
  assert.match(order, /'notifications',/, 'the rail lists it')
  const loc = { kind: 'section', section: 'notifications' }
  assert.equal(pathForView(loc, null), '/notifications', 'it has a canonical URL')
  assert.equal(viewForPath('/notifications')?.loc.section, 'notifications', '…which round-trips')

  // Its doors go through the PANE bridge (rel.navigate / onFocusHere), never
  // the shell's — that is what puts the inbox on the target's back stack.
  const page = stripComments(sectionViewComponent('NotificationsSection')).replace(/\s+/g, ' ')
  assert.match(page, /const doors: NotificationDoors = \{/, 'the page owns the door bundle')
  assert.match(page, /rel\.navigate\('discussions', discussionId\)/, 'a thread bell routes in-pane')
  assert.match(page, /rel\.navigate\('projects', projectId, workItemId\)/, 'a work bell routes in-pane')
  assert.match(page, /onFocusHere\(\{ projectId, workItemId, commentId \}\)/, '…carrying the transient highlight')

  // The overlay is gone, and with it the shell-level notification doors: two
  // ways in would be two behaviours, and one of them would be the old one.
  const strays: string[] = []
  for (const f of filesUnder('src')) {
    const rel = f.replace(/\\/g, '/').split('/src/')[1]
    const src = stripComments(read(f))
    if (/NotificationsPanel|pushingDoors/.test(src)) strays.push(rel)
    // A shell-level work-item door would be a second way in, with the old
    // (resetting) behaviour. The SHELL is what must not have one — the inbox
    // page's own bundle and its interface legitimately name it.
    const shell = rel === 'App.tsx' || rel === 'controller/useSessionWorkspace.ts'
    if (shell && /\bopenWorkItem\b/.test(src)) strays.push(`${rel}: openWorkItem`)
  }
  assert.deepEqual(strays, [], 'the overlay and its shell doors are fully retired')

  // The one door that still needs the shell's push flag: a proposal row inside
  // an agent page — pane-originated, but routed through the shell because it
  // must also set the focus target.
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'useSessionWorkspace.ts'))).replace(/\s+/g, ' ')
  assert.match(controller, /routeDoor\?\.\('agents', ownerName \? \{ agentId \} : \{\}, push\)/, 'the proposal door keeps its push')
})
