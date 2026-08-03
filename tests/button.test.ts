/** The solid button (src/lib/button.ts) — one face for a solid action button.
 *  Before the funnel the app spoke three solid languages at once: nineteen
 *  ink-dark solids (`bg-ink text-canvas hover:opacity-90`, PrimaryButton
 *  included), the claret solids on the consent cards, and a `bg-removed`
 *  destructive confirm on the diff hue. These lock that:
 *    1. the two recipes carry face-ness (color ramp, weight, radius, ramp
 *       hover) and no size — the textDoor split of cue vs caller,
 *    2. the dead spellings can't come back, tree-wide, with the one declared
 *       non-button (the tooltip's dark bubble) alive-checked,
 *    3. the consumers source the face from the module. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, filesUnder, stripComments } from './helpers/source.ts'
import { SOLID_BUTTON_CLASS, DANGER_BUTTON_CLASS, SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../src/lib/button.ts'

const FUNNEL = join('src', 'lib', 'button.ts')

test('the solid faces ramp on hover and carry no size', () => {
  for (const [cue, ramp] of [
    [SOLID_BUTTON_CLASS, 'accent'],
    [DANGER_BUTTON_CLASS, 'danger'],
  ] as const) {
    assert.ok(cue.includes(`bg-${ramp}`) && cue.includes(`hover:bg-${ramp}-strong`), `${ramp} ramps on hover`)
    assert.ok(cue.includes('text-on-solid'), `${ramp} keeps readable label atop the fill`)
    assert.ok(cue.includes('rounded-md'), `${ramp} sits on the control radius`)
    // An opacity hover washes the label with the fill; state changes by ramp.
    assert.ok(!cue.includes('opacity'), `${ramp} never hovers by opacity`)
    // Size and layout are the caller's (a full-width auth submit vs a compact
    // approve chip) — the textDoor lesson.
    assert.ok(!/\btext-\[|\btext-sm|\bpx-|\bpy-|\bflex\b/.test(cue), `${ramp} carries no size or layout`)
  }
  // The bordered secondary: a frame, never a fill — the Claret candidate
  // reserves solid claret for the CTA tier, so the page-level verb answers in
  // accent only on hover.
  assert.ok(SECONDARY_BUTTON_CLASS.includes('border-line-strong'), 'the secondary is framed')
  assert.ok(!/bg-(accent|danger|ink)(?![\w-])/.test(SECONDARY_BUTTON_CLASS), 'the secondary never fills solid')
  assert.ok(/hover:(border|text)-accent/.test(SECONDARY_BUTTON_CLASS), 'the secondary answers in accent on hover')
  assert.ok(SECONDARY_BUTTON_CLASS.includes('rounded-md'), 'the secondary sits on the control radius')
  assert.ok(!/\btext-\[|\btext-sm|\bpx-|\bpy-|\bflex\b/.test(SECONDARY_BUTTON_CLASS), 'no size or layout')
  // The SOFT verb — the below-CTA affirmative (2026-08-03: opaque claret read
  // heavy): tinted fill, strong text, the fill deepening on hover. Never
  // on-solid (that's the CTA tier's voice), never a shadow, no size.
  assert.ok(SOFT_BUTTON_CLASS.includes('bg-accent-tint') && SOFT_BUTTON_CLASS.includes('text-accent-strong'))
  assert.ok(/hover:bg-accent\//.test(SOFT_BUTTON_CLASS), 'the soft verb deepens its own fill on hover')
  assert.ok(!SOFT_BUTTON_CLASS.includes('on-solid') && !SOFT_BUTTON_CLASS.includes('shadow'))
  assert.ok(SOFT_BUTTON_CLASS.includes('rounded-md'), 'the soft verb sits on the control radius')
  assert.ok(!/\btext-\[|\btext-sm|\bpx-|\bpy-|\bflex\b/.test(SOFT_BUTTON_CLASS), 'no size or layout')
  // The seat law (the Bindery duet, src/index.css): VERBS never wear the
  // co-color — a button face referencing `co` has crossed into the places'
  // seat, and the duet collapses back into one voice.
  for (const cue of [SOLID_BUTTON_CLASS, DANGER_BUTTON_CLASS, SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS]) {
    assert.ok(!/\bco\b|-co(?![\w])|co-/.test(cue), `verbs never wear the co-color: "${cue}"`)
  }
})

/** The one element allowed to pair `bg-ink` with `text-canvas`: the tooltip's
 *  dark bubble — an overlay voice, not a control. Marker within a small window
 *  of the offending line, per-element like text-door's NON_DOORS. */
