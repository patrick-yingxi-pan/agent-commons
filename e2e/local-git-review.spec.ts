import { test, expect, type Locator, type Page } from '@playwright/test'
import { API } from './social-helpers.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const GIT_ID = `GIT_${'A'.repeat(32)}`
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const
const LONG_PATH = `src/${Array.from({ length: 12 }, (_, index) => `deep-${index}`).join('/')}/${'long-component-'.repeat(8)}review.txt`
const LONG_TEXT = 'Working tree body '.repeat(3600)
const DIFF_PATH = 'src/distant-edits.txt'
const PAGED_PATH = 'src/paged-review.txt'
const ENDING_PATH = 'src/line-endings.txt'
const NEWLINE_PATH = 'src/no-final-newline-change.txt'
const EMPTY_PATH = 'src/empty-added.txt'
const ADDED_PATH = 'src/new-added.txt'
const MODE_PATH = 'src/executable.sh'
const UNKNOWN_PATH = 'src/unreadable.bin'
const COMPLEX_PATH = 'src/over-complex.txt'
const SCROLL_PATH = 'src/long-changed-line.txt'
const DISTANT_HEAD = Array.from({ length: 40 }, (_, index) => `stable row ${index + 1}`).map((line, index) =>
  index === 4 ? 'old distant first' : index === 35 ? 'old distant second' : line).join('\n') + '\n'
const DISTANT_INDEX = DISTANT_HEAD.replace('old distant first', 'new distant first').replace('old distant second', 'new distant second')
const PAGED_HEAD = Array.from({ length: 230 }, (_, index) => `old page row ${index + 1}`).join('\n') + '\n'
const PAGED_INDEX = Array.from({ length: 230 }, (_, index) => `new page row ${index + 1}`).join('\n') + '\n'
const ENDING_HEAD = 'keep\r\nold ending\r\nno-final-newline'
const ENDING_INDEX = 'keep\r\nnew ending\r\nno-final-newline'
const COMPLEX_HEAD = Array.from({ length: 1100 }, (_, index) => `old complexity row ${index + 1}`).join('\n') + '\n'
const COMPLEX_INDEX = Array.from({ length: 1100 }, (_, index) => `new complexity row ${index + 1}`).join('\n') + '\n'
const SCROLL_HEAD = `before ${'long old source '.repeat(90)}\nafter context\n`
const SCROLL_INDEX = `before ${'long new target '.repeat(90)}\nafter context\n`

async function switchAccount(page: Page, optionText: string, expected: string) {
  // Narrow review preserves the user's collapsed rail when widened again.
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expand.isVisible()) await expand.click()
  await expect(page.getByTestId('account-chip')).toBeInViewport()
  await page.getByTestId('account-chip').click({ timeout: ms(10_000) })
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

async function screenshotMatrix(page: Page, testInfo: { outputPath(path: string): string }, state: string) {
  const section = page.locator('[data-local-git-review]')
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleMotion(page)
    await (state === 'code' ? section.locator('[data-text-comparison]') : section).scrollIntoViewIfNeeded()
    await expect(section).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      { message: `${state} review has no page-level horizontal scroll at ${viewport.width}px` }).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`local-git-review-${state}-${viewport.width}x${viewport.height}.png`), fullPage: false })
  }
  await page.setViewportSize(VIEWPORTS[4])
  await settleMotion(page)
}

