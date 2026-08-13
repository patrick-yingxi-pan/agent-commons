/** Section-header action clusters (src/lib/sectionAction.ts + SectionAction) —
 *  every section's verbs (edit the description / instructions / schedule / steps /
 *  destination, add a routine / context / tool, commission an agent, claim a
 *  sub-goal, post a work item) render as ONE compact icon-button primitive in the
 *  header's right-aligned, hover-revealed cluster (lib/hoverReveal SECTION_REVEAL).
 *  They used to be scattered always-visible text buttons at panel feet — each a
 *  drift-prone copy, all permanent noise. These lock that:
 *    1. the shared class is the compact ghost square with an active (data-open) state,
 *    2. the SectionAction component sources the class and NAMES its verb
 *       (title + aria-label — the icon alone must still announce itself),
 *    3. the section surfaces consume the shared component,
 *    4. the class is defined once — no component re-hardcodes the literal. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, concatSource } from '../../tests/helpers/source.ts'
import { SECTION_ACTION_CLASS } from './sectionAction.ts'

test('the shared section-action class is a compact ghost icon button with an active state', () => {
  for (const piece of ['h-6 w-6', 'rounded-md', 'text-ink-faint', 'transition', 'data-[open=true]:bg-panel-2']) {
    assert.ok(SECTION_ACTION_CLASS.includes(piece), `keeps "${piece}"`)
  }
})

test('the SectionAction component sources the class and names its verb', () => {
  const src = read(join(ROOT, 'src', 'components', 'SectionAction.tsx'))
  assert.match(src, /from\s+'(\.\.\/)+lib\/sectionAction'/, 'imports the shared module')
  assert.ok(src.includes('SECTION_ACTION_CLASS'), 'wears the shared class')
  assert.ok(src.includes('title={label}'), 'the verb is the tooltip')
  assert.ok(src.includes('aria-label={label}'), 'the verb is the accessible name')
  assert.ok(src.includes('data-open={state || undefined}'), 'open/expanded triggers stamp data-open for the cluster reveal')
  // Two stateful shapes, distinct aria: a popover trigger (`open`) carries
  // aria-haspopup="dialog"; an inline-disclosure toggle (`expanded`) carries
  // aria-expanded WITHOUT haspopup — the disclosed form is section content.
  assert.ok(src.includes("'aria-haspopup': 'dialog'"), 'popover triggers announce the dialog')
  assert.match(src, /aria-expanded/, 'stateful triggers announce expanded state')
})

test('the section surfaces render their header verbs through SectionAction', () => {
  for (const rel of ['src/components/SectionView.tsx', 'src/components/AddContextButton.tsx']) {
    const src = read(join(ROOT, ...rel.split('/')))
    assert.match(src, /from\s+'\.\/SectionAction'/, `${rel} imports the shared component`)
    assert.ok(src.includes('<SectionAction'), `${rel} renders <SectionAction>`)
  }
  // The project + schedule pages carry the bulk of the verbs (description edit,
  // instructions, commission, claim, post, add routine/tool, schedule/steps/
  // destination edits) — a conversion back to a bespoke button shows up here.
  const section = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  const uses = (section.match(/<SectionAction/g) ?? []).length
  assert.ok(uses >= 10, `SectionView renders its section verbs through it (${uses} uses)`)
})

test('the section-action class is defined once — no component re-hardcodes the literal', () => {
  const components = concatSource('src/components')
  assert.ok(
    !components.includes(SECTION_ACTION_CLASS),
    'no component re-hardcodes the section-action class — it must come from lib/sectionAction',
  )
})
