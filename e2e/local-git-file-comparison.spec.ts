import { test, expect, type Locator, type Page } from '@playwright/test'
import { startMessagesFixture } from './attachment-endpoint.ts'
import { API, createProject } from './social-helpers.ts'
import { ms } from './budget.ts'
import { settledNarrowRail, settledOpaquePaint, assertWcag22Aa } from './accessibility-helpers.ts'

const GIT_ID = `GIT_${'D'.repeat(32)}`
const NAME = 'Selected file comparison fixture'
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

async function signIntoAdaAndGrace(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  const ada = await page.request.post(`${API}/auth/login`, { data: { email: 'ada@acme.example', password: 'ada-demo-password' } })
  expect(ada.ok(), await ada.text()).toBeTruthy()
  const grace = await page.request.post(`${API}/auth/login`, { data: { email: 'grace@acme.example', password: 'grace-demo-password' } })
  expect(grace.ok(), await grace.text()).toBeTruthy()
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await switchAccount(page, 'Ada Lovelace', 'Ada Lovelace')
}

async function switchAccount(page: Page, optionText: string, expected: string) {
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expand.isVisible()) await expand.click()
  await expect(page.getByTestId('account-chip')).toBeInViewport()
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: optionText }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText(expected, { timeout: ms(5_000) })
}

async function installComparisonFixture(page: Page) {
  await page.addInitScript(({ connectionId, name }) => {
    const harness: any = {
      reviewCalls: 0,
      snapshotCalls: 0,
      fileRequests: [],
      cancellations: [],
      pending: Object.create(null),
      retryCalls: 0,
      persistText: 'CAPTURED_BEFORE_ATTACH_91AF',
    }
    Object.defineProperty(window, '__localGitFileComparisonHarness', { configurable: true, value: harness })
    const head = { oid: 'a'.repeat(40), ref: 'refs/heads/main' }
    const text = (value: string) => ({ kind: 'text', text: value, mode: '100644' })
    const ready = (path: string, comparison: 'staged' | 'unstaged', change: string,
      before: any, after: any) => ({ version: 1, scope: 'file-comparison', path, comparison, head, status: 'ready', change, before, after })
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: { context: { localGit: {
        list: async (source: any) => source?.userId === 'user-ada'
          ? [{ id: connectionId, name, remembered: true }]
          : [],
        connect: async () => { throw new Error('selected-file comparison does not connect a repository') },
        snapshot: async () => { harness.snapshotCalls++; throw new Error('comparison must not capture a whole-repository snapshot') },
        disconnect: async () => undefined,
        review: async () => { harness.reviewCalls++; throw new Error('fixture exceeds whole-review path budget') },
        fileComparison: async (id: string, request: any, source: any) => {
          if (id !== connectionId || source?.userId !== 'user-ada') throw new Error('selected comparison must retain its account and connection scope')
          harness.fileRequests.push({ id, ...request, userId: source.userId })
          if (request.scope !== 'file-comparison' || !request.operationId || !['staged', 'unstaged'].includes(request.comparison) || typeof request.path !== 'string') {
            throw new Error('fixture accepts only the closed one-file comparison request')
          }
          const { path, comparison } = request
          if (path === 'src/retry.txt' && harness.retryCalls++ === 0) throw new Error('temporary native read failure')
          if (path.startsWith('src/late-')) return await new Promise(resolve => { harness.pending[path] = resolve })
          if (path === 'src/deleted-in-head.txt') return ready(path, comparison, 'deleted', text('HEAD-only captured body\n'), { kind: 'missing' })
          if (path === 'src/empty-added.txt') return ready(path, comparison, 'added', { kind: 'missing' }, text(''))
          if (path === 'src/unchanged.txt') return ready(path, comparison, 'unchanged', text('same captured text\n'), text('same captured text\n'))
          if (path === 'src/omitted.txt') return ready(path, comparison, 'modified', { kind: 'omitted', reason: 'unsupported' }, text('Available index side\n'))
          if (path === 'src/ignored.txt') return ({ version: 1, scope: 'file-comparison', path, comparison, head, status: 'unavailable', reason: 'ignored' })
          if (path === 'src/retry.txt') return ready(path, comparison, 'modified', text('retry before\n'), text('retry after\n'))
          if (path === 'src/persist.json') return ready(path, comparison, 'unavailable', { kind: 'omitted', reason: 'unsupported' }, text(harness.persistText))
          return ready(path, comparison, 'modified', text('selected before\n'), text(`selected after: ${path}\n`))
        },
        cancelFileComparison: async (id: string, request: any, source: any) => {
          harness.cancellations.push({ id, ...request, userId: source?.userId })
        },
      } } },
    })
  }, { connectionId: GIT_ID, name: NAME })
}

