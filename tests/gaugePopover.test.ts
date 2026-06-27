/** The composer-footer ambient gauges (Hosts, Model providers) are the same control
 *  — an `icon + count` button toggling a small bottom-anchored popover — so they share
 *  one styled primitive, src/components/GaugePopover.tsx, rather than copy-pasting the
 *  button + popover shell (form follows function — same role ⇒ same look, like
 *  lib/foldHeader + AddTrigger). These lock that:
 *    1. GaugePopover owns the gauge button + popover-container chrome,
 *    2. neither gauge re-hardcodes that shell — they go through the primitive. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read } from './helpers/source.ts'

/** The gauge button's distinctive shell + the popover container — the chrome that must
 *  live only in GaugePopover, not be re-pasted into a gauge. */
const GAUGE_BUTTON = /h-7 items-center gap-1 rounded-lg px-1\.5/
const POPOVER_SHELL = /absolute bottom-full right-0 z-20/

const GAUGES = ['src/components/HostsControl.tsx', 'src/components/ProvidersControl.tsx']

test('GaugePopover owns the shared ambient-gauge chrome', () => {
  const src = read(join(ROOT, 'src', 'components', 'GaugePopover.tsx'))
  assert.match(src, /export function GaugePopover\b/, 'exports GaugePopover')
  assert.match(src, GAUGE_BUTTON, 'owns the gauge button shell')
  assert.match(src, POPOVER_SHELL, 'owns the popover container shell')
  // The dismiss behaviour comes from the shared hook, not a re-hardcoded listener.
  assert.match(src, /from\s+'(\.\.\/)*lib\/useDismissable'/, 'sources dismiss from useDismissable')
})

test('each ambient gauge goes through GaugePopover, not a re-pasted shell', () => {
  for (const rel of GAUGES) {
    const src = read(join(ROOT, ...rel.split('/')))
    assert.match(src, /from\s+'\.\/GaugePopover'/, `${rel} imports GaugePopover`)
    assert.ok(src.includes('<GaugePopover'), `${rel} renders GaugePopover`)
    assert.ok(!GAUGE_BUTTON.test(src), `${rel} must not re-hardcode the gauge button shell`)
    assert.ok(!POPOVER_SHELL.test(src), `${rel} must not re-hardcode the popover shell`)
  }
})
