/** Lock: detail-page sections (S17, `docs/design/surface-audit.md`) — a bare
 *  uppercase heading with the LIST carded below, never a boxed rail-panel.
 *
 *  This suite used to guard that rule as *"`<MainSection>`, never `<SidePanel>`"*,
 *  which was the shape of the problem when the project page rendered
 *  Contributors and Coordination as boxed panels beside a bare "Recent sessions"
 *  heading — same role, two looks. The two primitives have since become ONE
 *  (`<FoldSection>`, owner directive 2026-08-12: the entity page is one column of
 *  foldable sections, *"one solution for many similar problems with adapted UI
 *  styles"*), so the old assertions could no longer be written: there is no
 *  second primitive left to forbid.
 *
 *  The RULE did not change, so the lock moved with it rather than being deleted —
 *  and the merge lets it say more than it could before. "Bare heading, never a
 *  box" used to be a claim about which of two components you picked; it is now a
 *  claim about the only one there is, plus two new ones the single primitive
 *  makes checkable: that the fold DEFAULTS still encode the owner's split
 *  (configuration folded, content open), and that nothing folds to a gap. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'

const src = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))

/** One component's source, COMMENT-STRIPPED, through the SHARED extractor.
 *
 *  Both halves were mistakes here before they were rules. This suite hand-rolled
 *  its own extractor while `tests/helpers/source.ts` already held the one
 *  `social-ui.test.ts` uses — two parsers for one file, which is the drift these
 *  locks exist to prevent, one level up. And it read RAW source: an extracted
 *  body runs to the next top-level declaration, so it carries that declaration's
 *  doc comment, and "FoldSection draws no card chrome" failed on the words
 *  "rounded-xl + shadow" inside `CardList`'s comment — prose describing chrome
 *  that had been removed a year earlier. A source scan that reads comments is
 *  asserting about comments. */
const fn = (name: string): string => stripComments(sectionViewComponent(name))

/** Every `<FoldSection …>` opening tag's prop text.
 *
 *  Scanned with a brace counter rather than a regex to the first `>`, because
 *  the first `>` is routinely INSIDE a prop — `actions={<SectionAction … />}` —
 *  and a lazy match would cut every verb-bearing section's props in half,
 *  silently exempting exactly the sections these tests are about. (The example
 *  used to be `icon={<Globe size={14} />}`, which is gone; the hazard is not.) */
function foldSectionTags(): string[] {
  const out: string[] = []
  for (let i = src.indexOf('<FoldSection'); i >= 0; i = src.indexOf('<FoldSection', i + 1)) {
    let depth = 0
    for (let j = i; j < src.length; j++) {
      const c = src[j]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) {
        out.push(src.slice(i, j))
        break
      }
    }
  }
  return out
}

const titleOf = (tag: string): string => tag.match(/title="([^"]+)"/)?.[1] ?? '(dynamic)'

/** A tag's OWN props — every nested brace group emptied.
 *
 *  Because a prop can render another ELEMENT, and that element has props of its
 *  own with the same names. `actions={<SectionAction icon={<Plus …/>} …/>}` is
 *  a section with no icon that contains the string `icon=`, and the first cut
 *  of the no-icons lock reported all ten verb-bearing sections as offenders —
 *  a red bar against a correct page, which is the same brace-depth mistake the
 *  extractor above exists to avoid, made one level in. */
const ownProps = (tag: string): string => {
  let out = '', depth = 0
  for (const c of tag) {
    if (c === '{') { if (depth === 0) out += '{'; depth++ } else if (c === '}') { depth--; if (depth === 0) out += '}' } else if (depth === 0) out += c
  }
  return out
}

test('S17 — sections are bare headings with carded lists, and there is ONE primitive', () => {
  // The merged component draws no box of its own: the LIST cards, not the
  // section. This is the assertion that outlived the MainSection/SidePanel
  // split, restated against the survivor.
  const section = fn('FoldSection')
  // No BOX — and since 2026-08-12 no box anywhere under it either: the lists
  // lost their frames and the section draws one horizontal rule instead. So the
  // assertion is now about the shape, not about who owns it. It also had to stop
  // matching only `className="…"`: the header's class is a template literal, so
  // the old spelling would have passed a hand-written border there by accident
  // of quoting style rather than by being right.
  // `rounded-md` is deliberately allowed: it is the radius of a hover WASH (the
  // header button's, the folded summary row's), which is a control cue and not
  // chrome — `FOLD_HEADER_CLASS` carries one itself. Card chrome starts one step
  // up, and that is the line this draws.
  assert.doesNotMatch(section, /rounded-(lg|xl|2xl|3xl)|shadow/, 'FoldSection draws no card chrome')
  assert.doesNotMatch(section, /\bborder(?!-b\b)[- ]/, 'and no frame — only the bottom rule')
  assert.match(section, /LEDGER_RULE_CLASS/, 'the boundary comes from the one home, not a hand-written border')
  // The two names it replaced cannot come back. An absence, because the failure
  // mode is additive: someone re-introduces a second section component and the
  // page has two looks again, which is the original defect verbatim.
  for (const gone of ['function MainSection', 'function SidePanel']) {
    assert.ok(!src.includes(gone), `${gone} was merged into FoldSection — one section primitive, not two`)
  }
  // …and the lists still card through the one list container.
  for (const name of ['ContributorsPanel', 'CoordinationPanel', 'OpenWorkList']) {
    assert.ok(fn(name).includes('<CardList'), `${name} rows are carded via CardList`)
  }
})

