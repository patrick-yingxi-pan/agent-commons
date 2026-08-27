/** The entity page as ONE column of foldable sections (owner directive
 *  2026-08-12: *"two columns and a lot of frames … make it one column of
 *  foldable sections … one solution for many similar problems with adapted UI
 *  styles"*).
 *
 *  Everything here needs a browser and none of it is visible to `node --test`:
 *  the fold posture is stored in `localStorage` (which node has none of, as
 *  `src/lib/section-fold.test.ts` says out loud), the one-column claim is a
 *  measurement, and the stub-agrees-with-its-content claim needs both states of
 *  the same section rendered. The pure halves — the key, the defaults, the
 *  fold-all pair's work — are locked next to their code. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'
import { createProject, newUser } from './social-helpers.ts'
import { openOrganizePaneMenu, organizePane } from './pane-actions.ts'

/** A project with everything on it: sessions, a discussion, a live grant, two
 *  routines, four contexts. A quiet project would let a half-rendered page pass. */
const PROJECT = '/projects/p-insights'

/** The five configuration sections, and the eight the page is FOR. Written out
 *  because this is the owner's decision being locked, not a fact derived from
 *  the source — the source-level version of the same split lives in
 *  `src/components/main-column-sections.test.ts`, and two independent statements
 *  of one decision is exactly how a decision stops being enforced. Here it is
 *  asserted through what a signed-in reader actually SEES. */
const CONFIG = ['Instructions', 'Sharing', 'Delegation', 'Routines', 'Context']
const CONTENT = ['About', 'Artifacts', 'Recent sessions', 'Changes', 'Discussion', 'Contributors', 'Coordination', 'Open work']

/** The page's section order, top to bottom (owner directive 2026-08-13:
 *  *"reorder the sections into logical order and fixed-length before elongating
 *  ones like discussion and recent sessions"*).
 *
 *  Three bands, separated by how a section behaves after a year of use rather
 *  than by what it is about: STATE (bounded answers) · CONFIGURATION (owner-only,
 *  every one of them folded to a line) · HISTORIES (unbounded). The reasoning,
 *  including why Open work stays in band 1 and why configuration moved ahead of
 *  the histories, is at the render site in `ProjectDetail`.
 *
 *  Locked HERE and nowhere else. Order is one JSX sequence, so a source scan and
 *  a rendered walk would be two statements of one decision — the hazard this
 *  file already names about CONFIG/CONTENT, which earn their double statement by
 *  checking genuinely different things (what the source declares vs what a
 *  signed-in reader sees). Order does not: the rendered walk subsumes the source
 *  one and additionally proves the conditional sections land in the right place. */
const ORDER = [
  'About', 'Attention', 'Contributors', 'Coordination', 'Open work', 'Artifacts',
  'Instructions', 'Context', 'Sharing', 'Delegation', 'Routines',
  'Changes', 'Recent sessions', 'Discussion',
]

/** Every section header on the page — the disclosure buttons, and only those.
 *
 *  A direct-child path rather than a descendant sweep, because the Discussion
 *  section holds a THREAD and every post caret in it carries `aria-expanded`
 *  too. */
const HEADERS = 'section.group\\/section > div > button[aria-expanded]'

/** One section's fold toggle, by its visible name.
 *
 *  Located through `HEADERS` and not by accessible name alone: the RAIL has a
 *  Routines resource branch and Project has a Routines section, so a
 *  `getByRole` over the document can resolve to chrome instead of page content.
 *  The lesson is the same both times: this app's chrome shares vocabulary with
 *  its content, so a page-level claim needs a page-level scope. */
/** The gaps between consecutive sections, deduped — one value means one rhythm. */
const sectionGaps = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const secs = [...document.querySelectorAll('section')].filter((e) => e.className.includes('group/section'))
    const out: number[] = []
    for (let i = 0; i < secs.length - 1; i++) {
      out.push(Math.round(secs[i + 1].getBoundingClientRect().top - secs[i].getBoundingClientRect().bottom))
    }
    return [...new Set(out)]
  })

const header = (page: import('@playwright/test').Page, title: string) =>
  page
    .locator(HEADERS)
    .filter({ has: page.locator('[data-section-title]', { hasText: new RegExp(`^${title}$`, 'i') }) })

/** The shared `Page` column itself. Detail payloads can legitimately contain a
 *  nested reading cap, so locating every `.max-w-3xl` ancestor of the heading
 *  double-counts on a Project detail. The Page column is the direct child of
 *  the section's scrolling main surface. */
const mainColumn = (page: import('@playwright/test').Page) =>
  page.locator('div.flex-1.overflow-y-auto > div.mx-auto.w-full.max-w-3xl')