test('local Git review stays transient, bounded, account-fenced, and usable across canonical viewports', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  await page.setViewportSize(VIEWPORTS[4])
  await page.addInitScript(({ connectionId, longPath, longText }) => {
    let harness: any
    try { harness = JSON.parse(window.name) } catch { harness = null }
    if (!harness || harness.kind !== 'local-git-review-harness') {
      harness = { kind: 'local-git-review-harness', reviewCalls: 0, snapshotCalls: 0, disconnectCalls: 0, reviewSources: [] }
    }
    const persistCounters = () => {
      window.name = JSON.stringify({
        kind: harness.kind,
        reviewCalls: harness.reviewCalls,
        snapshotCalls: harness.snapshotCalls,
        disconnectCalls: harness.disconnectCalls,
        reviewSources: harness.reviewSources,
      })
    }
    persistCounters()
    Object.defineProperty(window, '__localGitReviewHarness', { configurable: true, value: harness })
    const ready = () => ({
      version: 1, comparison: 'raw', head: { oid: 'a'.repeat(40), ref: 'refs/heads/main' },
      excludedCount: 1, unchangedCount: 2,
      files: [
        { path: 'a/staged.md', staged: 'modified', unstaged: 'unchanged',
          head: { kind: 'text', text: 'HEAD staged body\n', mode: '100644' },
          index: { kind: 'text', text: 'Index staged body\n', mode: '100755' },
          working: { kind: 'omitted', reason: 'not-needed' } },
        { path: longPath, staged: 'unchanged', unstaged: 'modified',
          head: { kind: 'omitted', reason: 'not-needed' },
          index: { kind: 'text', text: 'Index working body\n', mode: '100644' },
          working: { kind: 'text', text: longText, mode: '100644' } },
        { path: 'z/added.md', staged: 'added', unstaged: 'unchanged',
          head: { kind: 'missing' }, index: { kind: 'text', text: 'New index body\n', mode: '100644' },
          working: { kind: 'omitted', reason: 'not-needed' } },
        { path: 'z/empty.md', staged: 'added', unstaged: 'unchanged',
          head: { kind: 'missing' }, index: { kind: 'text', text: '', mode: '100644' },
          working: { kind: 'omitted', reason: 'not-needed' } },
      ],
    })
    const omitted = () => ({
      version: 1, comparison: 'raw', head: { oid: 'b'.repeat(64), ref: 'refs/heads/review' },
      excludedCount: 0, unchangedCount: 0,
      files: [{ path: 'src/unsupported.bin', staged: 'modified', unstaged: 'unavailable',
        head: { kind: 'omitted', reason: 'unsupported' },
        index: { kind: 'text', text: 'Index content is still available.\n', mode: '100644' },
        working: { kind: 'omitted', reason: 'unsupported' } }],
    })
    const empty = () => ({ version: 1, comparison: 'raw', head: { oid: 'e'.repeat(40), ref: 'refs/heads/main' },
      excludedCount: 0, unchangedCount: 1, files: [] })
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: { context: { localGit: {
        list: async (source: unknown) => {
          return (source as any)?.userId === 'user-ada'
            ? [{ id: connectionId, name: 'Review fixture', remembered: true }]
            : []
        },
        connect: async () => { throw new Error('review acceptance must not connect repositories') },
        snapshot: async () => {
          harness.snapshotCalls += 1
          persistCounters()
          throw new Error('review must not capture a saved snapshot')
        },
        disconnect: async () => {
          harness.disconnectCalls += 1
          persistCounters()
        },
        review: async (id: string, source: unknown) => {
          harness.reviewCalls += 1
          harness.reviewSources.push({ id, userId: (source as any)?.userId })
          persistCounters()
          if (harness.reviewCalls === 1 || harness.reviewCalls >= 6) return ready()
          if (harness.reviewCalls === 2) return { ...ready(), unexpected: 'private' }
          if (harness.reviewCalls === 3) return omitted()
          if (harness.reviewCalls === 4) return empty()
          if (harness.reviewCalls === 5) return await new Promise(resolve => { harness.resolvePending = resolve })
          return ready()
        },
      } } },
    })
  }, { connectionId: GIT_ID, longPath: LONG_PATH, longText: LONG_TEXT })

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
  const detail = page.locator(`[data-local-git-detail="${GIT_ID}"]`)
  const review = detail.locator('[data-local-git-review]')
  await expect(detail.getByRole('heading', { name: 'Review fixture' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__localGitReviewHarness.reviewCalls)).toBe(0)
  await expect.poll(() => page.evaluate(() => (window as any).__localGitReviewHarness.snapshotCalls)).toBe(0)
  await expect(review.getByRole('button', { name: 'Review changes', exact: true })).toBeEnabled()
  await review.getByRole('button', { name: 'Review changes', exact: true }).click()
  const result = review.locator('[data-local-git-review-result]')
  await expect(result).toBeVisible()

  const compare = result.getByLabel('Compare')
  const changedFile = result.getByLabel('Changed file')
  await compare.selectOption('staged')
  await changedFile.selectOption('z/added.md')
  await expect(result.getByRole('heading', { name: 'z/added.md', exact: true })).toBeVisible()
  await expect(result.getByText('Not present in this version.', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('local-git-review-staged-1280x800.png') })
  await changedFile.selectOption('z/empty.md')
  await expect(result.getByText('Empty file (0 bytes).', { exact: true })).toBeVisible()
  await screenshotMatrix(page, testInfo, 'empty-file')
  await compare.selectOption('unstaged')
  await changedFile.selectOption(LONG_PATH)
  await expect(result.getByRole('heading', { name: LONG_PATH, exact: true })).toBeVisible()
  await result.getByLabel('Review view').selectOption('full')
  const workingCode = result.getByLabel('Working tree · Regular file')
  await expect(workingCode).toContainText('Working tree body')
  await expect.poll(() => workingCode.evaluate((node: HTMLElement) => node.scrollWidth > node.clientWidth)).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const pageX = await page.evaluate(() => window.scrollX)
  await workingCode.focus()
  await workingCode.press('ArrowRight')
  expect(await page.evaluate(() => window.scrollX)).toBe(pageX, 'keyboard focus stays in the bounded code pane, not the page')
  await expect.poll(() => workingCode.evaluate((node: HTMLElement) => node.scrollLeft > 0)).toBe(true)
  const pathHeading = result.getByRole('heading', { name: LONG_PATH, exact: true })
  await expect.poll(() => pathHeading.evaluate((node: HTMLElement) => node.scrollWidth <= node.clientWidth)).toBe(true)
  await screenshotMatrix(page, testInfo, 'ready')
  await screenshotMatrix(page, testInfo, 'code')
  await result.getByText('Review limits and privacy', { exact: true }).click()
  await expect(result).toContainText('Omitted comparisons are not evidence of a clean repository.')
  await screenshotMatrix(page, testInfo, 'limits')
  await result.getByText('Review limits and privacy', { exact: true }).click()

  // Ordinary navigation remounts the page but preserves the same reviewed
  // result and selection; only a full document reload discards memory.
  await detail.getByRole('button', { name: /^Back to / }).click()
  await page.locator('[data-resource-page]').getByRole('button', { name: /Review fixture/ }).click()
  await expect(compare).toHaveValue('unstaged')
  await expect(changedFile).toHaveValue(LONG_PATH)
  expect(await page.evaluate(() => (window as any).__localGitReviewHarness.reviewCalls)).toBe(1)

  await page.reload()
  const reloadedDetail = page.locator(`[data-local-git-detail="${GIT_ID}"]`)
  const reloadedReview = reloadedDetail.locator('[data-local-git-review]')
  await expect(reloadedReview.locator('[data-local-git-review-result]')).toHaveCount(0)
  await expect(reloadedReview.getByRole('button', { name: 'Review changes', exact: true })).toBeVisible()

  await reloadedReview.getByRole('button', { name: 'Review changes', exact: true }).click()
  await expect(reloadedReview.getByRole('alert')).toContainText('Could not read this repository review.')
  await expect(reloadedReview.getByRole('button', { name: 'Retry review', exact: true })).toBeVisible()
  await screenshotMatrix(page, testInfo, 'error')

  await reloadedReview.getByRole('button', { name: 'Retry review', exact: true }).click()
  const omittedResult = reloadedReview.locator('[data-local-git-review-result]')
  await expect(omittedResult).toBeVisible()
  await expect(omittedResult).toContainText('Preview unavailable: unsupported file type or filesystem entry.')
  await screenshotMatrix(page, testInfo, 'omitted')
  await reloadedReview.getByRole('button', { name: 'Dismiss review', exact: true }).click()
  await expect(reloadedReview.locator('[data-local-git-review-result]')).toHaveCount(0)

  await reloadedReview.getByRole('button', { name: 'Review changes', exact: true }).click()
  const emptyResult = reloadedReview.locator('[data-local-git-review-result]')
  await expect(emptyResult).toContainText('No staged changes in the compared paths.')
  await screenshotMatrix(page, testInfo, 'empty')

  await reloadedReview.getByRole('button', { name: 'Read changes again', exact: true }).click()
  await expect(reloadedReview.getByRole('status')).toContainText('Reading bounded local changes…')
  await expect(reloadedReview.getByRole('button', { name: 'Reading changes…', exact: true })).toBeDisabled()
  await screenshotMatrix(page, testInfo, 'loading')
  await reloadedReview.getByRole('button', { name: 'Dismiss review', exact: true }).click()
  await expect(reloadedReview.getByRole('status')).toContainText('Previous read is finishing')
  await expect(reloadedReview.getByRole('button', { name: 'Review changes', exact: true })).toBeDisabled()
  await screenshotMatrix(page, testInfo, 'dismissed-pending')

  await switchAccount(page, 'Grace Hopper', 'Grace Hopper')
  await expect(page.locator('[data-local-git-review-result]')).toHaveCount(0)
  await page.evaluate(() => {
    const harness = (window as any).__localGitReviewHarness
    harness.resolvePending({ version: 1, comparison: 'raw', head: { oid: 'c'.repeat(40), ref: 'refs/heads/main' },
      excludedCount: 0, unchangedCount: 0,
      files: [{ path: 'late/private.md', staged: 'added', unstaged: 'added', head: { kind: 'missing' },
        index: { kind: 'text', text: 'late old-account result', mode: '100644' },
        working: { kind: 'text', text: 'late old-account result', mode: '100644' } }] })
  })
  await expect.poll(() => page.evaluate(() => (window as any).__localGitReviewHarness.reviewCalls)).toBe(5)
  await expect(page.locator('[data-local-git-review-result]')).toHaveCount(0)
  await expect(page.getByText('late old-account result', { exact: true })).toHaveCount(0)
  // Account switching restores that account's own workspace. Address the
  // private connection explicitly after fencing the old pending response.
  await page.goto(`/contexts/${GIT_ID}`)
  await expect(page.getByText('This repository connection is not available to this account on this device. Saved snapshots remain in their conversations.', { exact: true })).toBeVisible()

  await switchAccount(page, 'Ada Lovelace', 'Ada Lovelace')
  const ownerAgain = page.locator(`[data-local-git-detail="${GIT_ID}"]`)
  const ownerReview = ownerAgain.locator('[data-local-git-review]')
  await expect(ownerReview.getByRole('button', { name: 'Review changes', exact: true })).toBeVisible()
  await expect(ownerReview.locator('[data-local-git-review-result]')).toHaveCount(0)
  await ownerReview.getByRole('button', { name: 'Review changes', exact: true }).click()
  await expect(ownerReview.locator('[data-local-git-review-result]')).toBeVisible()
  await ownerAgain.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.getByText('This repository connection is not available to this account on this device. Saved snapshots remain in their conversations.', { exact: true })).toBeVisible()
  await expect(page.locator('[data-local-git-review-result]')).toHaveCount(0)

  const harness = await page.evaluate(() => (window as any).__localGitReviewHarness)
  expect(harness.reviewCalls).toBe(6)
  expect(harness.snapshotCalls).toBe(0, 'review never invokes saved capture')
  expect(harness.disconnectCalls).toBe(1)
  expect(harness.reviewSources).toHaveLength(6)
  expect(harness.reviewSources.every((call: any) => call.id === GIT_ID && call.userId === 'user-ada')).toBe(true)
  expect(nonAuthWrites).toEqual([], 'local review is not an HTTP mutation or persisted artifact')
  expect(modelCalls).toEqual([], 'review data never enters model or conversation requests')
  const browserStorage = await page.evaluate(() => ({
    local: Object.entries(localStorage), session: Object.entries(sessionStorage),
  }))
  expect(JSON.stringify(browserStorage)).not.toMatch(/git.?review/i)
  expect(JSON.stringify(browserStorage)).not.toMatch(/HEAD staged body|Index staged body|Working tree body|late old-account result/)
})

