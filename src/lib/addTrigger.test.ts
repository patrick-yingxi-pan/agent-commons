/** The small inline text actions (src/lib/inlineAction.ts) — quiet ghost text
 *  buttons like the notifications "Mark all read", the work-item thread toggle,
 *  and the "+ Add context" trigger a picker-less surface embeds (EmptyState) —
 *  share one styling source so parallel roles look parallel. The "+ Add" text
 *  form additionally shares one component (src/components/AddTrigger.tsx) so
 *  copies are identical by construction. (The panel-FOOT add/edit triggers this
 *  module once styled — Add routine / Add tool / Edit destination… — moved into
 *  their section HEADERS as icon verbs; that funnel is lib/sectionAction.ts +
 *  src/lib/sectionAction.test.ts.) These lock that:
 *    1. the shared class is a real inline text-button cue,
 *    2. the AddTrigger component sources its styling from the shared module,
 *    3. the inline "+ Add context" trigger renders through AddTrigger,
 *    4. SectionView's inline text actions source the same shared class,
 *    5. the class is defined once — no component re-hardcodes the literal. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, concatSource } from '../../tests/helpers/source.ts'
import { INLINE_ACTION_CLASS } from './inlineAction.ts'

test('the shared inline-action class is an inline text-button affordance', () => {
  for (const piece of ['inline-flex', 'items-center', 'text-[12px]', 'font-medium', 'transition', 'hover:text-ink']) {
    assert.ok(INLINE_ACTION_CLASS.includes(piece), `keeps "${piece}"`)
  }
})

test('the AddTrigger component sources its styling from the shared module', () => {
  const src = read(join(ROOT, 'src', 'components', 'AddTrigger.tsx'))
  assert.match(src, /from\s+'(\.\.\/)+lib\/inlineAction'/, 'imports the shared module')
  assert.ok(src.includes('INLINE_ACTION_CLASS'), 'wears the shared class')
})

test('the inline "+ Add context" trigger renders through AddTrigger', () => {
  const src = read(join(ROOT, 'src', 'components', 'AddContextButton.tsx'))
  assert.match(src, /from\s+'\.\/AddTrigger'/, 'AddContextButton imports the shared trigger component')
  assert.ok(src.includes('<AddTrigger'), 'AddContextButton renders <AddTrigger> for its inline variant')
})

test('the inline text actions source the same shared inline-action class', () => {
  const section = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  assert.match(section, /from\s+'(\.\.\/)+lib\/inlineAction'/, 'SectionView imports the shared class')
  assert.ok(section.includes('INLINE_ACTION_CLASS'), 'and applies it to its inline text actions')
})

test('the inline-action class is defined once — no component re-hardcodes the literal', () => {
  // The full literal lives only in the lib module; everywhere else goes through the
  // constant or AddTrigger, so re-introducing a copy-pasted inline action fails this.
  const components = concatSource('src/components')
  assert.ok(
    !components.includes(INLINE_ACTION_CLASS),
    'no component re-hardcodes the inline-action class — it must come from lib/inlineAction',
  )
})
