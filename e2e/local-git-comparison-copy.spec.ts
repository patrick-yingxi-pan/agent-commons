import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import { prepareGitComparisonCopy } from '../src/lib/gitComparisonCopy.ts'
import { parseLocalGitReview } from '../contract/localGitReview.mjs'
import { startMessagesFixture } from './attachment-endpoint.ts'
import { API, createProject, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa, settledAttachmentPreview } from './accessibility-helpers.ts'
import { assertLocalConnectionPickerRow } from './local-connection-picker-helpers.ts'

const GIT_ID = `GIT_${'F'.repeat(32)}`
const NAME = 'Comparison copy fixture'
const STAGED_PATH = 'src/revised.md'
const RENAME_OLD = 'archive/previous-note.md'
const RENAME_NEW = 'docs/current-note.md'
const OMITTED_PATH = 'src/budget-omitted.md'
const OVERSIZED_PATH = 'src/oversized.md'
const HEAD_TEXT = 'HEAD captured before the staged edit.\n'
const INDEX_TEXT = 'Index contains the staged edit.\n'
const WORKING_TEXT = 'Working tree contains the later unstaged edit.\n'
const RENAME_TEXT = 'Captured note moved without text changes.\nKeep its exact contents.\n'
const OMITTED_TEXT = 'The other side remains available despite a budget omission.\n'
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

const text = (value: string) => ({ kind: 'text', text: value, mode: '100644' })
const unchanged = { kind: 'omitted', reason: 'not-needed' }
const missing = { kind: 'missing' }
const CAPTURED_REVIEW = {
  version: 1 as const,
  comparison: 'raw' as const,
  head: { oid: 'a'.repeat(40), ref: 'refs/heads/main' },
  excludedCount: 1,
  unchangedCount: 0,
  files: [
    { path: STAGED_PATH, staged: 'modified', unstaged: 'modified',
      head: text(HEAD_TEXT), index: text(INDEX_TEXT), working: text(WORKING_TEXT) },
    { path: RENAME_OLD, staged: 'deleted', unstaged: 'unchanged',
      head: text(RENAME_TEXT), index: missing, working: missing },
    { path: RENAME_NEW, staged: 'added', unstaged: 'unchanged',
      head: missing, index: text(RENAME_TEXT), working: unchanged },
    { path: OMITTED_PATH, staged: 'unavailable', unstaged: 'unchanged',
      head: { kind: 'omitted', reason: 'budget' }, index: text(OMITTED_TEXT), working: unchanged },
  ].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
}

async function signIntoAdaAndGrace(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  const ada = await page.request.post(`${API}/auth/login`, { data: { email: 'ada@acme.example', password: 'ada-demo-password' } })
  expect(ada.ok(), await ada.text()).toBeTruthy()
  const grace = await page.request.post(`${API}/auth/login`, { data: { email: 'grace@acme.example', password: 'grace-demo-password' } })
  expect(grace.ok(), await grace.text()).toBeTruthy()
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expand.isVisible()) await expand.click()
  await page.getByTestId('account-chip').click({ timeout: ms(10_000) })
  await page.getByTestId('account-stack-option').filter({ hasText: 'Ada Lovelace' }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace', { timeout: ms(5_000) })
}

async function installReviewFixture(page: Page, review = CAPTURED_REVIEW) {
  expect(parseLocalGitReview(review), 'fixture obeys the real native review contract').toBeDefined()
  await page.addInitScript(({ connectionId, name, review }) => {
    const harness = { reviewCalls: 0, snapshotCalls: 0, connectCalls: 0, disconnectCalls: 0 }
    Object.defineProperty(window, '__gitComparisonCopyHarness', { configurable: true, value: harness })
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: { context: { localGit: {
        list: async (source: any) => source?.userId === 'user-ada'
          ? [{ id: connectionId, name, remembered: true }]
          : [],
        connect: async () => { harness.connectCalls++; throw new Error('comparison copy must not reconnect') },
        snapshot: async () => { harness.snapshotCalls++; throw new Error('comparison copy is not a Git snapshot') },
        review: async (id: string, source: any) => {
          if (id !== connectionId || source?.userId !== 'user-ada') throw new Error('review must retain its owner scope')
          harness.reviewCalls++
          return structuredClone(review)
        },
        files: async () => { throw new Error('comparison copy does not browse repository files') },
        file: async () => { throw new Error('comparison copy does not read a selected path') },
        disconnect: async () => { harness.disconnectCalls++ },
      } } },
    })
  }, { connectionId: GIT_ID, name: NAME, review })
}

