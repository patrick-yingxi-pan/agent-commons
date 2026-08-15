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
import { ROOT, read, resourcePageComponent, sectionViewComponent, stripComments } from '../../tests/helpers/source.ts'
import { SECTION_BODY_CLASS, SECTION_BODY_INSET, SECTION_LIST_UNDOUBLE } from '../lib/foldHeader.ts'

const src = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
/** …and the same source with COMMENTS GONE, for the tag scanner below.
 *
 *  This suite already records the lesson once, about its extractor, and the tag
 *  scanner had it too: a doc comment containing the words `<FoldSection actions>`
 *  parsed as a real section with a dynamic title and no summary. A source scan
 *  that reads comments is asserting about comments. */
const code = stripComments(src)

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
const templateName = {
  FoldSection: 'ResourcePageSection',
  SectionActions: 'ResourcePageActions',
  PageEmpty: 'ResourcePageEmpty',
  CardList: 'ResourcePageList',
} as const
const fn = (name: string): string =>
  stripComments(name in templateName
    ? resourcePageComponent(templateName[name as keyof typeof templateName])
    : sectionViewComponent(name))

/** Every `<FoldSection …>` opening tag's prop text.
 *
 *  Scanned with a brace counter rather than a regex to the first `>`, because
 *  the first `>` is routinely INSIDE a prop — `actions={<SectionAction … />}` —
 *  and a lazy match would cut every verb-bearing section's props in half,
 *  silently exempting exactly the sections these tests are about. (The example
 *  used to be `icon={<Globe size={14} />}`, which is gone; the hazard is not.) */
