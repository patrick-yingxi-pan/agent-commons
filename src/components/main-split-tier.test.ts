/** Structural half of UI-55. The browser lock proves state survives a real
 * breakpoint hop; this prevents MainSplitGate from quietly restoring the old
 * wide-vs-overlay renderer fork that caused the remount. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, stripComments, ROOT } from '../../tests/helpers/source.ts'

test('responsive tiers project one mounted main-pane tree', () => {
  const source = stripComments(read(join(ROOT, 'src', 'components', 'MainSplit.tsx')))
  const gate = source.slice(source.indexOf('export function MainSplitGate'), source.indexOf('export function MainSplit('))
  const branch = source.slice(source.indexOf('function Branch('))

  assert.doesNotMatch(gate, /if\s*\(\s*overlay\s*\)/, 'the gate must not fork into a second pane renderer')
  assert.match(gate, /nodeAt\(tree, focusedPane\)[\s\S]*?panes\(tree\)\[0\]/, 'a stale focus path still reveals one leaf')
  assert.match(gate, /<MainSplit[\s\S]*?overlay=\{overlay\}/, 'every tier enters the same tree')
  assert.match(branch, /focusedPane\.startsWith\(childPath\)/, 'overlay visibility follows the focused branch path')
  assert.match(branch, /display:\s*'none'/, 'unfocused branches stay mounted and are hidden by layout')
})