test('a section title is a chevron and a word — no icon slot to be inconsistent about', () => {
  // Owner directive 2026-08-13: *"remove icons from section titles, unifying
  // the style"*. Stated as the ABSENCE OF THE PROP rather than as "no section
  // passes an icon", because those are different strengths and only one of them
  // holds. Twelve of the thirty-odd sections wore a glyph along no rule anyone
  // could state, and a surviving optional prop is a standing invitation to
  // start again — the next section to want a little emphasis would take it, and
  // nothing would fail.
  const section = fn('FoldSection')
  assert.ok(!/\bicon\?:/.test(section), 'FoldSection declares no icon prop')
  assert.ok(!/\{icon\}/.test(section), 'and renders no icon slot')
  const withIcon = foldSectionTags().filter((t) => /\bicon=/.test(ownProps(t))).map(titleOf)
  assert.deepEqual(withIcon, [], `these still pass an icon to a section title: ${withIcon.join(', ')}`)
  // The title carries the boundary now (the box came off on 2026-08-12 and the
  // glyph on 2026-08-13), so it is not caption-sized any more. Asserted as the
  // exact step because "bigger than it was" is not a thing a later reader can
  // check, and 11px is the value it must not slide back to.
  assert.match(section, /text-\[12px\] font-semibold uppercase tracking-wide/, 'the label is the 12px small-caps')
})