test('an unresolved project URL keeps an honest unavailable detail page', async ({ browser }) => {
  test.setTimeout(ms(60_000))
  const ada = await newUser(browser)
  const page = ada.page

  await page.goto('/projects/does-not-exist')
  const unavailable = page.locator('[data-resource-unavailable="missing"]')
  await expect(unavailable).toBeVisible({ timeout: ms(20_000) })
  await expect(unavailable.getByRole('heading', { name: 'Project', exact: true })).toBeVisible()
  await expect(unavailable).toContainText('This project isn’t visible from this account (or no longer exists).')
  await expect(page).toHaveURL(/\/projects\/does-not-exist$/)
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toHaveCount(0)

  await ada.context.close()
})

test('a failed project registry read is retryable and never masquerades as missing', async ({ browser }) => {
  test.setTimeout(ms(80_000))
  // A created project lives only in the relation graph, not the base Projects
  // registry. Using one makes both deciding reads load-bearing: omitting either
  // retry key strands this exact walk instead of passing through the seed list.
  const setup = await newUser(browser)
  const projectName = `Recovery project ${Date.now().toString(36)}`
  await setup.page.goto('/projects')
  await createProject(setup.page, projectName)
  const projectUrl = new URL(setup.page.url()).pathname
  await setup.context.close()

  const ada = await newUser(browser)
  const page = ada.page
  let failRegistry = true
  const attempts = { projects: 0, relations: 0 }
  const gate = (key: keyof typeof attempts) => async (route: import('@playwright/test').Route) => {
    attempts[key] += 1
    if (failRegistry) await route.abort('connectionrefused')
    else await route.continue()
  }
  await page.route('**/api/v1/projects', gate('projects'))
  await page.route('**/api/v1/relations', gate('relations'))

  await page.goto(projectUrl)
  const failed = page.locator('[data-resource-unavailable="error"]')
  await expect(failed).toBeVisible({ timeout: ms(20_000) })
  await expect(failed.getByRole('alert')).toContainText('Couldn’t load this page')
  await expect(failed).not.toContainText('isn’t visible from this account')
  await expect(page).toHaveURL(new RegExp(`${projectUrl}$`))
  expect(attempts.projects, 'the real project registry request failed').toBeGreaterThan(0)
  expect(attempts.relations, 'the real relation registry request failed').toBeGreaterThan(0)

  failRegistry = false
  await failed.getByRole('button', { name: 'Try again' }).click()
  await expect(failed).toHaveCount(0, { timeout: ms(20_000) })
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`${projectUrl}$`))

  await ada.context.close()
})

test('the Projects root reuses the Project main-page grammar', async ({ browser }) => {
  test.setTimeout(ms(60_000))
  const ada = await newUser(browser)
  const page = ada.page

  await page.goto('/projects')
  const rootHeading = page.getByRole('heading', { name: 'Projects', exact: true })
  await expect(rootHeading).toBeVisible({ timeout: ms(20_000) })
  const rootColumn = mainColumn(page).filter({ has: rootHeading })
  await expect(rootColumn, 'the collection root uses the shared reading column').toHaveCount(1)
  await expect(header(page, 'Yours'), 'the collection band is a real FoldSection').toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(header(page, 'Shared with you'), 'the second band uses the same disclosure frame').toHaveAttribute(
    'aria-expanded',
    'true',
  )
  const rootBox = await rootColumn.boundingBox()
  if (!rootBox) throw new Error('Projects reading column not laid out')
  expect(rootBox.width, 'the root does not reopen to the old wide ledger').toBeLessThanOrEqual(768)

  await page.goto(PROJECT)
  const detailHeading = page.getByRole('heading', { name: 'Insights dashboard' })
  await expect(detailHeading).toBeVisible({ timeout: ms(20_000) })
  const detailColumn = mainColumn(page).filter({ has: detailHeading })
  await expect(detailColumn).toHaveCount(1)
  const detailBox = await detailColumn.boundingBox()
  if (!detailBox) throw new Error('Project reading column not laid out')
  expect(
    Math.abs(rootBox.width - detailBox.width),
    'root and detail solve the same hierarchy at the same reading width',
  ).toBeLessThanOrEqual(1)

  await ada.context.close()
})

