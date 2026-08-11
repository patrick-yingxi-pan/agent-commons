/** The confirm dialog (`src/components/ConfirmDialog.tsx`) — the modal that
 *  stands between a click and an act that cannot be undone.
 *
 *  It exists because one did not: the trash can on a discussion post called
 *  `onDelete` outright, and on 2026-08-11 a mis-aimed click took the opening
 *  question out of a seeded thread (owner report — the restore had to be done by
 *  hand, against the store file). Distance alone was not the fix, so these lock
 *  the two halves that are:
 *    1. the dialog composes the existing funnels rather than re-spelling them,
 *    2. focus lands on CANCEL, never on the destructive verb,
 *    3. the post list's trash OPENS it — the direct-delete path stays gone.
 *
 *  (3) is the one that would rot silently. A future edit that re-wires the trash
 *  straight to `onDelete` leaves every other assertion here green, the dialog
 *  still present and still perfect, and simply never reached. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from './helpers/source.ts'
import { SCRIM_CLASS } from '../src/lib/scrim.ts'
import { DIALOG_SURFACE_CLASS } from '../src/lib/dialog.ts'
import { DANGER_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../src/lib/button.ts'

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
  // Every call of the post-delete callback, with a little context around it.
  const calls = [...s.matchAll(/onDelete\??\.?\(([^)]*)\)/g)].map((m) => s.slice(Math.max(0, m.index - 200), m.index + 40))
  assert.ok(calls.length > 0, 'the post list still has a delete path at all')
  for (const context of calls) {
    assert.match(
      context.replace(/\s+/g, ' '),
      /onConfirm=/,
      'the only caller of a post delete is the ConfirmDialog’s onConfirm — a trash can wired straight to onDelete is the bug this dialog was built for',
    )
  }
  // The trash itself opens the dialog…
  assert.match(s, /onClick=\{\(\) => setConfirmDelete\(p\)\}/, 'the trash arms the dialog rather than acting')
  // …and stands apart from the reversible verbs beside it (owner directive
  // 2026-08-11: "space delete button a little far away"). Asserted on the
  // trash's own class, since the gap is what makes the neighbouring click safe.
  const trash = /aria-label=\{p\.mine === true \? 'Retract this post' : 'Delete this post'\}[\s\S]{0,240}?className=\{`([^`]*)`\}/.exec(s)
  assert.ok(trash, 'the trash control is findable')
  assert.match(trash[1], /\bml-3\b/, 'the trash sits a deliberate step away from Reply and Endorse')
})
