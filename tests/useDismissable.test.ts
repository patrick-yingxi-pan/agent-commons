/** Every popover / dropdown / menu shares one "dismiss on outside-click + Escape"
 *  behaviour, extracted to src/lib/useDismissable.ts so it can't drift between
 *  copy-pasted copies and a fix lands everywhere at once (form follows function,
 *  like lib/inlineAction + lib/foldHeader). These lock that:
 *    1. the shared hook owns the document mousedown + Escape listeners,
 *    2. no component re-hardcodes a raw document mousedown listener — the dismiss
 *       effect must come from the hook,
 *    3. every dismissable popover/menu consumer sources it from the shared hook. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, concatSource } from './helpers/source.ts'

/** A raw "close this popover on an outside click" binding, in either quote style. */
const RAW_MOUSEDOWN = /addEventListener\(\s*['"]mousedown['"]/

test('the shared hook owns the dismiss listeners (outside-click + Escape)', () => {
  const src = read(join(ROOT, 'src', 'lib', 'useDismissable.ts'))
  assert.match(src, /export function useDismissable\b/, 'exports useDismissable')
  assert.match(src, RAW_MOUSEDOWN, 'binds the document mousedown listener')
  assert.ok(src.includes("addEventListener('keydown'"), 'binds the document keydown listener')
  assert.ok(src.includes("'Escape'"), 'dismisses on Escape')
  assert.ok(src.includes("removeEventListener('mousedown'"), 'tears the mousedown listener down')
  assert.ok(src.includes("removeEventListener('keydown'"), 'tears the keydown listener down')
})

test('no component re-hardcodes the dismiss effect — it must go through the hook', () => {
  // The outside-click listener lives only in the hook; every popover/dropdown/menu
  // gets it via useDismissable, so re-introducing a copy-pasted dismiss effect (a
  // raw document mousedown listener inside a component) fails this test. Comments
  // are stripped first, so prose mentioning "mousedown" can't trip it.
  const components = concatSource('src/components')
  assert.ok(
    !RAW_MOUSEDOWN.test(components),
    'no component binds a document mousedown listener directly — use lib/useDismissable',
  )
})

test('the dismissable consumers source their dismiss behaviour from the shared hook', () => {
  // The full spread of dismissable surfaces: composer-footer controls, the portaled
  // menus (which keep their own panel stopPropagation), and the Customize cards —
  // each must import and call the hook rather than re-derive the effect.
  const consumers = [
    'src/components/HostsControl.tsx',
    'src/components/ProvidersControl.tsx',
    'src/components/ModelEffortControl.tsx',
    'src/components/UsageControl.tsx',
    'src/components/AudioInputControl.tsx',
    'src/components/PermissionModeControl.tsx',
    'src/components/AddContextButton.tsx',
    'src/components/Composer.tsx',
    'src/components/FilterMenu.tsx',
    'src/components/RowMenu.tsx',
    'src/components/artifactPreview.tsx',
    'src/components/SectionView.tsx',
  ]
  for (const rel of consumers) {
    const src = read(join(ROOT, ...rel.split('/')))
    assert.match(src, /from\s+'(\.\.\/)+lib\/useDismissable'/, `${rel} imports the shared hook`)
    assert.ok(src.includes('useDismissable<') || src.includes('useDismissable('), `${rel} calls useDismissable`)
  }
})