async function expectedVisibleJson(copy: import('@playwright/test').Locator,
  input: { comparison: 'staged' | 'unstaged'; path: string; previousPath?: string }) {
  const source = await copy.locator('[data-git-comparison-copy-text]').textContent()
  expect(source, 'the captured comparison JSON is rendered as a real source').toBeTruthy()
  const parsed = JSON.parse(source!)
  const result = prepareGitComparisonCopy({
    review: CAPTURED_REVIEW as any,
    comparison: input.comparison,
    path: input.path,
    ...(input.previousPath === undefined ? {} : { previousPath: input.previousPath }),
    readAt: Date.parse(parsed.capturedAt),
    repositoryName: NAME,
  })
  expect(result.status, 'the selected captured sides are eligible for a saved comparison').toBe('ready')
  if (result.status !== 'ready') throw new Error(`Unexpected comparison projection: ${result.status}`)
  expect(source).toBe(result.text, 'the visible snapshot is the canonical exact JSON projection')
  return { text: result.text, label: result.name }
}

async function signInRecipient(browser: Browser) {
  return newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
}

async function settleVisibleComparisonAttachment(page: Page, previewId: string) {
  await settledAttachmentPreview(page, `[data-attachment-preview="${previewId}"]`)
  const preview = page.locator(`[data-attachment-preview="${previewId}"]`).filter({ visible: true })
  await expect(preview, 'the explicitly saved comparison has a visible ordinary attachment preview').toBeVisible()
  const bounds = await preview.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x, right: rect.right, width: rect.width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }
  })
  expect(bounds.width).toBeGreaterThan(0)
  expect(bounds.x).toBeGreaterThanOrEqual(-1)
  expect(bounds.right).toBeLessThanOrEqual(await page.evaluate(() => innerWidth) + 1)
  expect(bounds.scrollWidth, 'the saved comparison preview remains horizontally bounded at the settled viewport')
    .toBeLessThanOrEqual(bounds.clientWidth + 1)
  const body = preview.locator('pre').first()
  await expect(body).toBeVisible()
  await expect.poll(() => body.evaluate(node => node.scrollWidth <= node.clientWidth + 1),
    { message: 'saved comparison JSON wraps inside its readable preview instead of widening the panel' }).toBe(true)
}

