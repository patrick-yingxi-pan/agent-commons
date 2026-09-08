/** The type scale is CLOSED (src/lib/typeScale.ts, owner directive 2026-08-13:
 *  *"reduce the number of font sizes, types and styles"*).
 *
 *  The table in `typeScale.ts` is a document; these are what make it a rule. The
 *  tree carried fourteen font sizes, five of them inside a four-pixel band, and
 *  two spellings for one size — none of it decided, all of it the sum of local
 *  call-site choices. A scale that is only written down grows a half-step the
 *  next time something looks 1px off, so the lock scans the SHIPPED source and
 *  fails on any size, weight or leading utility outside the declared set.
 *
 *  Deliberately a MEMBERSHIP scan, not an import scan: call sites keep writing
 *  `text-[13px]`. Routing ~850 of them through named tokens would be a diff with
 *  no visual result; what is worth enforcing is that the set is finite. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relative } from 'node:path'
import { ROOT, read, filesUnder } from '../../tests/helpers/source.ts'
import {
  TYPE_SIZE,
  TYPE_SIZE_RELATIVE,
  TYPE_WEIGHT,
  TYPE_LEADING,
  TYPE_FAMILY,
  TYPE_SCALE_EXEMPT_FILES,
} from './typeScale.ts'

/** Tailwind's named steps, in px — so "one spelling per size" can be checked
 *  across the two spellings (`text-xs` IS `text-[12px]`). */
const NAMED_PX: Record<string, number> = {
  'text-xs': 12,
  'text-sm': 14,
  'text-base': 16,
  'text-lg': 18,
  'text-xl': 20,
  'text-2xl': 24,
  'text-3xl': 30,
  'text-4xl': 36,
}

/** Every font-size utility spelling: the two absolute forms AND the relative
 *  one. `em`/`rem` are in the grammar because leaving them out would have left
 *  the hole the scale was closed to stop — `text-[0.85em]` was live in
 *  `lib/rich.tsx` and the first cut of this scan walked straight past it, which
 *  is a lock that reads as "seven sizes" over a tree with eight. Sizes only:
 *  `text-ink`, `text-left` and friends are not in this grammar.
 *
 *  **The trailing `\b` belongs to the NAMED branch only**, and that is the whole
 *  lesson of this file's first draft. `/text-\[13px\]\b/` matches nothing ever:
 *  `\b` needs a word/non-word boundary, and a `]` followed by a space or a quote
 *  is non-word on both sides. So the bracket branch — which is every size the UI
 *  actually writes — was silently unscannable, and the suite passed on a tree it
 *  had only checked for `text-sm`. It was caught by mutation (a stray `0.9em`
 *  planted in `lib/rich.tsx` produced no failure), which is the only thing that
 *  catches a lock whose regex is the vacuous half. */
const SIZE_RE = /\btext-(?:\[[\d.]+(?:px|em|rem)\]|(?:xs|sm|base|lg|xl|2xl|3xl|4xl)\b)/g
const WEIGHT_RE = /\bfont-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/g
const LEADING_RE = /\bleading-(?:\[[^\]]+\]|(?:none|tight|snug|normal|relaxed|loose|\d+(?:\.\d+)?)\b)/g
const FAMILY_RE = /\bfont-(?:serif|sans|mono)\b/g

const uiFiles = () =>
  filesUnder('src').filter((f) => {
    const rel = relative(ROOT, f).replace(/\\/g, '/').replace(/^src\//, '')
    return !TYPE_SCALE_EXEMPT_FILES.some((x) => x === rel)
  })

/** Comments blanked, LINE COUNT PRESERVED. Comments must go — prose naming a
 *  dead spelling would trip the scan, and `pageHeader.ts` discusses
 *  `text-[24px]` at length precisely because it is forbidden (the hazard
 *  `tests/helpers/source.ts` documents). But the shared `stripComments` deletes
 *  the newlines with them, and this scan's whole output is `file:line` — its
 *  first draft reported a real stray thirty-six lines above where it lives,
 *  which is a lock that costs more to act on than to ignore. */
const blankComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length))

