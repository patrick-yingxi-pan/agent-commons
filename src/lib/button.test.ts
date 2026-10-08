/** The solid button (src/lib/button.ts) — one face for a solid action button.
 *  Before the funnel the app spoke three solid languages at once: nineteen
 *  ink-dark solids (`bg-ink text-canvas hover:opacity-90`, the former page-header button
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
import { ROOT, read, filesUnder, resourcePageComponent, sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'
import {
  SOLID_BUTTON_CLASS,
  DANGER_BUTTON_CLASS,
  PAGE_ACTION_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SOFT_BUTTON_CLASS,
} from './button.ts'

const FUNNEL = join('src', 'lib', 'button.ts')

test('the solid faces ramp on hover and carry no size', () => {
  // The ramp is the SOLID seat (`*-solid`), not the text-tuned base: the fill
  // carries `on-solid`, and `accent`/`danger` are tuned to be read on the
  // canvas instead — in dark mode the two pull apart hard enough to put this
  // very button at 1.74:1 (invariant UI-20, src/lib/contrast.test.ts).
  for (const [cue, ramp] of [
    [SOLID_BUTTON_CLASS, 'accent-solid'],
    [DANGER_BUTTON_CLASS, 'danger-solid'],
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
  // The bordered secondary: a frame, never a fill — the neutral alternative in
  // an action pair answers in accent only on hover.
  assert.ok(SECONDARY_BUTTON_CLASS.includes('border-line-strong'), 'the secondary is framed')
  assert.ok(!/bg-(accent|danger|ink)(?![\w-])/.test(SECONDARY_BUTTON_CLASS), 'the secondary never fills solid')
  assert.ok(/hover:(border|text)-accent/.test(SECONDARY_BUTTON_CLASS), 'the secondary answers in accent on hover')
  assert.ok(SECONDARY_BUTTON_CLASS.includes('rounded-md'), 'the secondary sits on the control radius')
  assert.ok(SECONDARY_BUTTON_CLASS.includes('disabled:opacity-50'), 'disabled secondary actions visibly differ from enabled actions')
  assert.ok(SECONDARY_BUTTON_CLASS.includes('disabled:cursor-not-allowed'), 'disabled secondary actions retain an unavailable pointer cue')
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

test('the page action is one complete, palette-driven control role', () => {
  assert.ok(PAGE_ACTION_BUTTON_CLASS.includes(SOFT_BUTTON_CLASS), 'the page verb uses the soft affirmative face')
  for (const cue of ['h-8', 'px-3.5', 'text-[13px]', 'gap-1.5']) {
    assert.ok(PAGE_ACTION_BUTTON_CLASS.includes(cue), `the page role owns ${cue}`)
  }
  assert.ok(PAGE_ACTION_BUTTON_CLASS.includes('ring-accent/15'), 'its refined edge follows the active palette')
  assert.ok(PAGE_ACTION_BUTTON_CLASS.includes('focus-visible:ring-2'), 'keyboard focus strengthens the same edge')
  assert.ok(!/#|rgb|claret|terracotta|indigo|forest/.test(PAGE_ACTION_BUTTON_CLASS), 'no palette is baked into the role')

  const component = read(join(ROOT, 'src', 'components', 'PageActionButton.tsx'))
  assert.match(component, /className=\{PAGE_ACTION_BUTTON_CLASS\}/, 'the shared component sources the complete role')
  assert.match(component, /data-page-action/, 'rendered audits can enumerate the role')
  assert.match(component, /\.\.\.props/, 'popover state and native button semantics pass through')

  const section = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  const uses = (section.match(/<PageActionButton\b/g) ?? []).length
  assert.ok(uses >= 7, `every page/hub creation door shares the component (found ${uses})`)
  assert.ok(!section.includes('PrimaryButton'), 'the former neutral page-button fork is gone')
  for (const label of ['New project', 'New artifact', 'Add context', 'New provider', 'New routine', 'New dispatch', 'New agent', 'New prompt']) {
    assert.match(
      section,
      new RegExp(`<PageActionButton[\\s\\S]{0,260}${label}[\\s\\S]{0,80}</PageActionButton>`),
      `${label} uses the page action`,
    )
  }

  const header = stripComments(resourcePageComponent('ResourcePageHeader'))
  assert.match(header, /min-w-0 grow basis-64 items-start/, 'the identity grows beside the action and wraps before it becomes cramped')
  assert.match(header, /ml-auto flex min-w-0 shrink-0/, 'a wrapped action remains right-aligned')

  const agentHub = stripComments(sectionViewComponent('AgentCommonsSection'))
  assert.match(agentHub, /<PageHeader[\s\S]*New agent[\s\S]*New prompt[\s\S]*<\/PageHeader>/, 'Agent creation actions occupy the shared page header')
  assert.ok(!agentHub.includes('TabToolbar'), 'the Agent hub has no second, in-section page-action position')
  assert.ok(!sectionViewComponent('AgentsTab').includes('PageActionButton'), 'the worker list does not repeat its page action')
  assert.ok(!sectionViewComponent('PromptsTab').includes('PageActionButton'), 'the prompt list does not repeat its page action')
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

/** ── The other half of "the face carries no size" ────────────────────────────
 *  The split above is only half a contract: the face declines to set size, so
 *  the CALL SITE has to. Nothing checked that it did, and the Commons composer's
 *  Post shipped as `className={SOFT_BUTTON_CLASS}` — a fill and a label with no
 *  padding and no type size, which renders as a cramped tint (owner report,
 *  2026-08-08: "the two post buttons … are ugly"). One call site out of ~45,
 *  invisible to every test we had, because each of the others happened to pass
 *  its own. A split contract needs a lock on both halves. */