test('the project page is one column of foldable sections, configuration folded', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser)
  const page = ada.page
  await page.goto(PROJECT)
  await expect(page.getByRole('heading', { name: 'Insights dashboard' })).toBeVisible({ timeout: ms(20_000) })

  // ── ONE column ────────────────────────────────────────────────────────────
  //  Stated as a MEASUREMENT plus an absence. The absence alone would pass on a
  //  page that had merely renamed its `<aside>`; the measurement alone would
  //  pass on two columns whose first section happened to start at the header's
  //  left edge. Together they say what the directive asked for.
  //  Scoped to the page's own column, NOT the document: the app's RAIL is an
  //  `<aside>` too (`e2e/CLAUDE.md`), so a bare count catches the sidebar and
  //  fails against a correct page — which it did, first run.
  const column = page.locator('div:has(> header)')
  await expect(column).toHaveCount(1)
  await expect(column.locator('aside')).toHaveCount(0)
  const headerBox = await page.locator('header').first().boundingBox()
  const sections = page.locator('section.group\\/section')
  await expect(sections.first()).toBeVisible()
  const firstBox = await sections.first().boundingBox()
  if (!headerBox || !firstBox) throw new Error('header / first section not laid out')
  // Both edges, not just the left: a column that starts with the title and runs
  // past it is not the same column, and the right edge is what catches a section
  // that escaped the reading cap.
  expect(Math.abs(firstBox.x - headerBox.x), 'the title and the sections share a left edge').toBeLessThanOrEqual(1)
  expect(
    Math.abs(firstBox.x + firstBox.width - (headerBox.x + headerBox.width)),
    'and a right edge — one column, not a column beside a wider header',
  ).toBeLessThanOrEqual(1)

  // ── The order: bounded before growing ─────────────────────────────────────
  //  Read off the page rather than declared, and checked two ways, because the
  //  two failures look nothing alike. A section that MOVED shows up in the
  //  sequence check; a section that appeared under a name nobody planned for
  //  would slip through it silently (the sequence of a subset stays sorted), so
  //  the unknown-name check has to be separate.
  //
  //  Read off the stamped TITLE span, not the header button: a folded section's
  //  summary rides on the same row inside the same button, so the button's text
  //  is "Sharingtenant-beta".
  //
  //  `textContent`, not `innerText`: the label is uppercased in CSS, and
  //  `innerText` returns what the browser painted, so a title-cased list would
  //  fail against a correct page.
  const seen = (await page.locator(`${HEADERS} [data-section-title]`).allTextContents()).map((t) => t.trim())
  expect(seen.filter((t) => !ORDER.includes(t)), 'every section on the page is one this order accounts for').toEqual([])
  //  The overview is the complete skeleton the rail discloses: an empty section
  //  renders an honest empty state instead of disappearing from one projection.
  expect(seen, 'every registered section arrives in the declared order').toEqual(ORDER)

  // ── ONE left edge, all the way down ───────────────────────────────────────
  //  (Owner report 2026-08-13: *"the layout is still visually messy."* It was,
  //  and it was measurable: the chevron led each header, so every section's
  //  LABEL rendered 19px right of both its own rule and its own content. Twelve
  //  sections, so the eye tracked 0 · 19 · 0 · 19 the whole way down the page.)
  //
  //  A MEASUREMENT and nothing else, because the source-level version of this
  //  claim — "the label element precedes the chevron" — is what
  //  `src/lib/foldHeader.test.ts` holds, and it is not the same claim: a label
  //  written first can still be pushed right by anything laid out before it.
  //  What a reader sees is the box, so the box is what this asserts.
  const edges = await page.evaluate(() => {
    const col = document.querySelector('.max-w-3xl')!
    const left = col.getBoundingClientRect().left
    // Filtered by className rather than selected with `section.group\/section`:
    // the class holds a slash, so the selector needs a CSS escape, and that
    // escape sits inside a JS string inside a `page.evaluate` — three levels of
    // backslash to get right, and it arrived as `section.group/section` and
    // threw on the first run. A filter has no escaping at all.
    const all = [...document.querySelectorAll('section')].filter((e) => e.className.includes('group/section'))
    return all.map((s) => {
      const head = s.querySelector('div')!
      const title = s.querySelector('[data-section-title]')!
      const body = [...s.children].find((c) => c !== head)
      // The INSET is what a reader sees, so measure the content itself, not the
      // wrapper that pads it: the wrapper's own box starts at the rule, and an
      // assertion on it would pass with the padding deleted.
      const inner = body?.firstElementChild ?? body
      return {
        name: title.textContent ?? '?',
        rule: Math.round(head.getBoundingClientRect().left - left),
        label: Math.round(title.getBoundingClientRect().left - left),
        content: inner ? Math.round(inner.getBoundingClientRect().left - left) : null,
      }
    })
  })
  expect(edges.length, 'the page rendered its sections').toBeGreaterThanOrEqual(10)
  //  (1) The FRAME: every section's rule and label start at the column edge.
  const raggedFrame = edges.filter((e) => e.label !== e.rule)
  expect(
    raggedFrame.map((e) => `${e.name}: rule ${e.rule}, label ${e.label}`),
    'every section starts its rule and its label at the same x',
  ).toEqual([])
  //  (2) The CONTENT: inset from that edge, by the SAME amount every time
  //      (owner directive 2026-08-13 — *"indenting section contents to make
  //      section frames outstanding … applied uniformly across all sections"*).
  //      It was an accident of each content type's own padding before this:
  //      measured across this page, a section's content began at 0, 16, 24, 32,
  //      39 or 44 — six left edges down twelve sections.
  //      Over the OPEN sections only: a folded one renders no body at all (its
  //      summary is on the title's row), so it has nothing to inset and would
  //      report a phantom 0.
  const open = edges.filter((e) => e.content !== null)
  expect(open.length, 'some sections are open to measure').toBeGreaterThanOrEqual(5)
  const insets = [...new Set(open.map((e) => e.content! - e.rule))]
  expect(insets, 'every section insets its content by the same amount').toHaveLength(1)
  expect(insets[0], 'and the inset is real — the content sits inside the frame').toBeGreaterThan(0)

  // ── Configuration opens folded, content opens open ────────────────────────
  for (const title of CONFIG) {
    await expect(header(page, title), `${title} is configuration — it opens folded`).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  }
  for (const title of CONTENT) {
    await expect(header(page, title), `${title} is content — it opens open`).toHaveAttribute('aria-expanded', 'true')
  }
  // The Sharing FORM — five stacked bordered controls, the heaviest block on the
  // old page — is what folding it buys. Asserted as the absence of the control
  // rather than of the section, since the section is still there as one line.
  await expect(page.getByRole('combobox').filter({ hasText: 'Org' })).toHaveCount(0)

  // ── A folded section is an INDEX ENTRY, not a gap ─────────────────────────
  //  The thread's stub rule carried across. Each of these is the section's own
  //  content in one line; a bare chevron would satisfy "it folded" and tell the
  //  reader nothing about what they had put away.
  await expect(page.getByText('No judgment delegated', { exact: true })).toBeVisible()
  await expect(page.getByText('2 routines', { exact: true })).toBeVisible()

  // ── …and the stub AGREES with the content it stands in for ────────────────
  //  The bug this was earned by: the Sharing stub first read `project.shared`,
  //  which is a different fact from the grant roster the section renders — so a
  //  seeded project carrying a live `tenant-beta` grant folded to "Not shared".
  //  A summary is read exactly when its content is off screen, which is where
  //  being wrong costs most and is least likely to be noticed.
  const sharing = header(page, 'Sharing')
  await expect(page.getByText('tenant-beta', { exact: true }).first()).toBeVisible()
  await sharing.click()
  await expect(sharing).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('tenant-beta').first()).toBeVisible()
  await sharing.click()

  // ── A folded section is ONE ROW ───────────────────────────────────────────
  //  (Owner directive 2026-08-13: *"the summary should sit at the same row of
  //  section title instead of below it for a more compacted view."*)
  //
  //  A MEASUREMENT, because the source-level version — the summary renders
  //  inside the header button — is already locked in
  //  `main-column-sections.test.ts` and does not answer the question that was
  //  actually asked. "Inside the button" is where it is in the markup; "on the
  //  same row" is a fact about the rendered box, and a summary that wrapped
  //  under the title would satisfy the first and fail the second.
  const foldedRow = await header(page, 'Sharing').boundingBox()
  const openRow = await header(page, 'Contributors').boundingBox()
  if (!foldedRow || !openRow) throw new Error('section headers not laid out')
  expect(
    Math.abs(foldedRow.height - openRow.height),
    'a folded section header is exactly as tall as an open one — the summary shares its row',
  ).toBeLessThanOrEqual(1)
  //  …and the summary really is beside the title, not merely present: same
  //  vertical centre, further right.
  const titleBox = await header(page, 'Sharing').locator('[data-section-title]').boundingBox()
  const summaryBox = await header(page, 'Sharing').locator('span').last().boundingBox()
  if (!titleBox || !summaryBox) throw new Error('title / summary not laid out')
  expect(summaryBox.x, 'the summary follows the title').toBeGreaterThan(titleBox.x + titleBox.width - 1)
  expect(
    Math.abs(titleBox.y + titleBox.height / 2 - (summaryBox.y + summaryBox.height / 2)),
    'and shares its centre line',
  ).toBeLessThanOrEqual(2)

  // ── The page header is a section header, one level up ─────────────────────
  //  (Owner directive 2026-08-13: *"the reveal action buttons can be placed at
  //  the same row of the title, effectively becoming project-level actions,
  //  similar idea to section actions."*)
  //
  //  Edit description hides until the header is hovered, exactly like a
  //  section's verbs — and Watch does NOT, because it carries state. That
  //  asymmetry is the claim: "am I watching this project?" must not be a
  //  question you have to hover to answer.
  const pageHeader = page.locator('header').first()
  const editVerb = pageHeader.getByRole('button', { name: /^Edit description/ })
  await expect(editVerb).toHaveCount(1)
  await page.mouse.move(0, 0)
  await expect(editVerb.locator('xpath=..')).toHaveCSS('opacity', '0')
  await pageHeader.hover()
  await expect(editVerb.locator('xpath=..')).toHaveCSS('opacity', '1')

  //  …and the description it edits is in About, not under the title. The
  //  sub-line and the About section were the same text on one page (owner
  //  report: *"all three are actually the same thing"*), so the page must print
  //  it exactly once.
  const DESC = 'The self-serve Insights dashboard'
  expect(
    await page.locator('header').first().locator(`text=${DESC}`).count(),
    'the page header no longer prints the description',
  ).toBe(0)
  await expect(header(page, 'About')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText(new RegExp(DESC))).toHaveCount(1)

  // ── A section's verbs all live in ONE cluster ─────────────────────────────
  //  (Owner directive 2026-08-13: *"fold/unfold all buttons in discussion
  //  section can be per-section buttons, too … make all per-section buttons of
  //  the same style that show upon hover"*.)
  //
  //  The thread's Fold all · Unfold all used to hang above the posts as its own
  //  right-aligned row of text buttons — a third place the Discussion section
  //  put a verb, alongside the header cluster and the per-post acts. Checked
  //  here and not by source scan because this section passes `actions` a
  //  VARIABLE, so a scan for hand-rolled buttons in the prop (which
  //  `main-column-sections.test.ts` does run) cannot see through it.
  const threadFold = page.getByRole('button', { name: /^Fold all posts/ })
  await expect(threadFold).toHaveCount(1)
  //  Hidden at rest and revealed on hover — the "normally hidden, contributing
  //  to a visually cleaner page" half of the directive, and the half a walk that
  //  merely clicks the button cannot see: Playwright presses an `opacity-0`
  //  control perfectly happily, so pressing it proves nothing about whether
  //  anyone can see it.
  //
  //  Asserted as COMPUTED opacity, not as a class. The first cut checked for
  //  `opacity-0` in the class list and passed against a deliberately pinned
  //  cluster — `SECTION_REVEAL` always contains `opacity-0` and pinning appends
  //  `opacity-100` to beat it by cascade, so the class is present in both
  //  states. A class name is what the code says; this is what the reader sees.
  const cluster = threadFold.locator('xpath=..')
  await expect(cluster).toHaveCSS('opacity', '0')
  await header(page, 'Discussion').hover()
  await expect(cluster).toHaveCSS('opacity', '1')

  //  …and EVERY section, not just the one under test. This is the assertion the
  //  first pass should have made: it kept a `revealActions` pin for empty
  //  sections, on the reasoning that an empty section whose only affordance is
  //  invisible is a discoverability dead end — and shipped a page with four
  //  glyphs standing on it, because on a fresh project most sections ARE empty,
  //  so the exception was the common case (owner report, 2026-08-13: *"there are
  //  still section buttons constantly showed, instead of showed upon hover"*).
  //  A per-section assertion could not have caught that; a page-wide one does.
  //  `expect.poll`, not a bare read: the reveal is a TRANSITION, so moving the
  //  pointer away starts an animation rather than ending a state, and a one-shot
  //  `evaluateAll` catches the section just hovered at some opacity between 1
  //  and 0 (it did, first run — a red bar against a correct page).
  await page.mouse.move(0, 0)
  await expect
    .poll(
      () =>
        page
          .locator(`${HEADERS} + div`)
          .evaluateAll((els) =>
            els
              .filter((e) => getComputedStyle(e).opacity !== '0')
              .map((e) => e.parentElement?.textContent?.trim() ?? '?'),
          ),
      { message: 'no section shows its verbs until you hover it' },
    )
    .toEqual([])
  // The thread keeps its section-local acts; page-wide disclosure has one home
  // in shell chrome rather than another pair above the page.
  await expect(page.getByRole('button', { name: 'Fold all sections', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Organize pane', exact: true })).toBeVisible()

  const OPENING = 'Read through the Q3 baseline'
  await expect(page.locator('p', { hasText: OPENING })).toHaveCount(1)
  await threadFold.click()
  //  Folded: the body paragraph is gone and the stub stands in its place. (The
  //  stub quotes the same opening words, so this asserts on the `<p>` the open
  //  post renders — `getByText` would match either.)
  await expect(page.locator('p', { hasText: OPENING })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Unfold all posts/ })).toHaveCount(1)
  //  The pair is two independent acts (SOCIAL-21), so the way back is its own
  //  control and not a relabelled one.
  await page.getByRole('button', { name: /^Unfold all posts/ }).click()
  await expect(page.locator('p', { hasText: OPENING })).toHaveCount(1)

  await ada.context.close()
})