const MARKER_WINDOW = 3
const NON_BUTTONS: Record<string, string[]> = {
  'src/components/Tooltip.tsx': ['pointer-events-none'],
}

test('the dead solid spellings stay dead — tree-wide', () => {
  const offenders: string[] = []
  const usedMarkers = new Set<string>()
  for (const file of filesUnder('src')) {
    if (file.endsWith(FUNNEL)) continue
    const rel = file.slice(ROOT.length + 1).split('\\').join('/')
    const markers = NON_BUTTONS[rel] ?? []
    const lines = stripComments(read(file)).split('\n')
    lines.forEach((line, i) => {
      const inkSolid = line.includes('bg-ink') && line.includes('text-canvas')
      // A solid fill hovering by opacity is the pre-funnel language, whatever
      // the fill; and bg-removed is the DIFF hue — a destructive control takes
      // DANGER_BUTTON_CLASS.
      const opacityHover = /bg-(ink|accent|danger|removed)[^"'`]*hover:(opacity|brightness)/.test(line)
      const removedControl = /bg-removed px-/.test(line)
      // A hand-rolled ramp solid: the exact face the funnel owns, retyped —
      // `(?![\w-])` keeps bg-accent-tint (a resting tint, not a fill) clear, and
      // `(?<!group-)` spares group-hover cues (the resize handle's grip line
      // brightening to accent is a separator's affordance, not a button face).
      const handRolledRamp =
        /bg-(accent|danger)(?![\w-])/.test(line) && /(?<!group-)hover:bg-(accent|danger)(-strong|\/)/.test(line)
      if (!inkSolid && !opacityHover && !removedControl && !handRolledRamp) return
      const near = lines.slice(Math.max(0, i - MARKER_WINDOW), i + MARKER_WINDOW + 1).join('\n')
      const excuse = markers.find((m) => near.includes(m))
      if (excuse) usedMarkers.add(`${rel}::${excuse}`)
      else offenders.push(`${rel}:${i + 1}`)
    })
  }
  assert.deepEqual(
    offenders,
    [],
    'a solid button was spelled by hand — take SOLID_BUTTON_CLASS / DANGER_BUTTON_CLASS from src/lib/button.ts',
  )
  for (const [rel, markers] of Object.entries(NON_BUTTONS)) {
    for (const m of markers) {
      assert.ok(
        usedMarkers.has(`${rel}::${m}`),
        `${rel}'s exemption "${m}" no longer excuses any line — drop it`,
      )
    }
  }
})

test('the consumers source the face from the module', () => {
  const consumers: Array<[string, string, number]> = [
    // The soft tier carries every below-CTA affirmative (2026-08-03).
    ['src/components/SectionView.tsx', 'SOFT_BUTTON_CLASS', 15],
    ['src/components/SectionView.tsx', 'DANGER_BUTTON_CLASS', 1],
    ['src/components/EscalationPrompt.tsx', 'SOFT_BUTTON_CLASS', 2],
    ['src/components/RelationActionCard.tsx', 'SOFT_BUTTON_CLASS', 1],
    ['src/components/ToolActivityCard.tsx', 'DANGER_BUTTON_CLASS', 1],
    ['src/components/RowMenu.tsx', 'DANGER_BUTTON_CLASS', 1],
    ['src/components/Composer.tsx', 'DANGER_BUTTON_CLASS', 2],
    ['src/components/panels/ArtifactPanel.tsx', 'DANGER_BUTTON_CLASS', 1],
    // PrimaryButton (the shared page-header verb) is a SECONDARY under the
    // candidate's CTA guardrail. TRUE solids survive only where a surface has
    // ONE defining act: the rail's New session and the auth Sign in.
    ['src/components/SectionView.tsx', 'SECONDARY_BUTTON_CLASS', 1],
    ['src/components/Sidebar.tsx', 'SOLID_BUTTON_CLASS', 1],
    ['src/lib/authFlow.ts', 'SOLID_BUTTON_CLASS', 1],
  ]
  for (const [rel, symbol, least] of consumers) {
    const src = read(join(ROOT, ...rel.split('/')))
    assert.match(src, /from '((\.\.\/)+lib\/button|\.\/button(\.ts)?)'/, `${rel} imports the shared face`)
    // Bare-identifier count (a ternary arm wears the symbol without `${}`),
    // minus the import line's own mention.
    const uses = (src.match(new RegExp(`\\b${symbol}\\b`, 'g')) ?? []).length - 1
    assert.ok(uses >= least, `${rel} wears ${symbol} at ${least}+ buttons (found ${uses})`)
  }
})
