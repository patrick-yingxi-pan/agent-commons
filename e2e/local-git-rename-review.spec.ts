import { test, expect, type Page } from '@playwright/test'
import { API } from './social-helpers.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const GIT_ID = `GIT_${'B'.repeat(32)}`
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

const EXACT_OLD = 'archive/old-notes.md'
const EXACT_NEW = 'docs/current-notes.md'
const EDITED_OLD = 'src/legacy/renderer.ts'
const EDITED_NEW = 'src/ui/renderer.ts'
const AMBIGUOUS_OLD = 'archive/ambiguous.md'
const AMBIGUOUS_NEW_A = 'docs/copy-a.md'
const AMBIGUOUS_NEW_B = 'docs/copy-b.md'
const OMITTED_OLD = 'archive/unreadable.md'
const OMITTED_NEW = 'docs/unavailable-match.md'
const LONG_OLD = `archive/${Array.from({ length: 8 }, (_, index) => `old-section-${index}`).join('/')}/${'historical-renderer-'.repeat(5)}.ts`
const LONG_NEW = `src/${Array.from({ length: 8 }, (_, index) => `current-section-${index}`).join('/')}/${'replacement-renderer-'.repeat(5)}.ts`

const EXACT_TEXT = 'A note captured before moving.\nKeep this exact body.\n'
const AMBIGUOUS_TEXT = 'Same source text with two plausible destinations.\n'
const stableLines = Array.from({ length: 5 }, (_, index) => `stable-${index} ${'line-content-'.repeat(5)}`)
const EDITED_OLD_TEXT = [...stableLines, `old implementation ${'before-'.repeat(4)}`].join('\n') + '\n'
const EDITED_NEW_TEXT = [...stableLines, `new implementation ${'after-'.repeat(4)}`].join('\n') + '\n'
const LONG_TEXT = [...stableLines.map(line => `independent long-file ${line}`), 'long-path source body'].join('\n') + '\n'

async function switchAccount(page: Page, optionText: string, expected: string) {
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expand.isVisible()) await expand.click()
  await expect(page.getByTestId('account-chip')).toBeInViewport()
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: optionText }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText(expected, { timeout: ms(5_000) })
}