function foldSectionTags(): string[] {
  const out: string[] = []
  for (let i = code.indexOf('<FoldSection'); i >= 0; i = code.indexOf('<FoldSection', i + 1)) {
    let depth = 0
    for (let j = i; j < code.length; j++) {
      const c = code[j]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) {
        out.push(code.slice(i, j))
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
  // A section's verbs are hover-revealed with NO pinned case (owner directive
  // 2026-08-13: *"there are still section buttons constantly showed, instead of
  // showed upon hover"*). Stated as the absence of the PROP, like the icon
  // above and for the same reason: `revealActions` was an escape hatch with a
  // principled-sounding justification ("an empty section whose only affordance
  // is invisible is a dead end"), and on a fresh project most sections are
  // empty — so the exception was the common case, and a pass meant to quieten
  // the page left four glyphs standing on it.
  //
  // Its `|| composing` half is NOT lost: `SectionAction` stamps `data-open`
  // from `expanded`, and `SECTION_REVEAL` carries
  // `has-[[data-open=true]]:opacity-100`, so an open form holds its own cluster
  // lit. That is asserted where it lives, in `src/lib/hoverReveal.test.ts`.
  const section = fn('FoldSection')
  assert.ok(!/revealActions/.test(section), 'FoldSection has no pin — the cluster is hover-revealed, always')
  assert.ok(!fn('SectionActions').includes('opacity-100'), 'and the cluster appends no pin of its own')
  const pinned = foldSectionTags().filter((t) => /revealActions/.test(ownProps(t))).map(titleOf)
  assert.deepEqual(pinned, [], `these pin their verbs visible: ${pinned.join(', ')}`)
  // `(^|[\s{])actions=` and not `\bactions=`: the latter would also match
  // inside a longer prop name ending in "actions".
  const verbTags = foldSectionTags().filter((t) => /(^|[\s{])actions=/.test(t))
  const offenders = verbTags.filter((t) => /<button\b/.test(t.slice(t.search(/(^|[\s{])actions=/)))).map(titleOf)
  assert.deepEqual(offenders, [], `these hand-roll a header verb instead of using <SectionAction>: ${offenders.join(', ')}`)
  // Vacuity guard: the scan means nothing if no section has verbs at all.
  const withVerbs = verbTags.length
  assert.ok(withVerbs >= 8, `the scan found the verb-bearing sections (got ${withVerbs})`)
  // …and the page header no longer competes with them. `PageActionButton` is the
  // standing, always-visible face — right for a page's own act, and the thing
  // "New session" stopped being when it became a row in one list.
  const detail = fn('ProjectDetail')
  assert.ok(!detail.includes('<PageActionButton'), 'the project page header carries no standing action of its own')
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
  // Scanned as "inside the Sharing SECTION", not "within 600 characters of its
  // title" — which is what this was, and which broke the moment the section
  // grew a header verb. A character budget between two markers is a proxy for
  // containment that shrinks every time anyone adds code (or a comment) between
  // them, so it fails against correct pages and says nothing about the rule.
  // Sections do not nest, so the first closing tag after the title is this
  // section's.
  const sharingAt = code.indexOf('title="Sharing"')
  assert.ok(sharingAt > 0, 'there is a Sharing section')
  const sharingBody = code.slice(sharingAt, code.indexOf('</FoldSection>', sharingAt))
  for (const control of ['<ShareToggle', '<GrantsPanel', '<DefaultRolePicker']) {
    assert.ok(sharingBody.includes(control), `the Sharing section carries ${control}`)
  }
})

test('the fold DEFAULTS are the composite-page split: configuration folded, content open', () => {
  // Owner decision, 2026-08-12, generalized across composite resources on
  // 2026-08-14. The failure this guards is drift by accident —
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
    ['Building blocks', 'Context', 'Context & tools', 'Danger zone', 'Delegation', 'Delivers to', 'Instructions', 'Model', 'Routines', 'Schedule', 'Sharing'],
    'exactly the composite pages’ configuration sections open folded',
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
    // Collection ROOTS now use the same FoldSection frame as entity pages. An
    // empty band can therefore sit only a few lines below PageHeader and still
    // be a section-row empty state. Ask containment, not proximity.
    const before = lines.slice(0, i).join('\n')
    const inSection = before.lastIndexOf('<FoldSection') > before.lastIndexOf('</FoldSection>')
    // A page-level position: the six lines above open a page rather than a list.
    const above = lines.slice(Math.max(0, i - 6), i).join('\n')
    if (!inSection && /<\/header>|<PageHeader|<BackButton/.test(above)) strays.push(`line ${i + 1}`)
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

test('nothing folds to a gap — EVERY section owes a summary, and it rides the title row', () => {
  // The thread's stub rule, carried across (SOCIAL-18): a folded post is an
  // INDEX ENTRY — who, when, the opening words, how much is hidden — never a
  // gap, because you cannot navigate a history you cannot recognise.
  //
  // It used to be checked only for `defaultFolded`, on the reasoning that a
  // section the READER folded by hand needs no reminder of what they just put
  // away. That reasoning does not survive the page it produced: press Fold all
  // and five sections showed a line while seven showed a bare chevron, along no
  // rule a reader could infer (owner report, 2026-08-13, on that exact screen).
  // The prop is REQUIRED now, so the compiler holds the roster and this holds
  // the two things a type cannot say.
  const missing = foldSectionTags()
    .filter((t) => !/(^|[\s{])summary=/.test(ownProps(t)))
    .map(titleOf)
  assert.deepEqual(missing, [], `these fold to a bare chevron: ${missing.join(', ')}`)
  assert.ok(foldSectionTags().length >= 15, 'the scan found the sections')

  // (1) The summary is ON the title's row, inside the header button — one row
  //     per folded section (owner directive 2026-08-13: *"the summary should
  //     sit at the same row of section title instead of below it for a more
  //     compacted view"*). Asserted as containment, because "renders a summary"
  //     was true of the old two-row spelling too.
  const section = fn('FoldSection')
  const header = section.slice(section.indexOf('<button'), section.indexOf('</button>'))
  assert.match(header, /\{effectiveFolded && \(/, 'the folded-only branch is inside the header button')
  assert.ok(header.includes('{summary}'), 'and it is the summary that renders there')
  // (2) …and NOTHING renders under the header while folded. The separate stub
  //     button is what made a folded section two rows plus a rule between them,
  //     so a fully folded page — the state the fold is FOR — scrolled.
  assert.match(
    section,
    /\{effectiveFolded \? null : <div className=\{SECTION_BODY_CLASS\}>\{children\}<\/div>\}/,
    'a folded section renders no body at all — and an open one renders it INSET',
  )
})

test('the project has ONE text about itself — the description, and About is it', () => {
  // Owner report, 2026-08-13: *"the description texts when creating a project,
  // the sub-line under project title, and the about section, all three are
  // actually the same thing and should be de-duped."*
  //
  // They were two FIELDS — `Project.description`, collected by the New project
  // dialog, and a `readme` graph overlay that only the About section's editor
  // ever wrote. Every project a user created therefore showed its description
  // under the title and an empty "No README yet" three rows below, asking for
  // the same text again. Stated as the absence of the retired name, because the
  // failure mode is a RE-INTRODUCTION: nothing breaks if a second "about" field
  // reappears, the page just quietly starts asking twice again.
  const layers = {
    'contract/api.ts': ['projectReadmes'],
    'contract/graph.ts': ['projectReadmes', 'set-project-readme'],
    'contract/relations.ts': ['set-project-readme'],
    'contract/contributions.ts': ["'readme'"],
    'src/controller/useRelations.tsx': ['readmeForProject', 'projectReadmes'],
    'src/components/SectionView.tsx': ['set-project-readme', 'readmeForProject', 'ProjectReadme'],
  }
  for (const [rel, gone] of Object.entries(layers)) {
    const body = read(join(ROOT, ...rel.split('/')))
    for (const name of gone) {
      assert.ok(!body.includes(name), `${rel} still carries \`${name}\` — the second field is back`)
    }
  }
  // The positive half, and it is what the first cut got WRONG. That version
  // resolved the overlay inside the About section — `rel.descriptionForProject(
  // project.id)` — which made About correct and left every other surface reading
  // the raw record: edit the description and the Projects hub row still showed
  // the creation text, and hub SEARCH could not find the new words. A merge that
  // only one reader honours has moved the duplication, not removed it.
  //
  // So the overlay is applied at the MERGE POINT, and the assertion is about
  // that: `allProjects()` hands out resolved rows, so a caller holding a
  // `Project` reads `project.description` and is right by construction.
  const controller = read(join(ROOT, 'src', 'controller', 'useRelations.tsx'))
  assert.match(controller, /const withDescriptions = \(list: Project\[\]\): Project\[\] =>/, 'the overlay has one applier')
  assert.match(controller, /const merged = \(\) => withDescriptions\(\[\.\.\.graph\.extraProjects, \.\.\.projects\]\)/,
    'and it wraps the one merged list')
  assert.match(controller, /allProjects: merged,/, 'which is what every project reader is served')
  // …and it is the ONLY place the two lists are spread together. A second spread
  // is a second, unresolved answer to "what are the projects" — which is what
  // `projectForSessionId` and `descriptionForProject` each were until now, one
  // of them handing the session breadcrumb a stale description.
  assert.equal(
    (controller.match(/\[\.\.\.graph\.extraProjects, \.\.\.projects\]/g) ?? []).length,
    1,
    'the two project lists are merged in exactly one place',
  )
  assert.match(fn('ProjectAbout'), /const current = project\.description/, 'About reads the resolved field')
  assert.match(fn('ProjectAbout'), /kind: 'set-project-description'/, 'and edits the one field')
  // …and the sub-line is gone from the page header, which is the duplication a
  // reader could actually SEE.
  const detail = fn('ProjectDetail')
  assert.ok(
    !/<p className="mt-1 text-sm text-ink-soft">\{project\.description\}/.test(detail),
    'the page header no longer prints the description as a sub-line — About is where it lives',
  )
  // The verb went with it: editing what the project IS is a project-level act,
  // so it sits in the header's cluster and About takes `editing` as a prop.
  assert.match(detail, /label="Edit description/, 'the header carries the Edit verb')
  assert.match(detail, /editing=\{editingAbout\}/, 'and About is driven by it')
})

test('no section holds a standing form — the composer hangs off the header verb (UI-18)', () => {
  // UI-18 already says this, and `thread-composer.test.ts` already enforces it
  // for the THREAD composer. What neither covered is any OTHER standing form,
  // and one was hiding in plain sight: the Sharing section's grant composer
  // stood permanently open, which made that section 346px on a page whose
  // median section is 97 and the only one on it holding a form field at all —
  // five of them, against zero everywhere else (measured 2026-08-13, on the
  // owner's report that the layout still read as messy).
  //
  // So the scan is over FIELDS, not over one component: any `<input>`,
  // `<select>` or `<textarea>` rendered inside a section must sit behind a
  // state gate. That is the general form of the rule the specific lock missed.
  // A disclosure gate in either spelling this file uses — `{editing ? (` and
  // `{composing && `. The first cut matched only `&&` and reported three
  // correctly-gated sections as offenders; a lock that fails against a correct
  // page is worse than no lock, because the next person to see it deletes it.
  const GATE = /\{[A-Za-z]*(?:editing|composing|sharing|claiming|picking|adding)[A-Za-z]*\s*(?:\?|&&|===)/i
  const offenders: string[] = []
  for (const body of code.split(/\n(?=(?:export )?(?:function|const) [A-Za-z])/)) {
    if (!body.includes('<FoldSection')) continue
    const name = body.match(/^(?:export )?(?:function|const) ([A-Za-z]+)/)?.[1] ?? '(anonymous)'
    // Per FIELD, not per component: gating one form and leaving a second
    // standing open beside it is exactly the state this looks for, and a
    // body-wide test would pass straight over it.
    for (const m of body.matchAll(/<(input|select|textarea)\b/g)) {
      // A search field narrows the section already in view; it is not a form
      // that creates or mutates a resource, so disclosing it behind an Add/Edit
      // verb would add a click without removing standing composition.
      // JSX handlers contain `=>`, so "slice to the next >" cuts the tag at an
      // arrow. A bounded opening-tag window is the same defensive shape the
      // GrantsPanel enumeration below uses.
      const tag = body.slice(m.index, m.index + 600)
      if (/aria-label="Search\b/.test(tag)) continue
      if (!GATE.test(body.slice(0, m.index))) offenders.push(`${name}: <${m[1]}>`)
    }
  }
  assert.deepEqual(offenders, [], `these render form fields with no disclosure gate: ${offenders.join(', ')}`)
  // Vacuity guard: the scan means nothing if no section component renders a
  // field at all — which was very nearly true, and is the point.
  const withFields = code
    .split(/\n(?=(?:export )?(?:function|const) [A-Za-z])/)
    .filter((b) => b.includes('<FoldSection') && /<(input|select|textarea)\b/.test(b))
  assert.ok(withFields.length >= 1, 'at least one section hosts a form (the scan has a subject)')
  // ── The form that lives in ANOTHER module ─────────────────────────────────
  //  The field scan above cannot see into `GrantsPanel`, and its first cut could
  //  not see the miss either: it asked whether SOME disclosure gate appeared
  //  before each field, and `ScheduledDetail` has an unrelated one (the name
  //  editor) hundreds of lines above its Sharing section. So the routine page
  //  kept a standing grant form while the project page lost one, and the suite
  //  was green. A gate is not a gate for every field in the file.
  //
  //  Enumerated instead: every host of `<GrantsPanel>` is named, and each is
  //  either a SECTION (which must pass `composing`) or a surface that IS the
  //  share act (which must not — a form you disclose inside a popover you opened
  //  to share is a click that buys nothing). Naming them is the point: a new
  //  host has to say out loud which kind it is.
  // `[\s\S]*?` and not `[^}]*`: the subject prop is an object literal, so it
  // carries braces of its own and a negated-brace class stops at the first one.
  const SECTION_HOSTS = ['SectionView.tsx', 'artifactPreview.tsx']
  const ACT_HOSTS = ['SessionShareButton.tsx']
  for (const file of [...SECTION_HOSTS, ...ACT_HOSTS]) {
    const body = stripComments(read(join(ROOT, 'src', 'components', file)))
    // `[\s\S]*?` and not `[^}]*`: the subject prop is an object literal, so it
    // carries braces of its own and a negated-brace class stops at the first.
    const hosts = [...body.matchAll(/<GrantsPanel[\s\S]{0,160}?\/>/g)].map((m) => m[0])
    assert.ok(hosts.length > 0, `${file} hosts GrantsPanel (the enumeration is current)`)
    for (const h of hosts) {
      const disclosed = /composing=\{/.test(h)
      const one = h.replace(/\s+/g, ' ').slice(0, 90)
      if (SECTION_HOSTS.includes(file)) assert.ok(disclosed, `a section's grant form must be disclosed: ${one}`)
      else assert.ok(!disclosed, `${file} IS the share act — its form stands open: ${one}`)
    }
  }
  assert.match(
    read(join(ROOT, 'src', 'components', 'GrantsPanel.tsx')),
    /composing = true \}: \{ subject: SocialEntityRef; composing\?: boolean \}/,
    'and GrantsPanel defaults to open — so the act surfaces get it by saying nothing',
  )
})

test('a section indents its content ONCE — nothing inside re-indents', () => {
  // The companion to `SECTION_BODY_CLASS` (owner directive 2026-08-13:
  // *"indenting section contents to make section frames outstanding … applied
  // uniformly across all sections"*), and the half that makes it uniform rather
  // than additive.
  //
  // The indent used to be an accident of each content type's own padding, not a
  // decision: measured across one project page, a section's content began at 0,
  // 16, 24, 32, 39 or 44 — six left edges down twelve sections. The rows in a
  // section's list carried the very same 16px a second time, which is why list
  // text sat at 32 while the prose beside it sat at 0.
  //
  // So: the section owns the inset; a row inside it carries vertical padding
  // only. The rendered version of this claim is a MEASUREMENT in
  // `e2e/project-page.spec.ts` (every section's content inset by the same
  // amount); this is the source half, which catches the next row to be written
  // rather than the next page to be rendered.
  const bodies = code.split(/\n(?=(?:export )?(?:function|const) [A-Za-z])/)
  const sectionComponents = bodies.filter((b) => b.includes('<FoldSection'))
  assert.ok(sectionComponents.length >= 10, 'the scan found the section components')
  const offenders: string[] = []
  for (const b of sectionComponents) {
    const name = b.match(/^(?:export )?(?:function|const) ([A-Za-z]+)/)?.[1] ?? '(anonymous)'
    // `px-3.5` / `px-4` / `pl-4` on a ROW is the doubled indent. Deliberately
    // narrow: a chip, a badge and a button legitimately pad themselves, and
    // those are `px-1.5`/`px-2`/`px-2.5` — an order of magnitude below the
    // section's own inset, and they are objects rather than rows.
    for (const m of b.matchAll(/className="[^"]*\b(px-4|px-3\.5|pl-4|pl-3\.5)\b[^"]*"/g)) {
      offenders.push(`${name}: ${m[1]}`)
    }
  }
  assert.deepEqual(offenders, [], `these re-indent inside a section that already indented: ${offenders.join(', ')}`)
  // …and the inset itself comes from the one home, applied by the one primitive.
  assert.match(fn('FoldSection'), /SECTION_BODY_CLASS/, 'FoldSection applies the shared inset')
  const lib = read(join(ROOT, 'src', 'lib', 'foldHeader.ts'))
  assert.match(lib, /export const SECTION_BODY_INSET = 'px-4'/, 'and the inset is stated once, symmetric')
  // The VERTICAL half of space-it-once, added 2026-08-13: a list sitting
  // directly under the section's rule gives back the row padding that would
  // otherwise be added to the space the section already left. Scoped by the
  // SECTION, not by the list — asserted here because the difference is the
  // whole point (on `CardList` it also fired for lists with no rule above them,
  // e.g. the profile page's follower bands). The measurement is in
  // `e2e/project-page.spec.ts`; what this holds is WHERE the rule lives.
  assert.match(lib, /SECTION_LIST_UNDOUBLE[\s\S]*?data-card-list/, 'the un-double rule is stated in the section body')
  assert.ok(
    SECTION_BODY_CLASS.includes(SECTION_LIST_UNDOUBLE) && SECTION_BODY_CLASS.includes(SECTION_BODY_INSET),
    'the section body composes both halves',
  )
  assert.match(
    fn('CardList'),
    /data-card-list/,
    'CardList stamps the handle the section body selects on — without it the rule silently matches nothing',
  )
})

test('the space around a section rule comes from the one constant, not from the header', () => {
  // The MEASUREMENT lives in `e2e/project-page.spec.ts` — 12px above the rule
  // and 12 below it, in every section — because the pair is stated in two units
  // (`pb-2` under a label button carrying its own `py-1`, and a straight `mb-3`)
  // and only a browser resolves that to one number. What a source scan can hold
  // is the ONE HOME: the header must not spell its own padding or margin, or the
  // constant becomes a description of one of two places the value lives.
  const header = fn('FoldSection')
  assert.match(header, /SECTION_RULE_SPACE\.above/, 'the header takes its space above the rule from the constant')
  assert.match(header, /SECTION_RULE_SPACE\.below/, '…and its space below it')
  const ruleRow = header.match(/className=\{`[^`]*LEDGER_RULE_CLASS[^`]*`\}/)?.[0] ?? ''
  assert.ok(ruleRow, 'found the class expression that draws the rule')
  assert.doesNotMatch(
    ruleRow,
    /\b(p[bty]|m[bty])-[\d.]+/,
    `the rule row hardcodes its own spacing: ${ruleRow}`,
  )
})
