/** UI-20 — text on a solid fill is legible on that fill, in every registered
 *  recipe, sampled customization extremes, and both modes.
 *
 *  Earned by a real escape (2026-08-07). `--color-accent` did two jobs: read as
 *  TEXT on the canvas, and used as a FILL under `--color-on-solid`. Light mode
 *  got away with it; dark mode cannot, because the accent is LIGHTENED there so
 *  it can be read on a dark ground — which makes it far too light to carry white
 *  text. The shipped dark CTA measured 3.68:1 on Claret and 2.20:1 on Forest,
 *  1.74:1 on Forest hover, against a 4.5:1 requirement. The palette axis had
 *  multiplied a pairing nobody
 *  could check by eye, and `--color-on-solid`'s own comment asserted the broken
 *  premise: "white in both themes (the fills stay vivid)".
 *
 *  The fix is a separate SEAT: `*-solid` tokens whose only job is carrying
 *  `on-solid`. This file is the oracle for both halves —
 *    1. the VALUES: every `*-solid` clears 4.5:1 against `on-solid`, resolved
 *       exactly as the browser resolves them, for all recipes x both modes;
 *    2. the CALL SITES: every `text-on-solid` in src/ sits on a solid seat, so a
 *       new surface cannot re-pair white with a text-tuned fill.
 *  A new palette therefore cannot ship an illegible fill, and a new component
 *  cannot opt out of the seat. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, filesUnder, stripComments } from '../../tests/helpers/source.ts'
import { PALETTES, PALETTE_TOKENS, THEME_AXIS_GROUPS, deriveThemeTokens, type ThemeRecipe } from './theme.ts'
import { SOLID_BUTTON_CLASS, DANGER_BUTTON_CLASS } from './button.ts'
import { CHECKBOX_BOX_ON_CLASS } from './checkbox.ts'
import { searchResultSubtitleClass } from './searchResults.ts'

const CSS = read(join(ROOT, 'src', 'index.css'))

/* ── WCAG 2.1 relative luminance + contrast ratio ─────────────────────────── */

function channels(hex: string): number[] {
  const s = hex.replace('#', '')
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
}
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Sanity-check the maths against the two values WCAG itself pins, so a broken
 *  ratio function can't quietly pass every colour in the palette. */
test('the contrast oracle computes WCAG ratios correctly', () => {
  assert.equal(Math.round(contrast('#ffffff', '#000000')), 21)
  assert.equal(Math.round(contrast('#ffffff', '#ffffff')), 1)
  // A known reference pair: #767676 is the classic "smallest grey that passes
  // 4.5:1 on white" boundary value.
  assert.ok(contrast('#ffffff', '#767676') >= 4.5)
  assert.ok(contrast('#ffffff', '#777777') < 4.5)
})

/* ── Resolve the token matrix exactly as the cascade does ─────────────────── */

function declarations(selectorSource: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of selectorSource.split('\n')) {
    const m = line.match(/^\s*(--color-[a-z0-9-]+)\s*:\s*([^;]+);/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}
function blockOf(pattern: RegExp, label: string): Record<string, string> {
  const m = CSS.match(pattern)
  assert.ok(m, `src/index.css is missing the ${label} block`)
  return declarations(m![1])
}

const BASE = blockOf(/@theme\s*\{([\s\S]*?)\n\}/, '@theme (light fallback)')
const DARK = blockOf(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/, 'dark')

/** Runtime resolution: invariant semantic values come from CSS; the recipe's
 * exact PALETTE_TOKENS overlay comes from the one derivation function. */
function resolve(palette: string, mode: string): Record<string, string> {
  const preset = PALETTES.find((candidate) => candidate.id === palette)
  assert.ok(preset, `known palette ${palette}`)
  return deref({
    ...BASE,
    ...(mode === 'dark' ? DARK : {}),
    ...deriveThemeTokens(preset.recipe, mode as 'light' | 'dark'),
  })
}

/** Follow `var(--other-token)` references to the colour they land on, exactly as
 *  the browser does. A token may legitimately be WRITTEN as a reference rather
 *  than a hex: the flush rail declares `--color-sidebar: var(--color-canvas)`,
 *  so "the rail is the canvas" is one decision stated once instead of the same
 *  hex copied into eight blocks, where the two could drift apart. Every check
 *  below still measures a real colour, because the reference is resolved here
 *  first — chains are followed (bounded, so a cycle cannot hang the suite). */
function deref(t: Record<string, string>): Record<string, string> {
  const out = { ...t }
  for (const key of Object.keys(out)) {
    let value = out[key]
    for (let hop = 0; hop < 8; hop += 1) {
      const ref = value.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/)?.[1]
      if (!ref || out[ref] === undefined) break
      value = out[ref]
    }
    out[key] = value
  }
  return out
}