test('conversation Git comparisons attach exact staged, unstaged, grouped-rename and omitted JSON copies only on explicit action', async ({ page, browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  await page.setViewportSize(VIEWPORTS[4])
  await installReviewFixture(page)
  await signIntoAdaAndGrace(page)

  const endpoint = await startMessagesFixture()
  try {
    const providerResponse = await page.request.post(`${API}/providers`, { data: {
      label: `Git comparison fixture ${Date.now().toString(36)}`,
      modelFamily: 'claude', effortLevels: ['Default'],
      config: { baseURL: endpoint.url, model: 'e2e-attachment-model' },
    } })
    expect(providerResponse.ok(), await providerResponse.text()).toBeTruthy()
    const sessionResponse = await page.request.post(`${API}/sessions`, { data: { providerId: (await providerResponse.json()).id } })
    expect(sessionResponse.ok(), await sessionResponse.text()).toBeTruthy()
    const session = await sessionResponse.json() as { id: string }
    await page.goto(`/s/${encodeURIComponent(session.id)}`)
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
    await dialog.getByRole('button', { name: /^Repository/ }).click()
    const picker = dialog.locator('[data-native-git-picker]')
    await expect(picker.getByRole('button', { name: `Review changes in ${NAME}`, exact: true })).toBeVisible()
    await picker.getByRole('button', { name: `Review changes in ${NAME}`, exact: true }).click()
    const review = picker.locator('[data-local-git-review]')
    await expect(review.getByRole('button', { name: 'Review changes', exact: true })).toBeEnabled()
    await expect.poll(() => page.evaluate(() => (window as any).__gitComparisonCopyHarness.reviewCalls)).toBe(0)
    await review.getByRole('button', { name: 'Review changes', exact: true }).click()
    const result = review.locator('[data-local-git-review-result]')
    await expect(result).toBeVisible()
    await expect(result.locator('[data-git-comparison-copy]')).toBeVisible()
    const compare = result.getByLabel('Compare')
    const changedFile = result.getByLabel('Changed file')
    const copies: Array<{ text: string; label: string }> = []

    const captureAndAttach = async (input: { comparison: 'staged' | 'unstaged'; path: string; previousPath?: string }) => {
      await compare.selectOption(input.comparison)
      if (input.comparison === 'staged') {
        const grouping = result.getByRole('checkbox', { name: /^Group possible renames/ })
        if (input.previousPath) await grouping.check()
        else if (await grouping.isVisible() && await grouping.isChecked()) await grouping.uncheck()
      }
      await changedFile.selectOption(input.path)
      const copy = result.locator('[data-git-comparison-copy]')
      await expect(copy).toBeVisible()
      const prepared = await expectedVisibleJson(copy, input)
      const parsed = JSON.parse(prepared.text)
      if (input.comparison === 'staged' && input.previousPath) {
        expect(parsed.paths).toEqual({ before: input.previousPath, after: input.path })
        expect(parsed.provenance).toContain('possible rename')
      } else expect(parsed.paths.after).toBe(input.path)
      const attach = copy.getByRole('button', { name: 'Attach this comparison', exact: true })
      await expect(attach).toBeEnabled()
      const attachmentRequestCount = endpoint.documents.length
      await attach.click()
      await expect(copy.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
      await expect(dialog).toContainText(`${copies.length + 1} added`)
      expect(endpoint.documents.length).toBe(attachmentRequestCount,
        'saving a comparison is not a model send')
      copies.push(prepared)
    }

    await captureAndAttach({ comparison: 'staged', path: STAGED_PATH })
    await captureAndAttach({ comparison: 'unstaged', path: STAGED_PATH })
    await captureAndAttach({ comparison: 'staged', path: RENAME_NEW, previousPath: RENAME_OLD })
    await captureAndAttach({ comparison: 'staged', path: OMITTED_PATH })

    const omittedJson = JSON.parse(copies.at(-1)!.text)
    expect(omittedJson.before).toEqual({ kind: 'omitted', reason: 'budget' },
      'the exact captured omission is included, never converted to a clean-side claim')
    expect(omittedJson.after).toEqual({ kind: 'text', text: OMITTED_TEXT, mode: '100644' })
    expect(await page.evaluate(() => (window as any).__gitComparisonCopyHarness)).toMatchObject({
      reviewCalls: 1, snapshotCalls: 0, connectCalls: 0,
    })
    expect(endpoint.documents).toEqual([], 'explicit attachments never send or invoke the model')

    // The grouped copy is the densest selected state; capture it at each
    // required viewport and prove the JSON/action remain reachable and bounded.
    await compare.selectOption('staged')
    const grouping = result.getByRole('checkbox', { name: /^Group possible renames/ })
    if (!(await grouping.isChecked())) await grouping.check()
    await changedFile.selectOption(RENAME_NEW)
    const groupedCopy = result.locator('[data-git-comparison-copy]')
    const disclosure = groupedCopy.locator('details')
    if (!(await disclosure.evaluate(node => node.open))) {
      await disclosure.getByText('Saved comparison contents', { exact: true }).click()
    }
    await expect(groupedCopy.locator('[data-git-comparison-copy-text]')).toBeVisible()
    const groupedAttach = groupedCopy.getByRole('button', { name: 'Added', exact: true })
    const connectionRow = picker.locator('[data-local-connection-picker-row]')
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await assertLocalConnectionPickerRow(connectionRow, viewport.width)
      await groupedCopy.scrollIntoViewIfNeeded()
      await expect(groupedCopy).toBeVisible()
      await groupedAttach.scrollIntoViewIfNeeded()
      await expect(groupedAttach).toBeInViewport()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        { message: `Git comparison copy has no page-level horizontal overflow at ${viewport.width}px` }).toBe(true)
      await expect.poll(() => picker.evaluate(node => node.scrollWidth <= node.clientWidth),
        { message: `Git comparison picker stays horizontally bounded at ${viewport.width}px` }).toBe(true)
      await assertWcag22Aa(page, `Git comparison copy ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: testInfo.outputPath(`local-git-comparison-copy-${viewport.width}x${viewport.height}.png`), fullPage: false })
    }
    await page.setViewportSize(VIEWPORTS[4])

    // Reopening remounts the picker but preserves the same captured review and
    // receipt; selecting an already attached comparison remains Added.
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    const reopened = page.getByRole('dialog', { name: 'Add context', exact: true })
    await reopened.getByRole('button', { name: /^Repository/ }).click()
    const reopenedPicker = reopened.locator('[data-native-git-picker]')
    await reopenedPicker.getByRole('button', { name: `Review changes in ${NAME}`, exact: true }).click()
    const reopenedResult = reopenedPicker.locator('[data-local-git-review-result]')
    await expect(reopenedResult).toBeVisible()
    await reopenedResult.getByLabel('Compare').selectOption('staged')
    await reopenedResult.getByLabel('Changed file').selectOption(STAGED_PATH)
    await expect(reopenedResult.locator('[data-git-comparison-copy]')
      .getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
    await expect(reopened).toContainText('4 added')
    expect(await page.evaluate(() => (window as any).__gitComparisonCopyHarness.reviewCalls)).toBe(1,
      'remount and selection changes reuse the same captured review without native reread')
    await reopened.getByRole('button', { name: 'Done', exact: true }).click()

    const savedResponse = await page.request.get(`${API}/sessions/${session.id}`)
    expect(savedResponse.ok()).toBeTruthy()
    const saved = await savedResponse.json()
    const attachments = saved.workspace.attachments as Array<{ id: string; label: string; previewText: string; kind: string }>
    expect(attachments).toHaveLength(4)
    expect(new Set(attachments.map(item => item.id)).size).toBe(4)
    expect(attachments.map(item => item.previewText)).toEqual(copies.map(copy => copy.text),
      'normal context saves preserve each exact visible comparison JSON, with no Git reread')
    expect(attachments.map(item => item.label)).toEqual(copies.map(copy => copy.label))
    expect(attachments.every(item => item.kind === 'file')).toBe(true)

    const messages: string[] = []
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/sessions/${session.id}/messages`) messages.push(request.url())
    })
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Review the explicitly attached Git comparisons.')
    await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'Read supplied attachment:' })).toBeVisible({ timeout: ms(20_000) })
    await expect.poll(() => endpoint.documents.length, { timeout: ms(20_000) }).toBe(1)
    expect(messages).toHaveLength(1, 'only explicit Send enters the ordinary conversation turn route')
    expect(endpoint.documents.at(-1)?.attached_files?.map(file => file.text)).toEqual(copies.map(copy => copy.text),
      'normal model input receives the same exact saved JSON strings')
    expect(await page.evaluate(() => (window as any).__gitComparisonCopyHarness.reviewCalls)).toBe(1,
      'sending uses saved comparison copies rather than rereading native Git')

    const grant = await page.request.post(`${API}/grants`, { data: {
      subject: { kind: 'session', id: session.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view',
    } })
    expect(grant.ok(), await grant.text()).toBeTruthy()
    const recipient = await signInRecipient(browser)
    try {
      await recipient.page.goto(`/s/${encodeURIComponent(session.id)}`)
      await expect(recipient.page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)
      await expect(recipient.page.getByRole('button', { name: 'Share this conversation', exact: true })).toHaveCount(0)
      const sharedResponse = await recipient.page.request.get(`${API}/sessions/${session.id}`)
      expect(sharedResponse.ok()).toBeTruthy()
      const shared = await sharedResponse.json()
      expect(shared.workspace.attachments.map((item: any) => item.previewText)).toEqual(copies.map(copy => copy.text),
        'the granted reader sees copies, not source controls or Git capabilities')
      const filesButton = recipient.page.getByTitle(`Files (${copies.length})`, { exact: true })
      await expect(filesButton).toBeVisible()
      await filesButton.click()
      const fileMenu = recipient.page.getByRole('menu', { name: 'Files', exact: true })
      await fileMenu.getByRole('button', { name: copies[0]!.label, exact: true }).click()
      await expect(recipient.page.locator('[data-attachment-preview]')).toContainText(copies[0]!.text)
      for (const viewport of VIEWPORTS) {
        await recipient.page.setViewportSize(viewport)
        await settleVisibleComparisonAttachment(recipient.page, attachments[0]!.id)
        await expect(recipient.page.getByRole('button', { name: 'Attach this comparison', exact: true })).toHaveCount(0)
        await expect.poll(() => recipient.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        await recipient.page.screenshot({ path: testInfo.outputPath(`comparison-shared-${viewport.width}x${viewport.height}.png`) })
      }
    } finally { await recipient.context.close() }

    const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
    try { expect((await foreign.page.request.get(`${API}/sessions/${session.id}`)).status()).toBe(404) }
    finally { await foreign.context.close() }

    // Canonical repository review remains inspect-only, even though this
    // conversation already owns ordinary attached copies of its comparisons.
    await page.goto(`/contexts/${GIT_ID}`)
    const canonical = page.locator(`[data-local-git-detail="${GIT_ID}"]`).locator('[data-local-git-review]')
    await canonical.getByRole('button', { name: 'Review changes', exact: true }).click()
    await expect(canonical.locator('[data-local-git-review-result]')).toBeVisible()
    await expect(canonical.locator('[data-git-comparison-copy]')).toHaveCount(0)
    await expect(canonical.getByRole('button', { name: 'Attach this comparison', exact: true })).toHaveCount(0)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await canonical.getByRole('heading', { name: 'Changes on this device', exact: true }).scrollIntoViewIfNeeded()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`comparison-canonical-${viewport.width}x${viewport.height}.png`) })
    }
    await page.setViewportSize(VIEWPORTS[4])

    const projectName = `Git comparison read only ${Date.now().toString(36)}`
    const expandSidebar = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
    if (await expandSidebar.isVisible()) await expandSidebar.click()
    await createProject(page, projectName)
    const contextSection = page.locator('section.group\\/section').filter({
      has: page.locator('[data-section-title]', { hasText: /^Context$/i }),
    })
    const contextHeader = contextSection.getByRole('button', { name: /^Context(?:\s|$)/i })
    if (await contextHeader.getAttribute('aria-expanded') === 'false') await contextHeader.click()
    await contextSection.getByRole('button', { name: 'Add context', exact: true }).click()
    const projectPicker = page.getByRole('dialog', { name: 'Add context', exact: true })
    await projectPicker.getByRole('button', { name: /^Repository/ }).click()
    await expect(projectPicker.locator('[data-git-comparison-copy]')).toHaveCount(0)
    await expect(projectPicker.getByRole('button', { name: 'Attach this comparison', exact: true })).toHaveCount(0)
    await projectPicker.getByRole('button', { name: `Review changes in ${NAME}`, exact: true }).click()
    const projectReview = projectPicker.locator('[data-local-git-review]')
    const projectReviewResult = projectReview.locator('[data-local-git-review-result]')
    if (!(await projectReviewResult.isVisible())) {
      const readReview = projectReview.getByRole('button', { name: /^(Review changes|Read changes again)$/ })
      await readReview.click()
    }
    await expect(projectReviewResult).toBeVisible()
    await expect(projectReview.locator('[data-git-comparison-copy]')).toHaveCount(0)
    await expect(projectReview.getByRole('button', { name: 'Attach this comparison', exact: true })).toHaveCount(0)
    const projectConnectionRow = projectPicker.locator('[data-local-connection-picker-row]')
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await assertLocalConnectionPickerRow(projectConnectionRow, viewport.width)
      await projectReview.getByRole('heading', { name: 'Changes on this device', exact: true }).scrollIntoViewIfNeeded()
      await expect(projectPicker.getByRole('button', { name: 'Done', exact: true })).toBeInViewport()
      await expect.poll(() => projectPicker.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
      await assertWcag22Aa(page, `Project Git review ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: testInfo.outputPath(`comparison-project-${viewport.width}x${viewport.height}.png`) })
    }
    await projectPicker.getByRole('button', { name: 'Done', exact: true }).click()

    const finalHarness = await page.evaluate(() => (window as any).__gitComparisonCopyHarness)
    expect(finalHarness).toMatchObject({ reviewCalls: 1, snapshotCalls: 0, connectCalls: 0 })
  } finally {
    await new Promise<void>(resolve => endpoint.server.close(() => resolve()))
  }
})

test('Git comparison copies refuse oversized JSON and retry one failed attachment with its original identity', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const oversized = 'x'.repeat(35 * 1024)
  const retryReview = {
    ...CAPTURED_REVIEW,
    files: [
      { path: OVERSIZED_PATH, staged: 'modified', unstaged: 'unchanged', head: text(oversized), index: text(`${oversized}y`), working: missing },
      CAPTURED_REVIEW.files.find(file => file.path === STAGED_PATH)!,
    ],
  }
  await page.setViewportSize(VIEWPORTS[4])
  await installReviewFixture(page, retryReview)
  await signIntoAdaAndGrace(page)
  const created = await page.request.post(`${API}/sessions`, { data: {} })
  expect(created.ok(), await created.text()).toBeTruthy()
  const session = await created.json() as { id: string }
  let writes = 0
  const requestAttachments: Array<unknown> = []
  await page.route(`**${API}/sessions/${encodeURIComponent(session.id)}/context-state`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue()
    writes++
    const body = route.request().postDataJSON() as { workspace?: { attachments?: unknown[] } }
    requestAttachments.push(body.workspace?.attachments)
    if (writes === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fixture refusal' }) })
    return route.continue()
  })

  await page.goto(`/s/${encodeURIComponent(session.id)}`)
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await dialog.getByRole('button', { name: /^Repository/ }).click()
  const picker = dialog.locator('[data-native-git-picker]')
  await picker.getByRole('button', { name: `Review changes in ${NAME}`, exact: true }).click()
  const review = picker.locator('[data-local-git-review]')
  await review.getByRole('button', { name: 'Review changes', exact: true }).click()
  const result = review.locator('[data-local-git-review-result]')
  await expect(result).toBeVisible()
  await result.getByLabel('Compare').selectOption('staged')
  await result.getByLabel('Changed file').selectOption(OVERSIZED_PATH)
  const oversizedCopy = result.locator('[data-git-comparison-copy]')
  await expect(oversizedCopy).toContainText('This comparison exceeds the 64 KiB saved-copy limit. Nothing was truncated or attached; choose a smaller comparison.')
  await expect(oversizedCopy.getByRole('button', { name: 'Attach this comparison', exact: true })).toHaveCount(0)
  expect(prepareGitComparisonCopy({ review: retryReview as any, comparison: 'staged', path: OVERSIZED_PATH, readAt: 1, repositoryName: NAME }).status)
    .toBe('too-large')
  expect(writes).toBe(0, 'an ineligible large JSON copy never enters context mutation')

  await result.getByLabel('Changed file').selectOption(STAGED_PATH)
  const copy = result.locator('[data-git-comparison-copy]')
  const attach = copy.getByRole('button', { name: 'Attach this comparison', exact: true })
  await attach.click()
  await expect.poll(() => writes).toBe(1)
  expect(requestAttachments[0]).toHaveLength(1)

  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const contextFailure = page.getByRole('alert').filter({ hasText: 'Couldn’t confirm the context update.' })
  await expect(contextFailure).toBeVisible()
  await expect(contextFailure.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const reopened = page.getByRole('dialog', { name: 'Add context', exact: true })
  await reopened.getByRole('button', { name: /^Repository/ }).click()
  const reopenedPicker = reopened.locator('[data-native-git-picker]')
  await reopenedPicker.getByRole('button', { name: `Review changes in ${NAME}`, exact: true }).click()
  const reopenedReview = reopenedPicker.locator('[data-local-git-review-result]')
  await expect(reopenedReview).toBeVisible()
  await reopenedReview.getByLabel('Compare').selectOption('staged')
  await reopenedReview.getByLabel('Changed file').selectOption(STAGED_PATH)
  const reopenedCopy = reopenedReview.locator('[data-git-comparison-copy]')
  await expect(reopenedCopy.getByRole('button', { name: 'Saving comparison…', exact: true })).toBeDisabled()
  expect(writes).toBe(1, 'remount preserves the held copy without issuing a duplicate context write')
  await reopened.getByRole('button', { name: 'Done', exact: true }).click()
  await contextFailure.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(() => writes).toBe(2)
  await expect(contextFailure).toHaveCount(0)
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  await reopened.getByRole('button', { name: /^Repository/ }).click()
  await reopenedPicker.getByRole('button', { name: `Review changes in ${NAME}`, exact: true }).click()
  await expect(reopenedCopy.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await expect(reopened).toContainText('1 added')
  expect(writes).toBe(2, 'explicit retry after remount performs one second context mutation')
  expect(requestAttachments[1]).toEqual(requestAttachments[0],
    'retry preserves the same opaque attachment ID and exact captured JSON')
  expect(await page.evaluate(() => (window as any).__gitComparisonCopyHarness)).toMatchObject({
    reviewCalls: 1, snapshotCalls: 0, connectCalls: 0,
  })
})
