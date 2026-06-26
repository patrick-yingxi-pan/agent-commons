/** The small inline panel-foot actions — the "+ Add ‹thing›" picker openers
 *  (project page **Add routine** / **Add context**, schedule page **Add tool**) and
 *  the Pencil edit-toggles (**Add instructions**, **Edit destination**, **Edit
 *  schedule**) — are logically parallel, so they must look parallel. They share one
 *  styling source (src/lib/inlineAction.ts); the "+ Add" ones additionally share one
 *  component (src/components/AddTrigger.tsx) so they're identical by construction
 *  rather than by copy-paste. These lock that:
 *    1. the shared class is a real inline text-button cue,
 *    2. the AddTrigger component sources its styling from the shared module,
 *    3. all three "+ Add" triggers render through AddTrigger,
 *    4. SectionView's edit-toggles source the same shared class,
 *    5. the class is defined once — no component re-hardcodes the literal. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, concatSource } from './helpers/source.ts'
import { INLINE_ACTION_CLASS } from '../src/lib/inlineAction.ts'

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

test('all three "+ Add" triggers (Add routine, Add context, Add tool) render through AddTrigger', () => {
  const consumers = ['src/components/SectionView.tsx', 'src/components/AddContextButton.tsx']
  for (const rel of consumers) {
    const src = read(join(ROOT, ...rel.split('/')))
    assert.match(src, /from\s+'\.\/AddTrigger'/, `${rel} imports the shared trigger component`)
    assert.ok(src.includes('<AddTrigger'), `${rel} renders <AddTrigger>`)
  }
  // SectionView carries two of them (Add routine + Add tool); AddContextButton the third.
  const section = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  assert.ok((section.match(/<AddTrigger/g) ?? []).length >= 2, 'SectionView renders both its add-triggers through it')
})

test('the edit-toggles source the same shared inline-action class', () => {
  const section = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  assert.match(section, /from\s+'(\.\.\/)+lib\/inlineAction'/, 'SectionView imports the shared class')
  assert.ok(section.includes('INLINE_ACTION_CLASS'), 'and applies it to its inline edit-toggles')
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