test('changed-line Git review preserves exact hunks, line endings, metadata, and bounded paging without rereading', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  await page.setViewportSize(VIEWPORTS[4])
  await page.addInitScript(({ connectionId, distantHead, distantIndex, pagedHead, pagedIndex, endingHead, endingIndex,
    complexHead, complexIndex, scrollHead, scrollIndex }) => {
    const harness = { reviewCalls: 0 }
    Object.defineProperty(window, '__localGitChangedLineHarness', { configurable: true, value: harness })
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: { context: { localGit: {
        list: async (source: any) => source?.userId === 'user-ada'
          ? [{ id: connectionId, name: 'Changed-line fixture', remembered: true }]
          : [],
        connect: async () => { throw new Error('changed-line review must not connect') },
        snapshot: async () => { throw new Error('changed-line review must not capture') },
        disconnect: async () => undefined,
        review: async () => {
          harness.reviewCalls++
          const files = [
              { path: 'src/distant-edits.txt', staged: 'modified', unstaged: 'unchanged',
                head: { kind: 'text', text: distantHead, mode: '100644' },
                index: { kind: 'text', text: distantIndex, mode: '100644' },
                working: { kind: 'omitted', reason: 'not-needed' } },
              { path: 'src/line-endings.txt', staged: 'modified', unstaged: 'unchanged',
                head: { kind: 'text', text: endingHead, mode: '100644' },
                index: { kind: 'text', text: endingIndex, mode: '100644' },
                working: { kind: 'omitted', reason: 'not-needed' } },
              { path: 'src/no-final-newline-change.txt', staged: 'modified', unstaged: 'unchanged',
                head: { kind: 'text', text: 'terminal line\n', mode: '100644' },
                index: { kind: 'text', text: 'terminal line', mode: '100644' },
                working: { kind: 'omitted', reason: 'not-needed' } },
              { path: 'src/empty-added.txt', staged: 'added', unstaged: 'unchanged',
                head: { kind: 'missing' }, index: { kind: 'text', text: '', mode: '100644' },
                working: { kind: 'omitted', reason: 'not-needed' } },
              { path: 'src/new-added.txt', staged: 'added', unstaged: 'unchanged',
                head: { kind: 'missing' }, index: { kind: 'text', text: 'new file body\n', mode: '100644' },
                working: { kind: 'omitted', reason: 'not-needed' } },
              { path: 'src/executable.sh', staged: 'mode-changed', unstaged: 'unchanged',
                head: { kind: 'text', text: 'same executable body\n', mode: '100644' },
                index: { kind: 'text', text: 'same executable body\n', mode: '100755' },
                working: { kind: 'omitted', reason: 'not-needed' } },
              { path: 'src/over-complex.txt', staged: 'modified', unstaged: 'unchanged',
                head: { kind: 'text', text: complexHead, mode: '100644' },
                index: { kind: 'text', text: complexIndex, mode: '100644' },
                working: { kind: 'omitted', reason: 'not-needed' } },
              { path: 'src/paged-review.txt', staged: 'modified', unstaged: 'unchanged',
                head: { kind: 'text', text: pagedHead, mode: '100644' },
                index: { kind: 'text', text: pagedIndex, mode: '100644' },
                working: { kind: 'omitted', reason: 'not-needed' } },
              { path: 'src/long-changed-line.txt', staged: 'modified', unstaged: 'unchanged',
                head: { kind: 'text', text: scrollHead, mode: '100644' },
                index: { kind: 'text', text: scrollIndex, mode: '100644' },
                working: { kind: 'omitted', reason: 'not-needed' } },
              { path: 'src/unreadable.bin', staged: 'unavailable', unstaged: 'unavailable',
                head: { kind: 'omitted', reason: 'unsupported' },
                index: { kind: 'text', text: 'available index side\n', mode: '100644' },
                working: { kind: 'omitted', reason: 'unsupported' } },
            ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
          return { version: 1, comparison: 'raw', head: { oid: 'f'.repeat(40), ref: 'refs/heads/main' },
            excludedCount: 1, unchangedCount: 0, files }
        },
      } } },
    })
  }, {
    connectionId: GIT_ID, distantHead: DISTANT_HEAD, distantIndex: DISTANT_INDEX,
    pagedHead: PAGED_HEAD, pagedIndex: PAGED_INDEX, endingHead: ENDING_HEAD, endingIndex: ENDING_INDEX,
    complexHead: COMPLEX_HEAD, complexIndex: COMPLEX_INDEX, scrollHead: SCROLL_HEAD, scrollIndex: SCROLL_INDEX,
  })

  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  const adaLogin = await page.request.post(`${API}/auth/login`, { data: { email: 'ada@acme.example', password: 'ada-demo-password' } })
  expect(adaLogin.ok(), await adaLogin.text()).toBeTruthy()
  const graceLogin = await page.request.post(`${API}/auth/login`, { data: { email: 'grace@acme.example', password: 'grace-demo-password' } })
  expect(graceLogin.ok(), await graceLogin.text()).toBeTruthy()
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await switchAccount(page, 'Ada Lovelace', 'Ada Lovelace')
  await page.goto(`/contexts/${GIT_ID}`)
  const review = page.locator('[data-local-git-review]')
  await review.getByRole('button', { name: 'Review changes', exact: true }).click()
  const result = review.locator('[data-local-git-review-result]')
  await expect(result).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__localGitChangedLineHarness.reviewCalls)).toBe(1)

  const compare = result.getByLabel('Compare')
  const changedFile = result.getByLabel('Changed file')
  await compare.selectOption('staged')
  await changedFile.selectOption(DIFF_PATH)
  const view = result.getByLabel('Review view')
  await expect(view).toHaveValue('changes')
  const changedRows = result.locator('[data-diff-lines] tr[data-diff-kind]')
  await expect(result.getByText('2 added · 2 removed', { exact: true })).toBeVisible()
  await expect(result.locator('[data-diff-hunk]'), 'far-separated edits remain separate hunks').toHaveCount(2)
  const removedFirst = changedRows.filter({ hasText: 'old distant first' })
  const addedFirst = changedRows.filter({ hasText: 'new distant first' })
  const removedSecond = changedRows.filter({ hasText: 'old distant second' })
  const addedSecond = changedRows.filter({ hasText: 'new distant second' })
  await expect(removedFirst).toHaveAttribute('data-diff-kind', 'delete')
  await expect(addedFirst).toHaveAttribute('data-diff-kind', 'add')
  await expect(removedSecond).toHaveAttribute('data-diff-kind', 'delete')
  await expect(addedSecond).toHaveAttribute('data-diff-kind', 'add')
  await expect(removedFirst.locator('td').nth(0)).toHaveText('5')
  await expect(addedFirst.locator('td').nth(1)).toHaveText('5')

  await changedFile.selectOption(PAGED_PATH)
  await expect(result.getByText('230 added · 230 removed', { exact: true })).toBeVisible()
  const pageStatus = result.getByRole('status').filter({ hasText: /^Page / })
  await expect(pageStatus).toHaveText('Page 1 of 3')
  const previousPage = result.getByRole('button', { name: 'Previous diff page', exact: true })
  const nextPage = result.getByRole('button', { name: 'Next diff page', exact: true })
  const pageRows = result.locator('[data-diff-lines] tr[data-diff-kind]')
  await expect(pageRows, 'a page mounts no more than 200 changed/context rows').toHaveCount(200)
  await expect(previousPage).toBeDisabled()
  await expect(nextPage).toBeEnabled()
  await nextPage.click()
  await expect(pageStatus).toHaveText('Page 2 of 3')
  await expect(pageRows).toHaveCount(200)
  await expect(previousPage).toBeEnabled()
  await nextPage.click()
  await expect(pageStatus).toHaveText('Page 3 of 3')
  await expect(pageRows).toHaveCount(60)
  await expect(nextPage).toBeDisabled()
  await previousPage.click()
  await expect(pageStatus).toHaveText('Page 2 of 3')
  await previousPage.click()
  await expect(pageStatus).toHaveText('Page 1 of 3')
  expect(await page.evaluate(() => (window as any).__localGitChangedLineHarness.reviewCalls),
    'view and page changes use the captured comparison without another native read').toBe(1)

  const captureMatrix = async (state: 'hunks' | 'distant' | 'paged' | 'fallback' | 'fallback-details', target: Locator) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settleMotion(page)
      const viewPicker = result.getByLabel('Review view')
      if (await viewPicker.count()) await viewPicker.scrollIntoViewIfNeeded()
      await target.scrollIntoViewIfNeeded()
      await expect(target).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        { message: `${state} review has no page-level horizontal overflow at ${viewport.width}px` }).toBe(true)
      await assertWcag22Aa(page, `Local Git ${state} review at ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: testInfo.outputPath(`local-git-review-${state}-${viewport.width}x${viewport.height}.png`), fullPage: false })
    }
    await page.setViewportSize(VIEWPORTS[4])
  }
  await changedFile.selectOption(DIFF_PATH)
  await captureMatrix('distant', result.locator('[data-diff-lines]'))
  await changedFile.selectOption(SCROLL_PATH)
  const longLineRegion = result.locator('[data-diff-lines]')
  await expect.poll(() => longLineRegion.evaluate(node => node.scrollWidth > node.clientWidth),
    { message: 'long changed lines scroll within the diff region, not the page' }).toBe(true)
  await longLineRegion.focus()
  await longLineRegion.press('ArrowRight')
  await expect.poll(() => longLineRegion.evaluate(node => node.scrollLeft > 0),
    { message: 'keyboard horizontal scrolling stays inside the changed-lines region' }).toBe(true)
  await longLineRegion.evaluate(node => { node.scrollLeft = 0 })
  await captureMatrix('hunks', longLineRegion)
  await changedFile.selectOption(PAGED_PATH)
  await expect(pageStatus).toHaveText('Page 1 of 3')
  await captureMatrix('paged', result.locator('[data-diff-lines]'))
  await page.setViewportSize(VIEWPORTS[4])
  await changedFile.selectOption(ENDING_PATH)
  await expect(result.locator('[data-diff-lines]')).toContainText('CRLF')
  await expect(result.locator('[data-diff-lines]')).toContainText('No newline at end of file')
  await changedFile.selectOption(NEWLINE_PATH)
  const newlineRows = result.locator('[data-diff-lines] tr[data-diff-kind]')
  const noFinalNewlineAddition = newlineRows.filter({ hasText: 'No newline at end of file' })
  await expect(noFinalNewlineAddition).toHaveCount(1)
  await expect(noFinalNewlineAddition).toHaveAttribute('data-diff-kind', 'add')
  await expect(result.getByText('1 added · 1 removed', { exact: true })).toBeVisible()
  await changedFile.selectOption(EMPTY_PATH)
  await expect(result.getByText('Not present in this version.', { exact: true })).toBeVisible()
  await expect(result.getByText('Empty file (0 bytes).', { exact: true })).toBeVisible()
  await expect(result.getByText('No text changes. File presence and executable mode are shown above.', { exact: true })).toBeVisible()
  await changedFile.selectOption(ADDED_PATH)
  await expect(result.getByText('Not present in this version.', { exact: true })).toBeVisible()
  await expect(result.locator('[data-diff-lines] tr[data-diff-kind="add"]')).toContainText('new file body')
  await changedFile.selectOption(MODE_PATH)
  await expect(result.getByText('HEAD · Regular file', { exact: true })).toBeVisible()
  await expect(result.getByText('Index · Executable', { exact: true })).toBeVisible()
  await expect(result.getByText('0 added · 0 removed', { exact: true })).toBeVisible()
  await expect(result.getByText('No text changes. File presence and executable mode are shown above.', { exact: true })).toBeVisible()
  await changedFile.selectOption(COMPLEX_PATH)
  await expect(result.getByText('This comparison exceeds the changed-line review limit. Full files are shown above; no changes have been summarized or omitted from those captured files.', { exact: true })).toBeVisible()
  await expect(result.getByLabel('Review view')).toHaveCount(0)
  await expect(result.locator('[data-diff-summary]')).toHaveCount(0)
  await expect(result.locator('[data-diff-lines]')).toHaveCount(0)
  await expect(result.getByLabel('HEAD · Regular file')).toContainText('old complexity row 1100')
  await expect(result.getByLabel('Index · Regular file')).toContainText('new complexity row 1100')
  await captureMatrix('fallback', result.getByLabel('HEAD · Regular file'))
  await captureMatrix('fallback-details', result.getByText('This comparison exceeds the changed-line review limit. Full files are shown above; no changes have been summarized or omitted from those captured files.', { exact: true }))
  await page.setViewportSize(VIEWPORTS[4])
  await changedFile.selectOption(UNKNOWN_PATH)
  await expect(result.getByText('Changed lines are unavailable because a comparison side was not read. Available full text is shown above.', { exact: true })).toBeVisible()
  await expect(result.getByLabel('Review view'), 'unknown content never offers a fabricated changed-lines mode').toHaveCount(0)
  await expect(result.getByLabel('Index · Regular file')).toContainText('available index side')
  expect(await page.evaluate(() => (window as any).__localGitChangedLineHarness.reviewCalls)).toBe(1)
})

async function exerciseReviewChunkFailure(page: Page, chunk: 'LocalGitReview' | 'TextDiffCode') {
  await page.addInitScript(({ connectionId }) => {
    const calls = { review: 0, snapshot: 0 }
    ;(window as any).__localGitReviewFailureCalls = calls
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: { context: { localGit: {
        list: async (source: any) => source?.userId === 'user-ada'
          ? [{ id: connectionId, name: 'Review failure fixture', remembered: true }]
          : [],
        connect: async () => { throw new Error('failure fixture must not connect') },
        snapshot: async () => { calls.snapshot += 1; throw new Error('failure fixture must not snapshot') },
        disconnect: async () => undefined,
        review: async () => {
          calls.review += 1
          return { version: 1, comparison: 'raw', head: { oid: 'd'.repeat(40), ref: 'refs/heads/main' },
            excludedCount: 0, unchangedCount: 0,
            files: [{ path: 'src/review.ts', staged: 'modified', unstaged: 'modified',
              head: { kind: 'text', text: 'before\n', mode: '100644' },
              index: { kind: 'text', text: 'after\n', mode: '100644' },
              working: { kind: 'text', text: 'after working\n', mode: '100644' } }] }
        },
      } } },
    })
  }, { connectionId: GIT_ID })
  await page.route(`**/src/components/${chunk}.tsx*`, route => route.abort('failed'))
  await page.goto(`/contexts/${GIT_ID}`)
  if (chunk === 'TextDiffCode') {
    await expect(page.getByRole('heading', { name: 'Review failure fixture' })).toBeVisible()
    await page.getByRole('button', { name: 'Review changes', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Local repository', exact: true })).toBeVisible()
  }
  await expect(page.getByText('Couldn’t load local repository controls. Saved snapshots are unchanged. Reload discards in-memory reviews; copy unsent text first.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload controls', exact: true })).toBeVisible()
  const back = page.getByRole('button', { name: /^Back to / })
  await expect(back).toHaveCount(1)
  const calls = await page.evaluate(() => (window as any).__localGitReviewFailureCalls)
  expect(calls).toEqual({ review: chunk === 'TextDiffCode' ? 1 : 0, snapshot: 0 })
  await back.click()
  await expect(page).not.toHaveURL(new RegExp(GIT_ID))
  expect(await page.evaluate(() => (window as any).__localGitReviewFailureCalls)).toEqual(calls)
}

test('failed local Git review chunk keeps navigation and does not read natively', async ({ page }) => {
  await exerciseReviewChunkFailure(page, 'LocalGitReview')
})

test('failed local Git diff chunk keeps navigation without retrying repository reads', async ({ page }) => {
  await exerciseReviewChunkFailure(page, 'TextDiffCode')
})