test('a section verb is a SectionAction — one look for every per-section button', () => {
  // Owner directive 2026-08-13: *"make all per-section buttons of the same
  // style that show upon hover … normally hidden, contributing to a visually
  // cleaner page"*. The cluster and its cue are locked in
  // `src/lib/sectionAction.test.ts`; what THIS asserts is that nothing gets
  // into a header cluster without going through it.
  //
  // A raw `<button` inside `actions=` is the whole failure mode, and it is what
  // both of the controls this directive moved used to be: the page header's
  // solid "New session", and the Discussion thread's floating Fold all ·
  // Unfold all text pair. Neither was a bad button; each was a second answer to
  // "how does a section offer a verb", which is what makes a page look busy
  // while every individual control looks fine.
  // `(^|[\s{])actions=` and not `\bactions=`: the latter matches inside
  // `revealActions=`, which every one of these sections also carries.
  const verbTags = foldSectionTags().filter((t) => /(^|[\s{])actions=/.test(t))
  const offenders = verbTags.filter((t) => /<button\b/.test(t.slice(t.search(/(^|[\s{])actions=/)))).map(titleOf)
  assert.deepEqual(offenders, [], `these hand-roll a header verb instead of using <SectionAction>: ${offenders.join(', ')}`)
  // Vacuity guard: the scan means nothing if no section has verbs at all.
  const withVerbs = verbTags.length
  assert.ok(withVerbs >= 8, `the scan found the verb-bearing sections (got ${withVerbs})`)
  // …and the page header no longer competes with them. `PrimaryButton` is the
  // solid, always-visible face — right for a page's own act, and the thing
  // "New session" stopped being when it became a row in one list.
  const detail = fn('ProjectDetail')
  assert.ok(!detail.includes('<PrimaryButton'), 'the project page header carries no solid button of its own')
  assert.ok(
    /title="Recent sessions"[\s\S]{0,600}label="New session"/.test(detail),
    'New session is the Recent sessions section’s verb',
  )
})

test('S17 — owner configuration is its OWN section, never folded into the Contributors payload', () => {
  // The rule survives the rail's removal: what changed is where the Sharing
  // section sits (the tail of one column, not a right rail), not that sharing
  // configuration is a section of its own. Stated without the word "rail" so it
  // stops being a claim about a layout that no longer exists.
  const contributors = fn('ContributorsPanel')
  assert.ok(!contributors.includes('ShareToggle'), 'ShareToggle is not in the Contributors payload')
  assert.ok(!contributors.includes('DefaultRolePicker'), 'DefaultRolePicker is not in the Contributors payload')
  assert.ok(
    /<FoldSection\s+title="Sharing"[\s\S]{0,600}<ShareToggle[\s\S]{0,600}<DefaultRolePicker/.test(src),
    'a Sharing section carries both controls',
  )
})

test('the fold DEFAULTS are the owner’s split: configuration folded, content open', () => {
  // Owner decision, 2026-08-12. The failure this guards is drift by accident —
  // a new configuration section that forgets `defaultFolded` puts a form back in
  // the reading flow, and a content section that gains it hides the thing the
  // page is for. Neither breaks anything, so nothing else would notice.
  const tags = foldSectionTags()
  assert.ok(tags.length >= 10, `the scan found the sections (got ${tags.length})`)
  // Deduped by title, because a section KIND can legitimately render on more
  // than one page — a routine has a Sharing section as well as a project — and
  // the test above is what holds those to one answer. The claim here is about
  // which kinds of section are configuration, not how many pages show them.
  const folded = [...new Set(tags.filter((t) => /\bdefaultFolded\b/.test(t)).map(titleOf))].sort()
  assert.deepEqual(
    folded,
    ['Context', 'Delegation', 'Instructions', 'Scheduled', 'Sharing'],
    'exactly the five configuration sections open folded',
  )
  // The complement, named rather than implied: these are what a project page is
  // FOR, and a page that opens with them folded is a page of chevrons.
  const open = tags.map(titleOf)
  for (const content of ['About', 'Recent sessions', 'Changes', 'Discussion', 'Contributors', 'Coordination']) {
    assert.ok(open.includes(content), `${content} is a section on these pages`)
    assert.ok(!folded.includes(content), `${content} is content — it opens OPEN`)
  }
})

test('a PAGE with nothing on it is not a section row — the two empty states stay apart', () => {
  // Both lost the dashed frame (owner directive 2026-08-12 — it was the noisier
  // of the two shapes this pass removed, at 39 call sites against the lists' 17).
  // What they did not lose is the difference between them: a section's empty
  // state stands in for a ROW and sits where that row would be, while a page's
  // stands in for the PAGE and has to occupy it. Collapsing both to a left-
  // aligned line — which the first cut of this change did — puts a stray
  // sentence under a heading on an otherwise blank screen.
  const view = stripComments(src)
  const lines = view.split('\n')
  const strays: string[] = []
  lines.forEach((line, i) => {
    if (!/<Empty>/.test(line)) return
    // A page-level position: the six lines above open a page rather than a list.
    const above = lines.slice(Math.max(0, i - 6), i).join('\n')
    if (/<\/header>|<PageHeader|<BackButton/.test(above)) strays.push(`line ${i + 1}`)
  })
  assert.deepEqual(strays, [], `these render a section's empty ROW where a page's empty state belongs: ${strays.join(', ')}`)
  // Vacuity guards, both directions: the scan needs real subjects of each kind,
  // or it passes over a file that has stopped using either component.
  assert.ok(/<PageEmpty>/.test(view), 'the page-level form is in use')
  assert.ok(/<Empty>/.test(view), 'and so is the section-level one')
  assert.doesNotMatch(fn('Empty'), /border|rounded-/, 'a section’s empty state draws no frame')
  assert.doesNotMatch(fn('PageEmpty'), /border|rounded-/, 'nor does a page’s')
  assert.match(fn('PageEmpty'), /text-center/, 'but a page’s still occupies the page')
})

test('same-titled sections agree on their default — the key is the title', () => {
  // A constraint the STORAGE design imposes, made explicit rather than left to
  // be discovered. `lib/sectionFold.ts` keys the posture by title on purpose —
  // the preference is about a kind of content, and that is what keeps the key
  // space bounded and `uiPrefs` small. The price is that two sections sharing a
  // title share one entry, so declaring different defaults for them produces a
  // state nobody designed: they differ on a first visit and agree forever after
  // the reader touches either one.
  //
  // Not hypothetical — it shipped for one commit. A routine's page has a
  // Sharing section too, and it was left open while the project's opened folded.
  const byTitle = new Map<string, Set<boolean>>()
  for (const tag of foldSectionTags()) {
    const title = titleOf(tag)
    if (title === '(dynamic)') continue
    const set = byTitle.get(title) ?? new Set<boolean>()
    set.add(/\bdefaultFolded\b/.test(tag))
    byTitle.set(title, set)
  }
  const disagreeing = [...byTitle].filter(([, s]) => s.size > 1).map(([t]) => t)
  assert.deepEqual(disagreeing, [], `these share a stored key but declare different defaults: ${disagreeing.join(', ')}`)
  // Vacuity guard: the check means nothing unless a title really does repeat.
  const repeated = [...byTitle].filter(([, s]) => s.size >= 1)
  const counts = foldSectionTags().map(titleOf)
  assert.ok(
    counts.length > new Set(counts).size,
    `at least one title appears twice, or this test has no subject (${repeated.length} titles over ${counts.length} sections)`,
  )
})

test('nothing folds to a gap — a section that opens folded owes a summary', () => {
  // The thread's stub rule, carried across (SOCIAL-18): a folded post is an
  // INDEX ENTRY — who, when, the opening words, how much is hidden — never a
  // gap, because you cannot navigate a history you cannot recognise. A section
  // that opens folded is in exactly that position on first visit, so "Sharing ·
  // Shared — audiences and default role" is worth folding to and a bare chevron
  // is not. Checked only for `defaultFolded`: a section the READER folded by
  // hand needs no reminder of what they just put away.
  const missing = foldSectionTags()
    .filter((t) => /\bdefaultFolded\b/.test(t) && !/\bsummary=/.test(t))
    .map(titleOf)
  assert.deepEqual(missing, [], `these open folded with nothing to show for it: ${missing.join(', ')}`)
})
