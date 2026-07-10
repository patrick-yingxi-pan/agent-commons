/** The loading spinner (src/components/Spinner.tsx, cue in src/lib/spinner.ts) —
 *  the one "in progress" indicator, worn by every run-status icon, the run/pause
 *  toggles, and the A2A-card viewer's loading line. Form follows function: one
 *  styled primitive, its spin gated behind `motion-safe` so it honors
 *  `prefers-reduced-motion` (WCAG 2.3.3 — a static icon for motion-sensitive
 *  viewers; it also lets a headless screenshot settle instead of chasing an
 *  animation that never ends). These lock that:
 *    1. the shared cue really is the reduced-motion-respecting spin,
 *    2. SectionView routes its spinners through <Spinner>, and
 *    3. NO component (or the shell) re-hardcodes a bare infinite-animation
 *       utility — every `animate-{spin,pulse,ping,bounce}` must be `motion-safe:`
 *       gated, so a motion-reduced viewer never gets an ungated animation. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, filesUnder, stripComments } from './helpers/source.ts'
import { SPINNER_CLASS } from '../src/lib/spinner.ts'

test('the shared spinner cue is the motion-safe spin', () => {
  assert.equal(SPINNER_CLASS, 'motion-safe:animate-spin')
})

test('SectionView routes its spinners through the shared component', () => {
  const src = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  assert.match(src, /from\s+'\.\/Spinner'/, 'imports the shared component')
  // The run-status icons, the run/pause toggles, and the card-loading line — the
  // seven former inline Loader2 spinners — now all wear <Spinner>.
  assert.ok((src.match(/<Spinner\b/g) ?? []).length >= 7, 'every spinner wears the shared component')
})

test('no component or the shell re-hardcodes an ungated infinite animation', () => {
  // Every infinite-animation utility must be motion-safe: gated (negative lookbehind
  // excludes the gated form). Comment-stripped so a doc example can neither satisfy
  // nor trip the scan. Sweeps ALL of src/ (a cue added in lib/ or controller/ must
  // obey the same gate — the scan once covered only components/ and a stray in lib/
  // would have shipped ungated). lib/spinner.ts holds the one gated literal, which
  // the lookbehind already admits.
  const ungated = /(?<!motion-safe:)animate-(spin|pulse|ping|bounce)\b/
  const files = ['src/components', 'src/lib', 'src/controller', 'src/api', 'src/data'].flatMap((d) => filesUnder(d))
  for (const file of [...files, join(ROOT, 'src', 'App.tsx')]) {
    const src = stripComments(read(file))
    const hit = src.match(ungated)
    assert.ok(!hit, `${file} must gate "${hit?.[0]}" behind motion-safe: (use <Spinner> or motion-safe:…)`)
  }
})

test('raw CSS keyframe animations are reduced-motion gated (the stream caret + thinking dots)', () => {
  // The two INFINITE keyframe animations in index.css predate the spinner funnel
  // and shipped ungated — a motion-reduced viewer got a blinking caret and pulsing
  // dots for entire generations. Lock: every `animation:` that plays an infinite
  // keyframe lives inside a `prefers-reduced-motion: no-preference` block.
  const css = read(join(ROOT, 'src', 'index.css'))
  const gated = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'))
  assert.match(gated, /\.stream-caret\s*\{\s*animation: caret-blink/, 'the caret blink is motion-gated')
  assert.match(gated, /\.thinking-dot\s*\{\s*animation: dot-pulse/, 'the dot pulse is motion-gated')
  const ungatedHalf = css.slice(0, css.indexOf('@media (prefers-reduced-motion: no-preference)'))
  assert.doesNotMatch(ungatedHalf, /animation:[^;]*infinite/, 'no infinite animation outside the gate')
})
