/** The confirm dialog (`src/components/ConfirmDialog.tsx`) — the modal that
 *  stands between a click and an act that cannot be undone.
 *
 *  It exists because one did not: the trash can on a discussion post called
 *  deletion outright, and on 2026-08-11 a mis-aimed click took the opening
 *  question out of a seeded thread (owner report — the restore had to be done by
 *  hand, against the store file). Distance alone was not the fix, so these lock
 *  the two halves that are:
 *    1. the dialog composes the existing funnels rather than re-spelling them,
 *    2. focus lands on CANCEL, never on the destructive verb,
 *    3. the post list's trash OPENS it — the direct-delete path stays gone.
 *
 *  (3) is the one that would rot silently. A future edit that re-wires the trash
 *  straight to the mutation command leaves every other assertion here green, the dialog
 *  still present and still perfect, and simply never reached. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import { SCRIM_CLASS } from './scrim.ts'
import { DIALOG_SURFACE_CLASS } from './dialog.ts'
import { DANGER_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from './button.ts'

const DIALOG = join(ROOT, 'src', 'components', 'ConfirmDialog.tsx')
const src = () => stripComments(read(DIALOG))

test('the confirm dialog composes the funnels instead of re-spelling them', () => {
  const s = src()
  for (const symbol of ['SCRIM_CLASS', 'DIALOG_SURFACE_CLASS', 'DANGER_BUTTON_CLASS', 'SECONDARY_BUTTON_CLASS', 'useFocusTrap']) {
    assert.ok(s.includes(symbol), `ConfirmDialog takes ${symbol} from its funnel`)
  }
  // …and does not carry a second copy of any of their literals. A dialog that
  // re-hardcodes the scrim or the surface drifts from every other overlay the
  // first time one of them is retuned.
  for (const [name, literal] of [
    ['the scrim', SCRIM_CLASS],
    ['the dialog surface', DIALOG_SURFACE_CLASS],
    ['the danger button', DANGER_BUTTON_CLASS],
    ['the secondary button', SECONDARY_BUTTON_CLASS],
  ] as const) {
    assert.ok(!s.includes(literal), `${name} literal is not re-typed here — the import is the source`)
  }
  // The modal contract the focus trap implements (WCAG 2.4.3).
  assert.match(s, /role="dialog"/, 'announces itself as a dialog')
  assert.match(s, /aria-modal="true"/, 'and as a modal one')
})

test('focus lands on CANCEL, not on the destructive verb', () => {
  const s = src()
  // The ref named as `initialFocus` must be the one the CANCEL button carries.
  // Asserted by matching the two against each other rather than by looking for
  // a particular variable name, so renaming the ref cannot quietly point the
  // trap at the other button.
  const initial = /initialFocus:\s*([A-Za-z_$][\w$]*)/.exec(s)
  assert.ok(initial, 'the focus trap is given an explicit initial target')
  const focused = initial[1]
  // The Cancel button: the element whose text is Cancel, and the ref on it.
  const cancelBtn = /<button([^>]*?)>\s*Cancel/.exec(s)
  assert.ok(cancelBtn, 'there is a Cancel button')
  assert.match(
    cancelBtn[1],
    new RegExp(`ref=\\{${focused}\\}`),
    `the initial focus (${focused}) is the Cancel button — a dialog that opens pre-armed on the destructive verb reproduces the mis-click one layer up`,
  )
  // And the destructive one is NOT what the trap points at.
  const confirmBtn = /<button([^>]*?DANGER_BUTTON_CLASS[^>]*?)>/.exec(s)
  assert.ok(confirmBtn, 'the confirm button wears the danger face')
  assert.ok(!confirmBtn[1].includes(`ref={${focused}}`), 'the destructive verb never holds the initial focus')
})

test('a discussion post is never deleted without asking first', () => {
  const s = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  // Every post-deletion command, with enough context to include its enclosing
  // confirmation callback. Imports do not match because they carry no call.
  const calls = [...s.matchAll(/enqueueDiscussionPostDeletion\(\{/g)].map((m) => s.slice(Math.max(0, m.index - 900), m.index + 80))
  assert.ok(calls.length > 0, 'the post list still has a delete path at all')
  for (const context of calls) {
    assert.match(
      context.replace(/\s+/g, ' '),
      /onConfirm=\{\(\) => \{/,
      'the only caller of a post delete is the ConfirmDialog’s onConfirm — a trash can wired straight to the command is the bug this dialog was built for',
    )
  }
  // The trash itself opens the dialog…
  assert.match(s, /setConfirmDelete\(p\)/, 'the trash arms the dialog rather than acting')
  // …with the cascade CLEARED, every time. A widening this destructive must be
  // re-asked for, never inherited from the last time you agreed to it — and the
  // state lives above the dialog (it survives the close), so the reset has to be
  // deliberate.
  const arm = /onClick=\{\(\) => \{([\s\S]{0,200}?)\}\}/.exec(s.slice(s.indexOf('setCascade(false)') - 120))
  assert.ok(arm && arm[1].includes('setCascade(false)') && arm[1].includes('setConfirmDelete(p)'),
    'arming the dialog resets the cascade choice in the same handler')
  // …and stands apart from the reversible verbs beside it (owner directive
  // 2026-08-11: "space delete button a little far away"). Asserted on the
  // trash's own class, since the gap is what makes the neighbouring click safe.
  const trash = /aria-label=\{p\.mine === true \? 'Retract this post' : 'Delete this post'\}[\s\S]{0,240}?className=\{`([^`]*)`\}/.exec(s)
  assert.ok(trash, 'the trash control is findable')
  assert.match(trash[1], /\bml-3\b/, 'the trash sits a deliberate step away from Reply and Endorse')
})

test('the CASCADE option is offered only over a branch the viewer may delete entirely', () => {
  // The server is the wall — it re-asks the delete question of every post that
  // would go (`server/routes/discussions.test.ts`). This is the affordance half
  // (SOCIAL-4b): a checkbox offered over somebody else's replies is a promise
  // the write path then refuses, which is the dead-affordance shape this layer's
  // audits keep finding. It must read the answer the wire ALREADY carries per
  // post, never a second rule derived on the client.
  const s = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const gate = /const mayTakeBranch = ([^\n]*)/.exec(s)
  assert.ok(gate, 'the cascade option is gated')
  assert.match(gate[1], /\bevery\(/, 'over EVERY post in the branch, not the clicked one')
  assert.match(gate[1], /canDelete === true/, 'and on the server’s own answer, not a re-derived rule')
  assert.match(gate[1], /descendantsOf|under/, 'the set asked about is the branch underneath')
  // Unchecked by default, and the request only carries it when checked: a
  // cascade that rode along by default would be the most destructive act in the
  // product reached by the most ordinary click (INV-9, mirrored on the client).
  assert.match(
    s,
    /enqueueDiscussionPostDeletion\(\{[\s\S]*?postIds,[\s\S]*?cascade,/,
    'the confirm passes the exact effect and cascade choice through verbatim',
  )
})