/** `{token: ['file:line', …]}` for every match of `re` across the UI source. */
function scan(re: RegExp): Map<string, string[]> {
  const hits = new Map<string, string[]>()
  for (const file of uiFiles()) {
    const rel = relative(ROOT, file).replace(/\\/g, '/')
    blankComments(read(file))
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(re)) {
          // The code measure: a monospace block is set to a line grid, not to
          // the UI's named leadings (typeScale.ts states the exemption).
          if (m[0].startsWith('leading-[') && /\bfont-mono\b/.test(line)) continue
          const at = `${rel}:${i + 1}`
          hits.set(m[0], [...(hits.get(m[0]) ?? []), at])
        }
      })
  }
  return hits
}

test('every font size in the UI is one of the declared steps', () => {
  const allowed = new Set<string>([...Object.values(TYPE_SIZE), ...Object.values(TYPE_SIZE_RELATIVE)])
  const found = scan(SIZE_RE)
  assert.ok(found.size > 0, 'the scan found font sizes at all (a vacuous pass is not a pass)')
  const strays = [...found].filter(([tok]) => !allowed.has(tok))
  assert.deepEqual(
    strays.map(([tok, at]) => `${tok} @ ${at.slice(0, 3).join(', ')}${at.length > 3 ? ` (+${at.length - 3})` : ''}`),
    [],
    `off-scale font sizes — use one of ${[...allowed].join(' ')} or state an exemption in typeScale.ts`,
  )
})

test('every size in the scale has ONE spelling', () => {
  // `text-xs` and `text-[12px]` render identically, so a table holding both
  // would close the set while leaving it searchable two ways — which is the
  // defect (two spellings for one size) rather than a fix for it.
  const px = Object.values(TYPE_SIZE).map((c) => NAMED_PX[c] ?? Number(c.match(/\[([\d.]+)px\]/)![1]))
  assert.equal(new Set(px).size, px.length, `two names for one size: ${px.join(' ')}`)
  assert.ok(px.every(Number.isFinite), 'every declared size resolves to a pixel value')
  // The relative size is a RATIO of its host, not a step — so there is exactly
  // one of it. A second would be a proportion nobody could name against the
  // first, which is the defect the ramp was closed to stop, re-entering by the
  // one door the ramp does not cover.
  assert.equal(Object.keys(TYPE_SIZE_RELATIVE).length, 1, 'exactly one relative size')
})

test('every font weight in the UI is one of the declared three', () => {
  const allowed = new Set<string>(Object.values(TYPE_WEIGHT))
  const strays = [...scan(WEIGHT_RE)].filter(([tok]) => !allowed.has(tok))
  assert.deepEqual(
    strays.map(([tok, at]) => `${tok} @ ${at.slice(0, 3).join(', ')}`),
    [],
    `off-scale font weights — 700 is indistinguishable from 600 at this ramp's sizes`,
  )
})

test('every leading in the UI is one of the declared four', () => {
  const allowed = new Set<string>(Object.values(TYPE_LEADING))
  const strays = [...scan(LEADING_RE)].filter(([tok]) => !allowed.has(tok))
  assert.deepEqual(
    strays.map(([tok, at]) => `${tok} @ ${at.slice(0, 3).join(', ')}`),
    [],
    'off-scale leadings — a numeric spelling duplicates a named step at the size it is paired with',
  )
})

test('every font family in the UI is one of the declared three', () => {
  const allowed = new Set<string>(Object.values(TYPE_FAMILY))
  const strays = [...scan(FAMILY_RE)].filter(([tok]) => !allowed.has(tok))
  assert.deepEqual(strays.map(([tok, at]) => `${tok} @ ${at[0]}`), [], 'off-scale font family')
})

test('the exemption is a FILE that exists, so it cannot quietly widen', () => {
  assert.deepEqual(TYPE_SCALE_EXEMPT_FILES, [
    'components/artifactPreview.tsx', 'components/StructuredArtifactView.tsx',
  ], 'only the existing artifact miniature renderer and its extracted structured portion are exempt')
  for (const rel of TYPE_SCALE_EXEMPT_FILES) {
    // Alive-checked: a stale exemption is a hole in the scan that reads as a
    // rule. If the file moves, this fails rather than silently exempting nothing
    // — and rather than silently exempting a path someone later creates.
    assert.doesNotThrow(() => read(`${ROOT}/src/${rel}`), `exempt file ${rel} still exists`)
    assert.match(
      read(`${ROOT}/src/lib/typeScale.ts`),
      new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${rel}'s exemption is argued in typeScale.ts, not just listed`,
    )
  }
})