const MODES = ['light', 'dark'] as const
const COMBOS = PALETTES.flatMap(({ id }) => MODES.map((m) => [id, m] as const))

test('focus highlights pair muted descendants with the co-tint foreground seat', () => {
  const source = read(join(ROOT, 'src', 'lib', 'focusContext.ts'))
  const classes = source.match(/FOCUS_FLASH_CLASS = '([^']+)'/)?.[1]
  assert.ok(classes?.includes('bg-co-tint'), 'the shared highlight owns its actual background')
  assert.ok(classes.includes('[&_.text-ink-faint]:text-co-strong'), 'muted labels and controls need a readable highlight foreground')
})

test('every palette x mode resolves a complete token set', () => {
  assert.equal(COMBOS.length, PALETTES.length * 2)
  for (const [palette, mode] of COMBOS) {
    const t = resolve(palette, mode)
    for (const token of PALETTE_TOKENS) {
      assert.ok(t[token], `${palette}/${mode} resolves ${token}`)
      assert.match(t[token], /^#[0-9a-f]{3,8}$/i, `${palette}/${mode} ${token} is a hex literal`)
    }
  }
})

/* ── 1. The values ────────────────────────────────────────────────────────── */

/** Every solid seat declared anywhere in the stylesheet, derived from the CSS
 *  itself — so a NEW `*-solid` token is covered the moment it is declared,
 *  rather than when someone remembers to extend a hand-written list. */
const SOLID_TOKENS = [...new Set([...CSS.matchAll(/(--color-[a-z0-9-]*-solid(?:-strong)?)\s*:/g)].map((m) => m[1]))]
  .filter((t) => t !== '--color-on-solid')
  .sort()

test('the solid seats are the ones the design names', () => {
  // A floor with teeth: if the derivation breaks, the value scan below would
  // iterate an empty list and pass having checked nothing.
  assert.ok(SOLID_TOKENS.length >= 8, `expected the full solid family, found ${SOLID_TOKENS.length}`)
  for (const expected of [
    '--color-accent-solid',
    '--color-accent-solid-strong',
    '--color-co-solid',
    '--color-danger-solid',
    '--color-danger-solid-strong',
    '--color-neutral-solid',
    '--color-ok-solid',
    '--color-warn-solid',
  ]) {
    assert.ok(SOLID_TOKENS.includes(expected), `${expected} is declared`)
  }
})

test('UI-20: every solid fill carries on-solid text at AA in every palette and mode', () => {
  const failures: string[] = []
  let checked = 0
  for (const [palette, mode] of COMBOS) {
    const t = resolve(palette, mode)
    const onSolid = t['--color-on-solid']
    assert.ok(onSolid, `${palette}/${mode} resolves --color-on-solid`)
    for (const token of SOLID_TOKENS) {
      const fill = t[token]
      assert.ok(fill, `${palette}/${mode} resolves ${token}`)
      const ratio = contrast(onSolid, fill)
      checked++
      if (ratio < 4.5) failures.push(`${palette}/${mode} ${token} ${fill} vs ${onSolid} = ${ratio.toFixed(2)}:1`)
    }
  }
  assert.equal(checked, COMBOS.length * SOLID_TOKENS.length, `checked the full registered matrix`)
  assert.deepEqual(failures, [], `solid fills below WCAG AA 4.5:1:\n  ${failures.join('\n  ')}`)
})

/** The regression that earned the invariant, pinned by name: `--color-accent`
 *  is NOT a solid seat, and must not quietly become one again by being darkened
 *  until it passes. Its job is to be READ on the canvas — locked from the other
 *  side so a future "fix" can't collapse the two seats back together. */
test('UI-20: the text seat stays legible ON the canvas, in both modes', () => {
  for (const [palette, mode] of COMBOS) {
    const t = resolve(palette, mode)
    for (const token of ['--color-accent', '--color-co']) {
      const ratio = contrast(t[token], t['--color-canvas'])
      assert.ok(ratio >= 3, `${palette}/${mode} ${token} reads on the canvas (${ratio.toFixed(2)}:1)`)
    }
  }
})

test('muted ink remains readable on every neutral surface in every palette and mode', () => {
  const failures: string[] = []
  let checked = 0
  for (const [palette, mode] of COMBOS) {
    const t = resolve(palette, mode)
    for (const foreground of ['--color-ink-soft', '--color-ink-faint']) {
      for (const background of ['--color-canvas', '--color-surface', '--color-panel', '--color-panel-2']) {
        const measured = contrast(t[foreground], t[background])
        checked++
        if (measured < 4.5) failures.push(`${palette}/${mode} ${foreground} on ${background} = ${measured.toFixed(2)}:1`)
      }
    }
  }
  assert.equal(checked, COMBOS.length * 2 * 4, 'checked the full neutral text-seat matrix')
  assert.deepEqual(failures, [], `muted ink below WCAG AA 4.5:1:\n  ${failures.join('\n  ')}`)
})

test('semantic and capability text clears AA on its paired tint', () => {
  const pairs = [
    ['--color-added', '--color-added-bg'],
    ['--color-removed', '--color-removed-bg'],
    ['--color-cap-workspace', '--color-cap-workspace-tint'],
    ['--color-cap-repo', '--color-cap-repo-tint'],
    ['--color-cap-connector', '--color-cap-connector-tint'],
    ['--color-cap-mcp', '--color-cap-mcp-tint'],
    ['--color-cap-file', '--color-cap-file-tint'],
    ['--color-cap-photo', '--color-cap-photo-tint'],
    ['--color-ok-text', '--color-ok-tint'],
    ['--color-warn-text', '--color-warn-tint'],
    ['--color-danger-text', '--color-danger-tint'],
  ] as const
  const failures: string[] = []
  for (const mode of MODES) {
    const t = deref({ ...BASE, ...(mode === 'dark' ? DARK : {}) })
    for (const [foreground, background] of pairs) {
      const measured = contrast(t[foreground], t[background])
      if (measured < 4.5) failures.push(`${mode} ${foreground} on ${background} = ${measured.toFixed(2)}:1`)
    }
  }
  assert.deepEqual(failures, [], `semantic text below WCAG AA 4.5:1:\n  ${failures.join('\n  ')}`)
})

/** Customization widens the state space beyond named presets. Exhaustive hue
 * combinations are continuous, so the lock samples every numeric boundary and
 * every choice, plus the named recipes; derivation itself chooses lightness by
 * contrast and is therefore hue-independent. */
test('UI-20: sampled customization extremes preserve the contrast contract', () => {
  const seed: ThemeRecipe = { ...PALETTES[0].recipe }
  const recipes: { label: string; recipe: ThemeRecipe }[] = PALETTES.map((palette) => ({ label: palette.id, recipe: palette.recipe }))
  for (const axis of THEME_AXIS_GROUPS.flatMap((group) => group.axes)) {
    if (axis.kind === 'range') {
      recipes.push({ label: `${axis.key}=min`, recipe: { ...seed, [axis.key]: axis.min } })
      recipes.push({ label: `${axis.key}=max`, recipe: { ...seed, [axis.key]: axis.max } })
    } else {
      for (const option of axis.options) {
        recipes.push({ label: `${axis.key}=${option.value}`, recipe: { ...seed, [axis.key]: option.value } as ThemeRecipe })
      }
    }
  }

  const failures: string[] = []
  for (const { label, recipe } of recipes) {
    for (const mode of MODES) {
      const t = deref({ ...BASE, ...(mode === 'dark' ? DARK : {}), ...deriveThemeTokens(recipe, mode) })
      const pairs = [
        [`--color-${searchResultSubtitleClass(true).replace('text-', '')}`, '--color-accent-tint', 4.5],
        [`--color-${searchResultSubtitleClass(false).replace('text-', '')}`, '--color-surface', 4.5],
        ['--color-ink', '--color-canvas', 4.5],
        ['--color-ink-soft', '--color-canvas', 4.5],
        ['--color-ink-soft', '--color-panel-2', 4.5],
        ['--color-ink-faint', '--color-canvas', 4.5],
        ['--color-ink-faint', '--color-panel-2', 4.5],
        ['--color-accent', '--color-canvas', 3],
        ['--color-co', '--color-canvas', 3],
        ['--color-accent-strong', '--color-accent-tint', 4.5],
        ['--color-co-strong', '--color-co-tint', 4.5],
        ['--color-accent-solid', '--color-on-solid', 4.5],
        ['--color-accent-solid-strong', '--color-on-solid', 4.5],
        ['--color-co-solid', '--color-on-solid', 4.5],
      ] as const
      for (const [foreground, background, minimum] of pairs) {
        const measured = contrast(t[foreground], t[background])
        if (measured < minimum) failures.push(`${label}/${mode} ${foreground} on ${background} = ${measured.toFixed(2)}:1`)
      }
    }
  }
  assert.deepEqual(failures, [], `custom theme pairs below their contrast floor:\n  ${failures.join('\n  ')}`)
})

/* ── 2. The call sites ────────────────────────────────────────────────────── */

/** Elements whose backdrop is IMAGERY, not a theme token — a photo thumbnail's
 *  scrim, generated cover art. White is correct there and no `*-solid` fill
 *  exists to pair with. Scoped to the file + the literal so the exemption can't
 *  silently widen, and alive-checked below so a stale entry can't blanket-clear
 *  a file that has meanwhile grown a real violation. */
const IMAGE_BACKDROP_EXEMPTIONS = [
  {
    file: join('src', 'components', 'ServedFileIntake.tsx'),
    literal: 'text-on-solid',
    why: 'the added-photo check, centred on a bg-black/35 scrim over the thumbnail',
  },
  {
    file: join('src', 'components', 'artifactPreview.tsx'),
    literal: 'text-center font-serif font-semibold text-on-solid drop-shadow-sm',
    why: 'a generated cover-art title, drop-shadowed onto the artwork itself',
  },
]

/** Every quoted string literal in `src` that mentions `text-on-solid`. */
function onSolidLiterals(): { file: string; rel: string; literal: string }[] {
  const found: { file: string; rel: string; literal: string }[] = []
  for (const file of filesUnder('src')) {
    const src = stripComments(read(file))
    for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)) {
      if (m[2].includes('text-on-solid')) found.push({ file, rel: file.slice(ROOT.length + 1), literal: m[2] })
    }
  }
  return found
}