async function settleMotion(page: Page) {
  await page.evaluate(async () => {
    const animations = document.getAnimations().filter(animation => {
      const endTime = animation.effect?.getComputedTiming().endTime
      return typeof endTime === 'number' && Number.isFinite(endTime)
    })
    await Promise.allSettled(animations.map(animation => animation.finished))
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
}

test('captured staged review groups only confident rename suggestions without changing raw or unstaged review', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  await page.setViewportSize(VIEWPORTS[4])
  const fixture = {
    connectionId: GIT_ID,
    paths: { exactOld: EXACT_OLD, exactNew: EXACT_NEW, editedOld: EDITED_OLD, editedNew: EDITED_NEW,
      ambiguousOld: AMBIGUOUS_OLD, ambiguousNewA: AMBIGUOUS_NEW_A, ambiguousNewB: AMBIGUOUS_NEW_B,
      omittedOld: OMITTED_OLD, omittedNew: OMITTED_NEW, longOld: LONG_OLD, longNew: LONG_NEW },
    bodies: { exact: EXACT_TEXT, ambiguous: AMBIGUOUS_TEXT, editedOld: EDITED_OLD_TEXT, editedNew: EDITED_NEW_TEXT,
      longOld: LONG_TEXT, longNew: LONG_TEXT.replace('long-path source body', `long-path changed body ${'new-value-'.repeat(4)}`) },
  }
  await page.addInitScript(({ connectionId, paths, bodies }) => {
    const harness = { reviewCalls: 0, snapshotCalls: 0, connectCalls: 0, disconnectCalls: 0 }
    Object.defineProperty(window, '__localGitRenameReviewHarness', { configurable: true, value: harness })
    const text = (body: string) => ({ kind: 'text', text: body, mode: '100644' })
    const missing = { kind: 'missing' }
    const omitted = { kind: 'omitted', reason: 'budget' }
    const unchanged = { kind: 'omitted', reason: 'not-needed' }
    const deleted = (path: string, body: string) => ({ path, staged: 'deleted', unstaged: 'unchanged',
      head: text(body), index: missing, working: missing })
    const added = (path: string, body: string, working = body) => ({ path, staged: 'added',
      unstaged: working === body ? 'unchanged' : 'modified', head: missing, index: text(body),
      working: working === body ? unchanged : text(working) })
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: { context: { localGit: {
        list: async (source: any) => source?.userId === 'user-ada'
          ? [{ id: connectionId, name: 'Rename review fixture', remembered: true }]
          : [],
        connect: async () => { harness.connectCalls += 1; throw new Error('rename review must not connect') },
        snapshot: async () => { harness.snapshotCalls += 1; throw new Error('rename review must not capture') },
        disconnect: async () => { harness.disconnectCalls += 1 },
        review: async () => {
          harness.reviewCalls += 1
          return { version: 1, comparison: 'raw', head: { oid: '9'.repeat(40), ref: 'refs/heads/main' },
            excludedCount: 2, unchangedCount: 0,
            files: [
              deleted(paths.exactOld, bodies.exact),
              added(paths.exactNew, bodies.exact, 'Destination working tree edit.\n'),
              deleted(paths.editedOld, bodies.editedOld),
              added(paths.editedNew, bodies.editedNew),
              deleted(paths.ambiguousOld, bodies.ambiguous),
              added(paths.ambiguousNewA, bodies.ambiguous),
              added(paths.ambiguousNewB, bodies.ambiguous),
              { path: paths.omittedOld, staged: 'unavailable', unstaged: 'unchanged',
                head: omitted, index: missing, working: missing },
              added(paths.omittedNew, 'This text resembles an unreadable source, but cannot prove a move.'),
              deleted(paths.longOld, bodies.longOld),
              added(paths.longNew, bodies.longNew),
            ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
          }
        },
      } } },
    })
  }, fixture)

  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  const adaLogin = await page.request.post(`${API}/auth/login`, { data: { email: 'ada@acme.example', password: 'ada-demo-password' } })
  expect(adaLogin.ok(), await adaLogin.text()).toBeTruthy()
  const graceLogin = await page.request.post(`${API}/auth/login`, { data: { email: 'grace@acme.example', password: 'grace-demo-password' } })
  expect(graceLogin.ok(), await graceLogin.text()).toBeTruthy()
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await switchAccount(page, 'Ada Lovelace', 'Ada Lovelace')

  const nonAuthWrites: string[] = []
  const modelCalls: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/v1/') || ['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return
    if (url.pathname.startsWith('/api/v1/auth/')) return
    nonAuthWrites.push(`${request.method()} ${url.pathname}`)
    if (/sessions\/[^/]+\/(?:turns|messages)|model/i.test(url.pathname)) modelCalls.push(request.url())
  })

  await page.goto(`/contexts/${GIT_ID}`)
  const review = page.locator('[data-local-git-review]')
  await expect(review.getByRole('button', { name: 'Review changes', exact: true })).toBeEnabled()
  await review.getByRole('button', { name: 'Review changes', exact: true }).click()
  const result = review.locator('[data-local-git-review-result]')
  await expect(result).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__localGitRenameReviewHarness.reviewCalls)).toBe(1)

  const compare = result.getByLabel('Compare')
  const changedFile = result.getByLabel('Changed file')
  await compare.selectOption('staged')
  const grouping = result.getByRole('checkbox', { name: /^Group possible renames/ })
  await expect(grouping).not.toBeChecked()
  await changedFile.selectOption(EDITED_OLD)
  await expect(result.getByRole('heading', { name: EDITED_OLD, exact: true })).toBeVisible()
  await grouping.check()
  await expect(grouping).toBeChecked()
  await expect(result.getByRole('heading', { name: `Possible rename: ${EDITED_OLD} → ${EDITED_NEW}`, exact: true })).toBeVisible()
  await expect(result.locator('[data-git-rename-match]')).toContainText(/\d+% shared line bytes/)
  const similarity = await result.locator('[data-git-rename-match]').textContent()
  expect(Number(similarity?.match(/\d+/)?.[0])).toBeGreaterThanOrEqual(80)
  const editedRows = result.locator('[data-diff-lines] tr[data-diff-kind]')
  await expect(editedRows.filter({ hasText: 'old implementation' })).toHaveAttribute('data-diff-kind', 'delete')
  await expect(editedRows.filter({ hasText: 'new implementation' })).toHaveAttribute('data-diff-kind', 'add')
  await result.getByLabel('Review view').selectOption('full')
  await expect(result.getByLabel(`HEAD · ${EDITED_OLD} · Regular file`)).toContainText(stableLines[0])
  await expect(result.getByLabel(`Index · ${EDITED_NEW} · Regular file`)).toContainText(stableLines[0])

  const changedOptions = changedFile.locator('option')
  await expect(changedOptions.filter({ hasText: /Possible rename/ })).toHaveCount(3)
  await expect(changedOptions.filter({ hasText: new RegExp(`${AMBIGUOUS_OLD}.*Possible rename`) })).toHaveCount(0)
  await expect(changedOptions.filter({ hasText: new RegExp(`${OMITTED_OLD}.*Possible rename`) })).toHaveCount(0)
  await expect(changedOptions.filter({ hasText: new RegExp(`${LONG_OLD}.*→.*${LONG_NEW}.*Possible rename`) })).toHaveCount(1)

  await changedFile.selectOption(EXACT_NEW)
  await expect(result.getByRole('heading', { name: `Possible rename: ${EXACT_OLD} → ${EXACT_NEW}`, exact: true })).toBeVisible()
  await expect(result.getByText(/Identical captured text/)).toBeVisible()
  await changedFile.selectOption(LONG_NEW)
  await expect(result.getByRole('heading', { name: `Possible rename: ${LONG_OLD} → ${LONG_NEW}`, exact: true })).toBeVisible()
  await expect(result.locator('[data-git-rename-match]')).toContainText(/\d+% shared line bytes/)
  const changedRows = result.locator('[data-diff-lines] tr[data-diff-kind]')
  await expect(changedRows.filter({ hasText: 'long-path source body' })).toHaveAttribute('data-diff-kind', 'delete')
  await expect(changedRows.filter({ hasText: 'long-path changed body' })).toHaveAttribute('data-diff-kind', 'add')
  await result.getByLabel('Review view').selectOption('full')
  const longBefore = result.getByLabel(`HEAD · ${LONG_OLD} · Regular file`)
  const longAfter = result.getByLabel(`Index · ${LONG_NEW} · Regular file`)
  await expect(longBefore).toContainText('long-path source body')
  await expect(longAfter).toContainText('long-path changed body')
  const section = review.locator('[data-local-git-review-result]')
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleMotion(page)
    await longBefore.scrollIntoViewIfNeeded()
    await expect(longBefore).toBeVisible()
    await expect(longAfter).toContainText('long-path changed body')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      { message: `grouped rename review has no page-level horizontal overflow at ${viewport.width}px` }).toBe(true)
    await expect.poll(() => result.locator('[data-text-comparison] p').evaluateAll(nodes =>
      nodes.every(node => node.scrollWidth <= node.clientWidth)),
    { message: `captured side labels wrap without clipping at ${viewport.width}px` }).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`local-git-rename-review-head-${viewport.width}x${viewport.height}.png`), fullPage: false })
    await longAfter.scrollIntoViewIfNeeded()
    await expect(longAfter).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`local-git-rename-review-index-${viewport.width}x${viewport.height}.png`), fullPage: false })
    await assertWcag22Aa(page, `Local Git rename review at ${viewport.width}x${viewport.height}`)
  }
  await page.setViewportSize(VIEWPORTS[4])
  await expect(section).toBeVisible()

  await changedFile.selectOption(EDITED_NEW)
  await expect(result.getByRole('heading', { name: `Possible rename: ${EDITED_OLD} → ${EDITED_NEW}`, exact: true })).toBeVisible()
  await result.getByLabel('Review view').selectOption('changes')
  const shortDiff = result.locator('[data-diff-lines]')
  await expect(shortDiff.locator('tr[data-diff-kind="delete"]').filter({ hasText: 'old implementation' })).toBeVisible()
  await expect(shortDiff.locator('tr[data-diff-kind="add"]').filter({ hasText: 'new implementation' })).toBeVisible()
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleMotion(page)
    await shortDiff.scrollIntoViewIfNeeded()
    await expect(shortDiff).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      { message: `edited rename diff has no page-level horizontal overflow at ${viewport.width}px` }).toBe(true)
    await expect.poll(() => result.locator('[data-text-comparison] p').evaluateAll(nodes =>
      nodes.every(node => node.scrollWidth <= node.clientWidth)),
    { message: `edited rename labels stay contained at ${viewport.width}px` }).toBe(true)
    await assertWcag22Aa(page, `Local Git edited rename diff at ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`local-git-rename-review-edited-diff-${viewport.width}x${viewport.height}.png`), fullPage: false })
  }
  await page.setViewportSize(VIEWPORTS[4])

  // Grouping is a projection over the captured raw rows: opt-out restores both
  // source rows, and an already selected delete stays paired with its own add.
  await grouping.uncheck()
  await expect(result.getByRole('heading', { name: EDITED_NEW, exact: true })).toBeVisible()
  await expect(changedOptions.filter({ hasText: EDITED_OLD })).toHaveCount(1)
  await expect(changedOptions.filter({ hasText: EDITED_NEW })).toHaveCount(1)
  const rawOptionLabels = await changedOptions.allTextContents()
  expect(rawOptionLabels.some(label => label.includes(AMBIGUOUS_OLD))).toBe(true,
    'ambiguous duplicate-source content remains a raw delete')
  expect(rawOptionLabels.some(label => label.includes(AMBIGUOUS_NEW_A))).toBe(true)
  expect(rawOptionLabels.some(label => label.includes(AMBIGUOUS_NEW_B))).toBe(true)
  expect(rawOptionLabels.some(label => label.includes(OMITTED_OLD))).toBe(true,
    'an omitted source remains visible as an unpaired raw change')
  await changedFile.selectOption(EDITED_OLD)
  await expect(result.getByRole('heading', { name: EDITED_OLD, exact: true })).toBeVisible()
  await grouping.check()
  await expect(result.getByRole('heading', { name: `Possible rename: ${EDITED_OLD} → ${EDITED_NEW}`, exact: true })).toBeVisible()

  // The destination's working tree remains an independent unstaged comparison.
  await compare.selectOption('unstaged')
  await changedFile.selectOption(EXACT_NEW)
  await expect(result.getByRole('heading', { name: EXACT_NEW, exact: true })).toBeVisible()
  await result.getByLabel('Review view').selectOption('full')
  await expect(result.getByLabel('Index · Regular file')).toContainText(EXACT_TEXT)
  await expect(result.getByLabel('Working tree · Regular file')).toContainText('Destination working tree edit.')
  expect(await page.evaluate(() => (window as any).__localGitRenameReviewHarness.reviewCalls)).toBe(1,
    'grouping and comparison selection reuse the single captured native review')

  await compare.selectOption('staged')
  await expect(grouping).toBeChecked()
  await review.getByRole('button', { name: 'Read changes again', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__localGitRenameReviewHarness.reviewCalls)).toBe(2)
  await expect(result).toBeVisible()
  await expect(grouping).not.toBeChecked()
  await changedFile.selectOption(EDITED_OLD)
  await grouping.check()
  await expect(result.getByRole('heading', { name: /^Possible rename:/ })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__localGitRenameReviewHarness.reviewCalls)).toBe(2,
    'toggling grouping after reread does not perform another native read')
  await review.getByRole('button', { name: 'Dismiss review', exact: true }).click()
  await expect(review.locator('[data-local-git-review-result]')).toHaveCount(0)
  await review.getByRole('button', { name: 'Review changes', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__localGitRenameReviewHarness.reviewCalls)).toBe(3)
  await expect(result).toBeVisible()
  await expect(result.getByRole('checkbox', { name: /^Group possible renames/ })).not.toBeChecked()

  const harness = await page.evaluate(() => (window as any).__localGitRenameReviewHarness)
  expect(harness.reviewCalls).toBe(3, 'one initial read, one explicit reread, and one read after dismiss')
  expect(harness.snapshotCalls).toBe(0, 'rename suggestions never create a saved snapshot')
  expect(harness.connectCalls).toBe(0)
  expect(harness.disconnectCalls).toBe(0)
  expect(nonAuthWrites).toEqual([], 'rename review creates no product or server mutations')
  expect(modelCalls).toEqual([], 'captured file text never enters conversation or model requests')
})
