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
import { newUser } from './social-helpers.ts'

/** A project with everything on it: sessions, a discussion, a live grant, two
 *  routines, four contexts. A quiet project would let a half-rendered page pass. */
const PROJECT = '/projects/p-insights'

/** The five configuration sections, and the seven the page is FOR. Written out
 *  because this is the owner's decision being locked, not a fact derived from
 *  the source — the source-level version of the same split lives in
 *  `src/components/main-column-sections.test.ts`, and two independent statements
 *  of one decision is exactly how a decision stops being enforced. Here it is
 *  asserted through what a signed-in reader actually SEES. */
const CONFIG = ['Instructions', 'Sharing', 'Delegation', 'Scheduled', 'Context']
const CONTENT = ['About', 'Recent sessions', 'Changes', 'Discussion', 'Contributors', 'Coordination', 'Open work']

/** Every section header on the page — the disclosure buttons, and only those.
 *
 *  A direct-child path rather than a descendant sweep, because the Discussion
 *  section holds a THREAD and every post caret in it carries `aria-expanded`
 *  too. */
const HEADERS = 'section.group\\/section > div > button[aria-expanded]'

/** One section's fold toggle, by its visible name.
 *
 *  Located through `HEADERS` and not by accessible name alone: the RAIL has a
 *  Scheduled pane whose routine rows are buttons named "Scheduled", and a
 *  `getByRole` over the document resolved to one of those — a locator that fails
 *  against a perfectly correct page, which is the second one this spec has had.
 *  The lesson is the same both times: this app's chrome shares vocabulary with
 *  its content, so a page-level claim needs a page-level scope. */
const header = (page: import('@playwright/test').Page, title: string) =>
  page.locator(HEADERS).filter({ hasText: new RegExp(`^${title}$`, 'i') })

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

  await ada.context.close()
})

test('Fold all · Unfold all act on the whole page, and the posture survives a reload', async ({ browser }) => {
  test.setTimeout(ms(120_000))
  const ada = await newUser(browser)
  const page = ada.page
  await page.goto(PROJECT)
  await expect(page.getByRole('heading', { name: 'Insights dashboard' })).toBeVisible({ timeout: ms(20_000) })

  // `exact` names, and they carry the word "sections": the Discussion section
  // holds a THREAD, and a thread has its own Fold all over its posts. Two
  // controls at different scopes must not share one accessible name — and
  // Playwright matches by substring, so "Unfold all" contains "Fold all" here
  // exactly as it did in the thread.
  const foldAll = page.getByRole('button', { name: 'Fold all sections', exact: true })
  const unfoldAll = page.getByRole('button', { name: 'Unfold all sections', exact: true })
  const expanded = () => page.locator(`${HEADERS}[aria-expanded="true"]`)

  // Both live at rest: configuration is folded (Unfold all has work) and content
  // is open (Fold all has work). That is the state a single `allFolded` toggle
  // cannot represent, which is why this is two buttons — SOCIAL-21's rule,
  // adopted here rather than re-learned.
  await expect(foldAll).toBeVisible()
  await expect(unfoldAll).toBeVisible()

  await foldAll.click()
  await expect(expanded()).toHaveCount(0)
  // …and Fold all now has nothing to do, so it is GONE rather than sitting inert
  // beside the one control that means something.
  await expect(foldAll).toHaveCount(0)
  await expect(unfoldAll).toBeVisible()

  // ── The posture is a PREFERENCE, so it survives the trip ──────────────────
  //  This is the half `node --test` cannot see: `uiPrefs` guards its own
  //  storage and returns the default where there is none, so a node run reads
  //  every section as its declared default and would pass over a persistence
  //  layer that never wrote anything.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Insights dashboard' })).toBeVisible({ timeout: ms(20_000) })
  await expect(expanded()).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Unfold all sections', exact: true })).toBeVisible()

  // Unfold all is the way back out of the state Fold all put the page in — the
  // dead end that forced the thread's pair apart, checked here on the page.
  await page.getByRole('button', { name: 'Unfold all sections', exact: true }).click()
  const count = await page.locator(HEADERS).count()
  await expect(expanded()).toHaveCount(count)
  await expect(page.getByRole('button', { name: 'Unfold all sections', exact: true })).toHaveCount(0)

  await ada.context.close()
})
