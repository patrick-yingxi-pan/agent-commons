/** The checkbox cue + the "set as default" control (src/lib/checkbox.ts,
 *  src/components/Checkbox.tsx) — form follows function, one styled primitive:
 *  every checkbox square (the two "Don't ask again" rows, the relay panel's
 *  saved-secret gate, a commission's Standing grant, the admitted checklists, the
 *  registry dialogs' default toggle) wears the same lib-hosted cue, and both
 *  registry dialogs (Provider, Prompt) offer the default flag through the SAME
 *  <DefaultToggle> component, with the row badge from the same module. These lock that:
 *    1. the shared cues are real (accent-filled square when on, quiet border off),
 *    2. the dialogs + the badge consumers source the shared components,
 *    3. nothing re-hardcodes the square or the badge literal. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, filesUnder, stripComments } from './helpers/source.ts'
import {
  CHECKBOX_BOX_CLASS,
  CHECKBOX_BOX_OFF_CLASS,
  CHECKBOX_BOX_ON_CLASS,
  DEFAULT_BADGE_CLASS,
  DEFAULT_TOGGLE_CLASS,
} from '../src/lib/checkbox.ts'

test('the shared checkbox cues are a real square-check idiom', () => {
  for (const piece of ['h-3.5 w-3.5', 'items-center justify-center', 'rounded border']) {
    assert.ok(CHECKBOX_BOX_CLASS.includes(piece), `box keeps "${piece}"`)
  }
  // bg-co since the Bindery duet — a checked box is a SELECTION (a place cue),
  // so it fills the co-color, not the verb accent (src/index.css seat law).
  assert.ok(CHECKBOX_BOX_ON_CLASS.includes('bg-co'), 'on-state fills the co-color')
  assert.ok(CHECKBOX_BOX_ON_CLASS.includes('text-on-solid'), 'on-state check is the on-solid token (white atop the fill)')
  assert.ok(CHECKBOX_BOX_OFF_CLASS.includes('border-line-strong'), 'off-state is a quiet border')
  assert.ok(DEFAULT_TOGGLE_CLASS.includes('w-full'), 'the toggle reads as a first-class field row')
  assert.ok(DEFAULT_BADGE_CLASS.includes('bg-accent-tint'), 'the badge is the accent-tint chip')
})

test('both registry dialogs offer the default flag through the one <DefaultToggle>', () => {
  const src = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  assert.match(src, /from\s+'\.\/Checkbox'/, 'imports the shared component')
  // ProviderDialog + PromptDialog — one toggle each.
  assert.ok((src.match(/<DefaultToggle\b/g) ?? []).length >= 2, 'both dialogs wear the shared toggle')
  // The flagged rows wear the shared badge (Models card + prompt card).
  assert.ok((src.match(/<DefaultBadge\b/g) ?? []).length >= 2, 'both registry rows wear the shared badge')
})

test('the checkbox square is funneled — no component re-hardcodes it', () => {
  // The literal lives only in src/lib/checkbox.ts; consumers render <CheckSquare>
  // (or <CheckboxRow>/<DefaultToggle>, which wrap it). Both "Don't ask again" rows
  // were pre-existing inline copies — now unified; this keeps the next checkbox
  // from forking the cue again.
  for (const file of filesUnder('src/components')) {
    const src = stripComments(read(file))
    assert.ok(
      !src.includes('h-3.5 w-3.5 shrink-0 items-center justify-center rounded border'),
      `${file} must take the checkbox square from lib/checkbox, not re-hardcode it`,
    )
    // The exact re-hardcode signature (the class as a whole className) — a looser
    // substring scan would false-positive on other accent-tint chips.
    assert.ok(
      !src.includes(`className="${DEFAULT_BADGE_CLASS}"`),
      `${file} must render <DefaultBadge>, not re-hardcode the badge chip`,
    )
  }
})

test('no raw checkbox inputs sneak in beside the shared idiom', () => {
  // The repo renders checkboxes as the shared accent square (a native input would
  // look foreign beside it; the escapes this caught: the AdmittedChecklist rows, a
  // commission's Standing grant, the relay panel's saved-secret gate). A future
  // real-form need should extend lib/checkbox, not drop an `<input type="checkbox">`.
  for (const file of filesUnder('src')) {
    assert.ok(
      !stripComments(read(file)).includes('type="checkbox"'),
      `${file} should use the shared checkbox idiom (lib/checkbox), not a raw input`,
    )
  }
})