async function enterCanonicalComparison(page: Page) {
  await page.goto(`/contexts/${GIT_ID}`)
  const detail = page.locator(`[data-local-git-detail="${GIT_ID}"]`)
  await expect(detail.getByRole('heading', { name: NAME, exact: true })).toBeVisible()
  const compare = detail.locator('[data-local-git-file-comparison]')
  await expect(compare.getByRole('heading', { name: 'Compare one tracked file', exact: true })).toBeVisible()
  return { detail, compare }
}

async function comparePath(compare: Locator, path: string, direction: 'staged' | 'unstaged' = 'staged') {
  const readsBeforeEdit = await compare.page().evaluate(() => (window as any).__localGitFileComparisonHarness.fileRequests.length)
  await compare.getByLabel('Repository-relative path', { exact: true }).fill(path)
  await compare.getByRole('combobox', { name: 'Comparison direction', exact: true }).selectOption(direction)
  expect(await compare.page().evaluate(() => (window as any).__localGitFileComparisonHarness.fileRequests.length),
    'editing the draft path/direction is not itself a native read').toBe(readsBeforeEdit)
  await compare.getByRole('button', { name: /^(Compare file|Retry file comparison)$/ }).click()
}

test('single-file comparison stays available past the whole-review cap, preserves sides, cancels stale reads, and fits five viewports', async ({ page }, info) => {
  test.setTimeout(ms(120_000))
  await page.setViewportSize(VIEWPORTS[4])
  await installComparisonFixture(page)
  await signIntoAdaAndGrace(page)
  const { detail, compare } = await enterCanonicalComparison(page)

  const review = detail.locator('[data-local-git-review]')
  await review.getByRole('button', { name: 'Review changes', exact: true }).click()
  await expect(review.getByRole('alert')).toContainText('Could not read this repository review.')
  await expect(compare.getByLabel('Repository-relative path', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__localGitFileComparisonHarness.reviewCalls)).toBe(1)

  await comparePath(compare, 'src/deleted-in-head.txt')
  let result = compare.locator('[data-local-git-file-comparison-result]')
  await expect(result.getByText('HEAD-only captured body', { exact: true })).toBeVisible()
  await expect(result.getByText('Not present in this version.', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__localGitFileComparisonHarness.fileRequests.at(-1))).toMatchObject({
    id: GIT_ID, scope: 'file-comparison', path: 'src/deleted-in-head.txt', comparison: 'staged', userId: 'user-ada',
  })
  expect(await page.evaluate(() => Object.keys((window as any).__localGitFileComparisonHarness.fileRequests[0]).sort())).toEqual(
    ['comparison', 'id', 'operationId', 'path', 'scope', 'userId'].sort(), 'the native bridge receives only one explicit path/direction plus its opaque operation identity')

  await comparePath(compare, 'src/empty-added.txt')
  result = compare.locator('[data-local-git-file-comparison-result]')
  await expect(result.getByText('Not present in this version.', { exact: true })).toBeVisible()
  await expect(result.getByText('Empty file (0 bytes).', { exact: true })).toBeVisible()

  await comparePath(compare, 'src/unchanged.txt', 'unstaged')
  result = compare.locator('[data-local-git-file-comparison-result]')
  await expect(result.getByText('This captured path is unchanged in the selected direction.', { exact: true })).toBeVisible()
  await expect(result.getByText('No text changes. File presence and executable mode are shown above.', { exact: true })).toBeVisible()

  await comparePath(compare, 'src/omitted.txt')
  result = compare.locator('[data-local-git-file-comparison-result]')
  await expect(result.getByText('Preview unavailable: unsupported file type or filesystem entry.', { exact: true })).toBeVisible()
  await expect(result.getByText('Available index side', { exact: true })).toBeVisible()

  await comparePath(compare, 'src/ignored.txt')
  result = compare.locator('[data-local-git-file-comparison-result]')
  await expect(result.getByText('This path is ignored by Git and is not compared.', { exact: true })).toBeVisible()
  await expect(result.locator('[data-text-comparison]')).toHaveCount(0, 'unavailable is not rendered as a fabricated empty diff')

  await comparePath(compare, 'src/retry.txt')
  await expect(compare.getByRole('alert')).toContainText('Could not compare this file.')
  await expect(compare.getByRole('button', { name: 'Retry file comparison', exact: true })).toBeVisible()
  await compare.getByRole('button', { name: 'Retry file comparison', exact: true }).click()
  result = compare.locator('[data-local-git-file-comparison-result]')
  await expect(result.getByText('retry before', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__localGitFileComparisonHarness.retryCalls)).toBe(2)

  // Dismiss cancels the native operation. A late host response cannot restore
  // the dismissed output or leave it available for Attach.
  await comparePath(compare, 'src/late-dismiss.txt')
  await expect(compare.getByRole('button', { name: 'Comparing file…', exact: true })).toBeDisabled()
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__localGitFileComparisonHarness.pending['src/late-dismiss.txt']))).toBe(true)
  await compare.getByRole('button', { name: 'Dismiss comparison', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__localGitFileComparisonHarness.cancellations.length)).toBe(1)
  await page.evaluate(() => (window as any).__localGitFileComparisonHarness.pending['src/late-dismiss.txt']({
    version: 1, scope: 'file-comparison', path: 'src/late-dismiss.txt', comparison: 'staged',
    head: { oid: 'a'.repeat(40), ref: 'refs/heads/main' }, status: 'ready', change: 'deleted',
    before: { kind: 'text', text: 'late-dismiss-private', mode: '100644' }, after: { kind: 'missing' },
  }))
  await expect(compare.locator('[data-local-git-file-comparison-result]')).toHaveCount(0)
  await expect(page.getByText('late-dismiss-private', { exact: true })).toHaveCount(0)

  // Replacing the typed path aborts the pending request before a new Compare.
  await comparePath(compare, 'src/late-replaced.txt')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__localGitFileComparisonHarness.pending['src/late-replaced.txt']))).toBe(true)
  await compare.getByLabel('Repository-relative path', { exact: true }).fill('src/after-replacement.txt')
  await expect.poll(() => page.evaluate(() => (window as any).__localGitFileComparisonHarness.cancellations.length)).toBe(2)
  await page.evaluate(() => (window as any).__localGitFileComparisonHarness.pending['src/late-replaced.txt']({
    version: 1, scope: 'file-comparison', path: 'src/late-replaced.txt', comparison: 'staged',
    head: { oid: 'a'.repeat(40), ref: 'refs/heads/main' }, status: 'ready', change: 'deleted',
    before: { kind: 'text', text: 'late-replaced-private', mode: '100644' }, after: { kind: 'missing' },
  }))
  await expect(page.getByText('late-replaced-private', { exact: true })).toHaveCount(0)
  await compare.getByRole('button', { name: 'Compare file', exact: true }).click()
  result = compare.locator('[data-local-git-file-comparison-result]')
  await expect(result.getByText('selected after: src/after-replacement.txt', { exact: true })).toBeVisible()

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settledNarrowRail(page)
    await compare.scrollIntoViewIfNeeded()
    await expect(compare.getByLabel('Repository-relative path', { exact: true })).toBeVisible()
    await expect(compare.getByRole('button', { name: 'Compare file', exact: true })).toBeInViewport()
    await settledOpaquePaint(compare)
    const geometry = await compare.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, width: rect.width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }
    })
    expect(geometry.width, `comparison panel is rendered at ${viewport.width}px`).toBeGreaterThan(0)
    expect(geometry.left, `comparison panel stays inside the viewport at ${viewport.width}px`).toBeGreaterThanOrEqual(-1)
    expect(geometry.right, `comparison panel stays inside the viewport at ${viewport.width}px`).toBeLessThanOrEqual(viewport.width + 1)
    expect(geometry.scrollWidth, `comparison panel has no horizontal overflow at ${viewport.width}px`).toBeLessThanOrEqual(geometry.clientWidth)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      { message: `single-file comparison has no page-level horizontal overflow at ${viewport.width}px` }).toBe(true)
    await page.screenshot({ path: info.outputPath(`local-git-file-comparison-${viewport.width}x${viewport.height}.png`), fullPage: false })
  }
  await page.setViewportSize(VIEWPORTS[4])

  // Account disposal cancels a pending read and prevents private late content
  // from appearing in the next account's workspace.
  await comparePath(compare, 'src/late-account.txt')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__localGitFileComparisonHarness.pending['src/late-account.txt']))).toBe(true)
  await switchAccount(page, 'Grace Hopper', 'Grace Hopper')
  await expect(page.locator('[data-local-git-detail]')).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__localGitFileComparisonHarness.cancellations.length)).toBe(3)
  await page.evaluate(() => (window as any).__localGitFileComparisonHarness.pending['src/late-account.txt']({
    version: 1, scope: 'file-comparison', path: 'src/late-account.txt', comparison: 'staged',
    head: { oid: 'a'.repeat(40), ref: 'refs/heads/main' }, status: 'ready', change: 'deleted',
    before: { kind: 'text', text: 'late-account-private', mode: '100644' }, after: { kind: 'missing' },
  }))
  await expect(page.getByText('late-account-private', { exact: true })).toHaveCount(0)
  const harness = await page.evaluate(() => (window as any).__localGitFileComparisonHarness)
  expect(harness.fileRequests.every((request: any) => request.id === GIT_ID && request.userId === 'user-ada')).toBe(true)
  expect(harness.snapshotCalls).toBe(0)
})