const FACES = ['SOLID_BUTTON_CLASS', 'DANGER_BUTTON_CLASS', 'SECONDARY_BUTTON_CLASS', 'SOFT_BUTTON_CLASS'] as const
const HAS_PAD = /\bp[xy]?-\[?[\d.]/
// `(?![\w-])` rather than `\b`: an arbitrary size ends in `]`, a non-word char,
// so a trailing `\b` would never match one — which is how the first draft of
// this lock flagged all 45 call sites as unsized.
const HAS_TEXT = /\btext-(\[[\d.]+px\]|xs|sm|base)(?![\w-])/

/** Every class expression that wears a face: a template literal (`px-3 …
 *  ${FACE}`, ternaries included) or the bare `className={FACE}` — the shape
 *  that shipped unsized, so it must be one the extractor sees rather than one
 *  it skips. */
function faceExpressions(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/`[^`]*`/g)) if (FACES.some((f) => m[0].includes(f))) out.push(m[0])
  for (const m of src.matchAll(/className=\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
    if ((FACES as readonly string[]).includes(m[1])) out.push(m[0])
  }
  return out
}

test('every call site sizes the face it wears (the other half of the split)', () => {
  const offenders: string[] = []
  let sized = 0
  for (const file of filesUnder('src')) {
    if (file.endsWith(FUNNEL)) continue
    const rel = file.slice(ROOT.length + 1).split('\\').join('/')
    const src = stripComments(read(file))
    const exprs = faceExpressions(src)
    // Vacuity guard: a call site the extractor cannot SEE is a call site this
    // lock silently exempts, so account for every mention outside the import.
    const mentions = src
      .split('\n')
      .filter((l) => !/^\s*import\b|from '(\.\.\/)+lib\/button'/.test(l))
      .join('\n')
    const total = FACES.reduce((n, f) => n + (mentions.match(new RegExp(`\\b${f}\\b`, 'g')) ?? []).length, 0)
    const seen = FACES.reduce(
      (n, f) => n + exprs.reduce((k, e) => k + (e.match(new RegExp(`\\b${f}\\b`, 'g')) ?? []).length, 0),
      0,
    )
    assert.equal(seen, total, `${rel}: ${total - seen} face mention(s) sit outside any class expression — widen the extractor`)
    for (const e of exprs) {
      sized += 1
      if (HAS_PAD.test(e) && HAS_TEXT.test(e)) continue
      offenders.push(`${rel}: ${e.replace(/\s+/g, ' ').slice(0, 90)}`)
    }
  }
  assert.ok(sized >= 40, `the call sites are really being found (found ${sized})`)
  assert.deepEqual(
    offenders,
    [],
    'a button face was worn without a size — lib/button.ts leaves padding + text to the caller, so pass them (e.g. `px-3 py-1.5 text-[13px]`)',
  )
})

test('the consumers source the face from the module', () => {
  const consumers: Array<[string, string, number]> = [
    // The soft tier carries every below-CTA affirmative (2026-08-03).
    ['src/components/SectionView.tsx', 'SOFT_BUTTON_CLASS', 13],
    ['src/components/SectionView.tsx', 'DANGER_BUTTON_CLASS', 1],
    ['src/components/EscalationPrompt.tsx', 'SOFT_BUTTON_CLASS', 2],
    ['src/components/RelationActionCard.tsx', 'SOFT_BUTTON_CLASS', 1],
    ['src/components/ToolActivityCard.tsx', 'DANGER_BUTTON_CLASS', 1],
    ['src/components/RowMenu.tsx', 'DANGER_BUTTON_CLASS', 1],
    ['src/components/Composer.tsx', 'DANGER_BUTTON_CLASS', 2],
    ['src/components/panels/ArtifactPanel.tsx', 'DANGER_BUTTON_CLASS', 1],
    // PageActionButton is a complete soft role; neutral form alternatives use
    // SECONDARY. Exactly ONE true solid survives: the auth
    // Sign in — the single act on a screen that has no other.
    //
    // The rail's New session left this list on 2026-08-10 (owner directive:
    // "we don't need such a showy color for new session — spare the color for
    // more important scenarios"). It is a quiet rail row now, findable by
    // POSITION rather than fill; the scan below fails if a solid reappears in
    // the rail, which is the half of this decision worth locking.
    ['src/components/SectionView.tsx', 'SECONDARY_BUTTON_CLASS', 1],
    ['src/lib/authFlow.ts', 'SOLID_BUTTON_CLASS', 1],
  ]
  // The rail carries NO solid: navigation chrome may not wear the loudest ink
  // in the system (owner directive 2026-08-10). Asserted as an absence, since
  // the consumer table above can only count what is present.
  assert.ok(
    !read(join(ROOT, 'src', 'components', 'Sidebar.tsx')).includes('SOLID_BUTTON_CLASS'),
    'the left rail wears no CTA-tier solid — New session is a quiet row, found by position',
  )
  for (const [rel, symbol, least] of consumers) {
    const src = read(join(ROOT, ...rel.split('/')))
    assert.match(src, /from '((\.\.\/)+lib\/button|\.\/button(\.ts)?)'/, `${rel} imports the shared face`)
    // Bare-identifier count (a ternary arm wears the symbol without `${}`),
    // minus the import line's own mention.
    const uses = (src.match(new RegExp(`\\b${symbol}\\b`, 'g')) ?? []).length - 1
    assert.ok(uses >= least, `${rel} wears ${symbol} at ${least}+ buttons (found ${uses})`)
  }
})