test('UI-20: every text-on-solid element sits on a solid seat', () => {
  const literals = onSolidLiterals()
  assert.ok(literals.length >= 12, `expected the on-solid call sites, found ${literals.length}`)

  const offenders: string[] = []
  for (const { rel, literal } of literals) {
    // Paired with a solid seat in the same class list — the correct shape.
    if (/\bbg-[a-z-]*-solid\b/.test(literal)) continue
    // A literal black scrim over imagery (bg-black/NN) is the image case.
    if (/\bbg-black\//.test(literal)) continue
    // Declared image-backdrop exemptions.
    if (IMAGE_BACKDROP_EXEMPTIONS.some((e) => rel === e.file && literal.includes(e.literal))) continue
    offenders.push(`${rel}: "${literal.trim().slice(0, 110)}"`)
  }
  assert.deepEqual(
    offenders,
    [],
    'text-on-solid must pair with a bg-*-solid fill (the *-solid seat is what holds 4.5:1 against it):\n  ' +
      offenders.join('\n  '),
  )
})

test('the image-backdrop exemptions are alive', () => {
  for (const e of IMAGE_BACKDROP_EXEMPTIONS) {
    const src = read(join(ROOT, e.file))
    assert.ok(src.includes(e.literal), `stale exemption — ${e.file} no longer contains "${e.literal}" (${e.why})`)
  }
})

/** The seat cannot be reached by re-pairing white with a TEXT-tuned fill: the
 *  dead spellings are banned tree-wide, the way src/lib/button.test.ts bans the
 *  old solid languages. */
test('UI-20: the text-tuned fills are never paired with on-solid again', () => {
  const offenders: string[] = []
  for (const { rel, literal } of onSolidLiterals()) {
    for (const dead of ['bg-accent', 'bg-co', 'bg-danger', 'bg-ok-strong', 'bg-warn-strong', 'bg-ink-faint']) {
      // Word-boundaried so `bg-accent-solid` doesn't read as `bg-accent`.
      if (new RegExp(`\\b(?:group-)?(?:hover:)?${dead}(?![\\w-])`).test(literal)) {
        offenders.push(`${rel}: ${dead} under text-on-solid`)
      }
    }
  }
  assert.deepEqual(offenders, [], `text-tuned fills paired with on-solid:\n  ${offenders.join('\n  ')}`)
})

/* ── The funnels themselves ───────────────────────────────────────────────── */

test('the shared solid cues source the solid seat', () => {
  assert.ok(SOLID_BUTTON_CLASS.includes('bg-accent-solid'), 'the CTA fills on the accent solid seat')
  assert.ok(SOLID_BUTTON_CLASS.includes('hover:bg-accent-solid-strong'), 'and ramps within it')
  assert.ok(DANGER_BUTTON_CLASS.includes('bg-danger-solid'), 'the danger confirm fills on the danger solid seat')
  assert.ok(DANGER_BUTTON_CLASS.includes('hover:bg-danger-solid-strong'), 'and ramps within it')
  // Checked is a PLACE cue (the seat law), so it wears co — on co's solid seat.
  assert.ok(CHECKBOX_BOX_ON_CLASS.includes('bg-co-solid'), 'the checked box fills on the co solid seat')
  assert.ok(!/\bbg-co(?![\w-])/.test(CHECKBOX_BOX_ON_CLASS), 'and not on the text-tuned co')
})