test('conversation Attach saves the exact captured single-file JSON; Project and canonical review stay read-only', async ({ page }, info) => {
  test.setTimeout(ms(120_000))
  await page.setViewportSize(VIEWPORTS[4])
  await installComparisonFixture(page)
  await signIntoAdaAndGrace(page)
  const endpoint = await startMessagesFixture()
  try {
    const providerResponse = await page.request.post(`${API}/providers`, { data: {
      label: `Selected Git comparison ${Date.now().toString(36)}`,
      modelFamily: 'claude', effortLevels: ['Default'],
      config: { baseURL: endpoint.url, model: 'e2e-selected-file' },
    } })
    expect(providerResponse.ok(), await providerResponse.text()).toBeTruthy()
    const sessionResponse = await page.request.post(`${API}/sessions`, { data: { providerId: (await providerResponse.json()).id } })
    expect(sessionResponse.ok(), await sessionResponse.text()).toBeTruthy()
    const session = await sessionResponse.json() as { id: string }
    const messages: string[] = []
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/sessions/${session.id}/messages`) messages.push(request.url())
    })

    await page.goto(`/s/${encodeURIComponent(session.id)}`)
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
    await dialog.getByRole('button', { name: /^Repository/ }).click()
    const picker = dialog.locator('[data-native-git-picker]')
    await picker.getByRole('button', { name: `Review changes in ${NAME}`, exact: true }).click()
    const review = picker.locator('[data-local-git-review]')
    await review.getByRole('button', { name: 'Review changes', exact: true }).click()
    await expect(review.getByRole('alert')).toContainText('Could not read this repository review.')
    const compare = review.locator('[data-local-git-file-comparison]')
    await comparePath(compare, 'src/persist.json', 'unstaged')
    const result = compare.locator('[data-local-git-file-comparison-result]')
    await expect(result.getByText('Preview unavailable: unsupported file type or filesystem entry.', { exact: true })).toBeVisible()
    await expect(result.getByText('CAPTURED_BEFORE_ATTACH_91AF', { exact: true })).toBeVisible()
    const copy = compare.locator('[data-git-file-comparison-copy]')
    const visible = await copy.locator('[data-git-file-comparison-copy-text]').textContent()
    expect(visible).toBeTruthy()
    const parsed = JSON.parse(visible!)
    expect(parsed).toMatchObject({
      version: 1, kind: 'git-file-comparison-copy', repositoryName: NAME,
      comparison: 'unstaged', path: 'src/persist.json', change: 'unavailable',
      before: { kind: 'omitted', reason: 'unsupported' },
      after: { kind: 'text', text: 'CAPTURED_BEFORE_ATTACH_91AF', mode: '100644' },
    })
    const beforeAttachRequests = await page.evaluate(() => (window as any).__localGitFileComparisonHarness.fileRequests.length)
    await page.evaluate(() => { (window as any).__localGitFileComparisonHarness.persistText = 'MUTATED_AFTER_CAPTURE_SHOULD_NOT_REPLACE_JSON' })
    const attach = copy.getByRole('button', { name: 'Attach this comparison', exact: true })
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      await attach.scrollIntoViewIfNeeded()
      await settledOpaquePaint(dialog)
      await expect(attach).toBeInViewport()
      await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeInViewport()
      await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await assertWcag22Aa(page, `Single-file comparison Attach ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: info.outputPath(`local-git-file-attach-${viewport.width}x${viewport.height}.png`) })
    }
    await page.setViewportSize(VIEWPORTS[4])
    await expect(attach).toBeEnabled()
    await attach.click()
    await expect(copy.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
    expect(await page.evaluate(() => (window as any).__localGitFileComparisonHarness.fileRequests.length)).toBe(beforeAttachRequests,
      'Attach serializes the captured pair without asking the native bridge to reread it')
    expect(endpoint.documents).toEqual([], 'Attach updates context but does not call the model')
    expect(messages).toEqual([], 'only Send enters the conversation message route')

    const savedResponse = await page.request.get(`${API}/sessions/${session.id}`)
    expect(savedResponse.ok()).toBeTruthy()
    const saved = await savedResponse.json()
    const attachments = saved.workspace.attachments as Array<{ id: string; label: string; previewText: string; kind: string }>
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({ kind: 'file', previewText: visible })
    expect(JSON.parse(attachments[0]!.previewText).after.text).toBe('CAPTURED_BEFORE_ATTACH_91AF',
      'mutation after capture cannot change the exact body saved to the conversation')

    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Use the attached single-file comparison.')
    await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'Read supplied attachment:' })).toBeVisible({ timeout: ms(20_000) })
    await expect.poll(() => endpoint.documents.length, { timeout: ms(20_000) }).toBe(1)
    expect(messages).toHaveLength(1, 'model input is reached only by explicit Send')
    expect(endpoint.documents.at(-1)?.attached_files?.map(file => file.text)).toEqual([visible])
    expect(await page.evaluate(() => (window as any).__localGitFileComparisonHarness.fileRequests.length)).toBe(beforeAttachRequests)

    // The canonical context detail and Project reference picker expose review,
    // but neither may expose the conversation saved-copy action.
    await page.goto(`/contexts/${GIT_ID}`)
    const canonicalReview = page.locator(`[data-local-git-detail="${GIT_ID}"]`).locator('[data-local-git-review]')
    await expect(canonicalReview.locator('[data-local-git-file-comparison]')).toBeVisible()
    await expect(canonicalReview.locator('[data-git-file-comparison-copy]')).toHaveCount(0)
    await expect(canonicalReview.getByRole('button', { name: 'Attach this comparison', exact: true })).toHaveCount(0)

    const projectName = `Single-file comparison readonly ${Date.now().toString(36)}`
    const expandSidebar = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
    if (await expandSidebar.isVisible()) await expandSidebar.click()
    await createProject(page, projectName)
    const contextSection = page.locator('section.group\\/section').filter({
      has: page.locator('[data-section-title]', { hasText: /^Context$/i }),
    })
    const contextHeader = contextSection.getByRole('button', { name: /^Context(?:\s|$)/i })
    if (await contextHeader.getAttribute('aria-expanded') === 'false') await contextHeader.click()
    await contextSection.getByRole('button', { name: 'Add context', exact: true }).click()
    const projectDialog = page.getByRole('dialog', { name: 'Add context', exact: true })
    await projectDialog.getByRole('button', { name: /^Repository/ }).click()
    const projectPicker = projectDialog.locator('[data-native-git-picker]')
    await projectPicker.getByRole('button', { name: `Review changes in ${NAME}`, exact: true }).click()
    const projectReview = projectPicker.locator('[data-local-git-review]')
    const projectCompare = projectReview.locator('[data-local-git-file-comparison]')
    await expect(projectCompare).toBeVisible()
    await comparePath(projectCompare, 'src/persist.json', 'unstaged')
    await expect(projectCompare.locator('[data-local-git-file-comparison-result]')).toBeVisible()
    await expect(projectCompare.locator('[data-git-file-comparison-copy]')).toHaveCount(0)
    await expect(projectCompare.getByRole('button', { name: 'Attach this comparison', exact: true })).toHaveCount(0)
    await projectDialog.getByRole('button', { name: 'Done', exact: true }).click()

    const harness = await page.evaluate(() => (window as any).__localGitFileComparisonHarness)
    expect(harness.snapshotCalls).toBe(0)
    expect(harness.fileRequests.filter((request: any) => request.path === 'src/persist.json')).toHaveLength(1,
      'after full navigation reset, Project preview performs one selected-file read and no snapshot')
  } finally {
    await new Promise<void>(resolve => endpoint.server.close(() => resolve()))
  }
})