test('composite resources preserve parent → section → resource in the rail and main pages', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser)
  const page = ada.page
  await page.goto(PROJECT)
  await expect(page.getByRole('heading', { name: 'Insights dashboard' })).toBeVisible({ timeout: ms(20_000) })

  // A Project discloses its page sections first. Resources never flatten
  // directly under the parent: Artifacts owns artifact rows, Recent sessions
  // owns session rows, and a section name is itself a canonical page door.
  const sectionsNav = page.getByRole('navigation', { name: 'Sections' })
  const projectToggle = sectionsNav.getByRole('button', { name: /^(Expand|Collapse) Insights dashboard$/ })
  await expect(projectToggle).toBeVisible()
  if ((await projectToggle.getAttribute('aria-expanded')) === 'false') await projectToggle.click()
  const projectTree = sectionsNav.locator('[data-project-tree="p-insights"]')
  for (const section of ['About', 'Contributors', 'Open work', 'Artifacts', 'Context', 'Changes', 'Recent sessions', 'Discussion']) {
    await expect(projectTree.getByRole('button', { name: section, exact: true })).toBeVisible()
  }
  const artifactSectionToggle = projectTree.getByRole('button', { name: /^(Expand|Collapse) Artifacts$/ })
  if ((await artifactSectionToggle.getAttribute('aria-expanded')) === 'false') await artifactSectionToggle.click()
  await expect(projectTree.getByRole('button', { name: 'insights-onepager.md' })).toBeVisible()
  await expect(projectTree.getByText('artifact', { exact: true })).toHaveCount(0)

  await projectTree.getByRole('button', { name: 'Artifacts', exact: true }).click()
  await expect(page).toHaveURL(/\/projects\/p-insights\/artifacts$/)
  await expect(header(page, 'Artifacts')).toHaveAttribute('aria-expanded', 'true')
  await expect(header(page, 'About')).toHaveCount(0)
  await expect(page.getByRole('main').getByRole('button', { name: 'insights-onepager.md', exact: true })).toBeVisible()

  // The section is a real page, not transient selection state: its canonical
  // address survives a cold render and still excludes sibling sections.
  await page.reload()
  await expect(header(page, 'Artifacts')).toHaveAttribute('aria-expanded', 'true')
  await expect(header(page, 'About')).toHaveCount(0)

  await sectionsNav.getByRole('button', { name: 'Insights dashboard', exact: true }).click()
  await expect(page).toHaveURL(/\/projects\/p-insights$/)
  await expect(header(page, 'Artifacts')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('main').getByRole('button', { name: 'insights-onepager.md', exact: true })).toBeVisible()

  // A routine follows the same hierarchy: section pages sit under the parent,
  // and run sessions sit under Recent runs rather than under the routine.
  const projectsToggle = sectionsNav.getByRole('button', { name: /^(Expand|Collapse) Projects$/ })
  if ((await projectsToggle.getAttribute('aria-expanded')) === 'true') await projectsToggle.click()
  const scheduledSectionToggle = sectionsNav.getByRole('button', { name: /^(Expand|Collapse) Routines$/ })
  if ((await scheduledSectionToggle.getAttribute('aria-expanded')) === 'false') await scheduledSectionToggle.click()
  const scheduled = sectionsNav.locator('[data-section-tree="scheduled"]')
  const routineToggle = scheduled.getByRole('button', { name: /^(Expand|Collapse) Triage new GitHub issues$/ })
  await expect(routineToggle).toBeVisible()
  if ((await routineToggle.getAttribute('aria-expanded')) === 'false') await routineToggle.click()
  const routineTree = scheduled.locator('[data-routine-tree="s-issue-triage"]')
  await expect(routineTree.getByRole('button', { name: 'Instruction', exact: true })).toBeVisible()
  await expect(routineTree.getByRole('button', { name: 'Recent runs', exact: true })).toBeVisible()
  const runsToggle = routineTree.getByRole('button', { name: /^(Expand|Collapse) Recent runs$/ })
  if ((await runsToggle.getAttribute('aria-expanded')) === 'false') await runsToggle.click()
  await expect(routineTree.getByRole('button', { name: 'Labeled 11 issues, drafted 6 replies' })).toBeVisible()

  await routineTree.getByRole('button', { name: 'Instruction', exact: true }).click()
  await expect(page).toHaveURL(/\/scheduled\/s-issue-triage\/instruction$/)
  await expect(header(page, 'Instruction')).toHaveAttribute('aria-expanded', 'true')
  await expect(header(page, 'Workflow')).toHaveCount(0)

  await scheduled.getByRole('button', { name: 'Triage new GitHub issues', exact: true }).click()
  await expect(page).toHaveURL(/\/scheduled\/s-issue-triage$/)
  await expect(page.getByRole('heading', { name: 'Triage new GitHub issues' })).toBeVisible()
  const routineColumn = page.locator('div:has(> header)')
  await expect(routineColumn).toHaveCount(1)
  await expect(routineColumn.locator('aside')).toHaveCount(0)
  await expect(header(page, 'Instruction')).toBeVisible()
  await expect(header(page, 'Workflow')).toBeVisible()
  await expect(header(page, 'Recent runs')).toBeVisible()

  // Sections also remain real pages when their resource capability is absent.
  // Platform hardening is deliberately unguarded, so Open work owes an honest
  // empty state instead of disappearing from the overview or section route.
  await page.goto('/projects/p-infra/open-work')
  await expect(page).toHaveURL(/\/projects\/p-infra\/open-work$/)
  await expect(header(page, 'Open work')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('This project isn’t a guarded resource, so it has no coordinated backlog.')).toBeVisible()

  await ada.context.close()
})

test('Organize pane folds the focused page, and the posture survives a reload', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser)
  const page = ada.page
  await page.goto(PROJECT)
  await expect(page.getByRole('heading', { name: 'Insights dashboard' })).toBeVisible({ timeout: ms(20_000) })

  const expanded = () => page.locator(`${HEADERS}[aria-expanded="true"]`)

  // Both independent acts live inside one focused menu at rest: configuration
  // is folded (Unfold all has work) and content is open (Fold all has work).
  let organizeMenu = await openOrganizePaneMenu(page)
  await expect(organizeMenu.getByRole('menuitem', { name: 'Fold all', exact: true })).toBeVisible()
  await expect(organizeMenu.getByRole('menuitem', { name: 'Unfold all', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Fold all sections', exact: true })).toHaveCount(0)

  // ── The rhythm, before and after ──────────────────────────────────────────
  //  (Owner question 2026-08-13: *"how about giving more vertical space between
  //  sections? Can that bring more cleanness?"* Yes AND no, which is why this
  //  asserts two different numbers rather than one.)
  //
  //  OPEN, a section is a BLOCK and wants air — 24px against the 8px inside a
  //  section is 3:1, and at 32 the grouping snaps into place. FOLDED, it is a
  //  ROW in a list of twelve, and rows want to be tight, because the tightness
  //  is what makes them read as ONE index. Tried at 36 in the running app: the
  //  folded page became twelve scattered lines that had stopped being a list.
  //
  //  So the gap belongs to the SECTION, not the stack — a container can say only
  //  one thing, and this needs to say two. Measured in BOTH states here because
  //  that is the whole claim; either number alone is just a spacing value.
  //  At REST the page is mixed — content open, configuration folded — so it
  //  carries BOTH rhythms at once, which is the first thing to assert: exactly
  //  two, not one and not three. (The first cut expected one here and failed
  //  against a perfectly correct page; the mixed state is the resting state.)
  expect(await sectionGaps(page), 'the resting page carries both rhythms').toHaveLength(2)

  await organizePane(page, 'Fold all')
  await expect(expanded()).toHaveCount(0)
  const foldedGaps = await sectionGaps(page)
  expect(foldedGaps, 'all folded ⇒ one rhythm').toHaveLength(1)
  // …and Fold all now has nothing to do, so it is GONE rather than sitting inert
  // beside the one control that means something.
  organizeMenu = await openOrganizePaneMenu(page)
  await expect(organizeMenu.getByRole('menuitem', { name: 'Fold all', exact: true })).toHaveCount(0)
  await expect(organizeMenu.getByRole('menuitem', { name: 'Unfold all', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  // ── The posture is a PREFERENCE, so it survives the trip ──────────────────
  //  This is the half `node --test` cannot see: `uiPrefs` guards its own
  //  storage and returns the default where there is none, so a node run reads
  //  every section as its declared default and would pass over a persistence
  //  layer that never wrote anything.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Insights dashboard' })).toBeVisible({ timeout: ms(20_000) })
  await expect(expanded()).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Organize pane', exact: true })).toBeVisible()

  // Unfold all is the way back out of the state Fold all put the page in — the
  // dead end that forced the thread's pair apart, checked here on the page.
  await organizePane(page, 'Unfold all')
  const count = await page.locator(HEADERS).count()
  await expect(expanded()).toHaveCount(count)
  organizeMenu = await openOrganizePaneMenu(page)
  await expect(organizeMenu.getByRole('menuitem', { name: 'Unfold all', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')

  //  …and now every section is open, so the other rhythm is uniform — and it is
  //  the LARGER one. That comparison is the claim; either number alone is just a
  //  spacing value somebody picked.
  const openGaps = await sectionGaps(page)
  expect(openGaps, 'all open ⇒ one rhythm').toHaveLength(1)
  expect(
    foldedGaps[0],
    `a folded section is a row in a list and sits TIGHTER than an open one, which is a block (folded ${foldedGaps[0]}, open ${openGaps[0]})`,
  ).toBeLessThan(openGaps[0]!)

  await ada.context.close()
})

/** The space AROUND a section's rule, per open section, in the two units the
 *  code actually owns: `above` is geometry (the label's line box to the top of
 *  the stroke), `below` is the header's own bottom MARGIN.
 *
 *  Below is read as a margin rather than measured to the content box on purpose.
 *  A list directly under the rule gives back its first row's doubled padding
 *  with a negative top margin (`SECTION_LIST_UNDOUBLE`), so the content box in a
 *  list section legitimately starts AT the rule — a geometric "below" would read
 *  0 there and 12 next door and call a correct page broken. What the section
 *  owns is the margin; what the content does with the space it is given is the
 *  next claim's business. */
const ruleSpace = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const out: { title: string; above: number; below: number }[] = []
    for (const s of document.querySelectorAll('section')) {
      if (!s.className.includes('group/section')) continue
      const head = s.querySelector(':scope > div')
      const label = head?.querySelector('[data-section-title]')
      if (!head || !label || head.nextElementSibling === null) continue // folded: no body, no space below
      const cs = getComputedStyle(head)
      const ruleTop = head.getBoundingClientRect().bottom - parseFloat(cs.borderBottomWidth)
      out.push({
        title: label.textContent!.trim(),
        above: Math.round(ruleTop - label.getBoundingClientRect().bottom),
        below: Math.round(parseFloat(cs.marginBottom)),
      })
    }
    return out
  })

/** Where a section's first LINE OF TEXT lands under the rule — a text range, not
 *  an element box, because the element that holds the first words differs per
 *  content type and only the text is comparable across them. */
const firstLineUnderRule = (page: import('@playwright/test').Page, titles: string[]) =>
  page.evaluate((want) => {
    const out: Record<string, number> = {}
    for (const s of document.querySelectorAll('section')) {
      if (!s.className.includes('group/section')) continue
      const head = s.querySelector(':scope > div')
      const label = head?.querySelector('[data-section-title]')
      const body = head?.nextElementSibling
      const title = label?.textContent?.trim() ?? ''
      if (!head || !body || !want.includes(title)) continue
      const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      let node = walk.nextNode()
      while (node && !node.textContent!.trim()) node = walk.nextNode()
      if (!node) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      out[title] = Math.round(range.getBoundingClientRect().top - head.getBoundingClientRect().bottom)
    }
    return out
  }, titles)

test('a section rule sits in equal space, and the space is the same in every section', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser)
  const page = ada.page
  await page.goto(PROJECT)
  await expect(page.getByRole('heading', { name: 'Insights dashboard' })).toBeVisible({ timeout: ms(20_000) })
  // Every section open, so the claim covers all of them and not just the eight
  // the resting page happens to show. Conditional rather than a swallowed click:
  // the control is ABSENT once nothing is folded (it is never an inert button),
  // and a `.catch(() => {})` would hide a real failure to press it as well.
  const organizeMenu = await openOrganizePaneMenu(page)
  const unfoldAll = organizeMenu.getByRole('menuitem', { name: 'Unfold all', exact: true })
  if ((await unfoldAll.count()) > 0) await unfoldAll.click()
  else await page.keyboard.press('Escape')
  await expect(page.locator(HEADERS + '[aria-expanded="false"]')).toHaveCount(0)

  // ── Equal above and below (owner directive 2026-08-13) ────────────────────
  //  Measured rather than read off `SECTION_RULE_SPACE`, because that constant
  //  states the pair in two different units — a padding under a button that
  //  carries its own, and a straight margin. A source scan can bless `pb-2` +
  //  `mb-3` as "12 and 12" only by re-doing the arithmetic the browser is
  //  already doing here, and if the label button's own padding ever changes, the
  //  scan keeps passing while the page goes lopsided.
  const spaces = await ruleSpace(page)
  expect(spaces.length, 'every open section reported its rule spacing').toBeGreaterThan(8)
  for (const { title, above, below } of spaces) {
    expect(above, `${title}: the gap above the rule equals the gap below (${above} vs ${below})`).toBe(below)
  }
  // …and it is ONE number down the page, not each section's own symmetry.
  expect([...new Set(spaces.map((s) => s.above))], 'one spacing, every section').toHaveLength(1)

  // ── Space it ONCE: a list must not add its own on top ─────────────────────
  //  `divide-y` draws no border above the first row, so that row's top padding
  //  is the space under a divider that is not there — and under the section's
  //  rule it landed on top of the space the section had already left. Measured
  //  before the fix: a list section put its first line 20px under the rule where
  //  a prose section put its first line at 8. The named sections are one prose
  //  and three lists; the claim is that a reader cannot tell which is which.
  const lines = await firstLineUnderRule(page, ['About', 'Contributors', 'Coordination', 'Recent sessions'])
  expect(Object.keys(lines).sort(), 'all four sections measured').toEqual(
    ['About', 'Contributors', 'Coordination', 'Recent sessions'],
  )
  //  Within a pixel, not exactly equal, and the pixel is named: a text range's
  //  rect is its LINE BOX, so prose set `leading-relaxed` (21.125px on 13px) and
  //  a row set at the default (19.5px) round to 14 and 13 from the same 12px
  //  offset. That residue is half-leading, not spacing — and the defect this
  //  replaced was 12px wide, so a 1px bound still catches it twelve times over.
  const offsets = Object.values(lines)
  expect(
    Math.max(...offsets) - Math.min(...offsets),
    `prose and lists start at one distance under the rule (${JSON.stringify(lines)})`,
  ).toBeLessThanOrEqual(1)

  await ada.context.close()
})
