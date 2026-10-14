import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { docxFixture } from '../tests/helpers/docxFixture.mjs'
import { assertWcag22Aa, settledOpaquePaint } from './accessibility-helpers.ts'
import { API, createProject, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const ID = `GIT_${'E'.repeat(32)}`
const NAME = 'Untracked browse fixture'
const NOTE = '.ordinary-note.md'
const DOC = 'new-documents/long-folder-name-for-a-complete-relative-path/unstaged-review.docx'
const HELD = 'new-documents/held.md'
const NOTE_TEXT = 'UNTRACKED_REVIEWED_COPY_6E23'
const DOC_TEXT = 'UNTRACKED_WORD_BODY_6E23 · café 世界'
const TRACKED_TEXT = 'TRACKED_REVIEWED_COPY_6E23'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function fixture(page: Page) {
  await page.addInitScript(({ id, name, note, doc, held, noteText, trackedText, bytes }) => {
    const harness: any = { lists: 0, previews: [], trackedLists: 0, trackedPreviews: 0, snapshots: 0,
      cancelled: [], failList: false, holdList: false, resolveList: undefined, resolvePreview: undefined,
      connected: true, noteText, bytes }
    Object.defineProperty(window, '__untrackedBrowse', { value: harness })
    const files = [note, doc, held, ...Array.from({ length: 102 }, (_, i) => `new/${String(i).padStart(3, '0')}.md`)]
      .sort().map(path => ({ path, kind: 'file' }))
    const textPreview = (path: string, text: string, scope?: string) => ({
      version: 1, ...(scope ? { scope } : {}), path, sizeBytes: new TextEncoder().encode(text).byteLength, snapshot: { text },
    })
    Object.defineProperty(window, 'agentCommonsDesktop', { value: { context: { localGit: {
      list: async (source: any) => source.userId === 'user-ada' && harness.connected ? [{ id, name, remembered: true }] : [],
      connect: async () => { throw new Error('must not reconnect') },
      snapshot: async () => { harness.snapshots++; throw new Error('no snapshot authority') },
      review: async () => { throw new Error('no change-review authority') },
      files: async () => { harness.trackedLists++; return { version: 1, files: [{ path: 'src/tracked.md', kind: 'file' }], excludedCount: 0 } },
      file: async (_id: string, input: any) => { harness.trackedPreviews++; return textPreview(input.path, trackedText) },
      untrackedFiles: async (connectionId: string, input: any, source: any) => {
        if (connectionId !== id || input.scope !== 'untracked' || !input.operationId || source.userId !== 'user-ada') throw new Error('invalid source')
        harness.lists++
        if (harness.failList) { harness.failList = false; throw new Error('listing unavailable') }
        const result = { version: 1, scope: 'untracked', files, excludedCount: 3 }
        if (harness.holdList) { harness.holdList = false; return await new Promise(resolve => { harness.resolveList = () => resolve(result) }) }
        return result
      },
      untrackedFile: async (connectionId: string, input: any, source: any) => {
        if (connectionId !== id || input.scope !== 'untracked' || !input.operationId || source.userId !== 'user-ada') throw new Error('invalid source')
        harness.previews.push({ path: input.path, operationId: input.operationId, userId: source.userId })
        if (input.path === held) return await new Promise(resolve => { harness.resolvePreview = () => resolve(textPreview(input.path, 'LATE_PRIVATE_UNTRACKED', 'untracked')) })
        if (input.path === doc) return { version: 1, scope: 'untracked', path: input.path, sizeBytes: harness.bytes.length,
          snapshot: { document: { format: 'docx', bytes: new Uint8Array(harness.bytes) } } }
        return textPreview(input.path, harness.noteText, 'untracked')
      },
      cancelUntrackedRead: async (connectionId: string, input: any, source: any) => { harness.cancelled.push({ connectionId, ...input, userId: source.userId }) },
      disconnect: async () => { harness.connected = false },
    } } } })
  }, { id: ID, name: NAME, note: NOTE, doc: DOC, held: HELD, noteText: NOTE_TEXT, trackedText: TRACKED_TEXT,
    bytes: [...docxFixture({ paragraphs: [DOC_TEXT, 'Only reviewed body text is attached.'] })] })
}

async function openUntracked(host: Locator) {
  const toggle = host.getByRole('checkbox', { name: 'Browse untracked files', exact: true })
  await expect(toggle).not.toBeChecked()
  await toggle.check()
  const browser = host.locator('[data-local-git-untracked-browser]')
  await expect(browser.getByRole('button', { name: 'List untracked paths', exact: true })).toBeVisible()
  return { toggle, browser }
}

async function select(browser: Locator, path: string) {
  await browser.getByRole('searchbox', { name: 'Search paths', exact: true }).fill(path)
  await browser.getByRole('list', { name: 'Untracked repository paths', exact: true })
    .getByRole('button', { name: `${path} Untracked file`, exact: true }).press('Enter')
  return browser.getByRole('region', { name: `Preview of ${path}`, exact: true })
}

async function matrix(page: Page, browser: Locator, target: Locator, info: TestInfo, prefix: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    const heading = browser.getByRole('heading', { name: 'Untracked files', exact: true })
    await heading.scrollIntoViewIfNeeded()
    await settledOpaquePaint(heading)
    await expect(heading).toBeInViewport()
    await assertWcag22Aa(page, `${prefix} controls ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: info.outputPath(`${prefix}-controls-${viewport.width}x${viewport.height}.png`) })
    const previewHeading = browser.locator('[data-local-git-untracked-file-preview]').getByRole('heading')
    await previewHeading.scrollIntoViewIfNeeded()
    await settledOpaquePaint(previewHeading)
    await expect(previewHeading).toBeInViewport()
    await page.screenshot({ path: info.outputPath(`${prefix}-path-${viewport.width}x${viewport.height}.png`) })
    await target.scrollIntoViewIfNeeded()
    await settledOpaquePaint(target)
    await expect(target).toBeInViewport()
    await expect.poll(() => browser.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await assertWcag22Aa(page, `${prefix} ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: info.outputPath(`${prefix}-${viewport.width}x${viewport.height}.png`) })
  }
  await page.setViewportSize(VIEWPORTS[4])
}

async function picker(page: Page) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await dialog.getByRole('button', { name: /^Repository/ }).click()
  const native = dialog.locator('[data-native-git-picker]')
  await native.getByRole('button', { name: `Browse files in ${NAME}`, exact: true }).click()
  return { dialog, native }
}

test('untracked browsing requires opt-in and explicit reads, fits five viewports, and cancels without publishing late results', async ({ page }, info) => {
  test.setTimeout(ms(90_000))
  await fixture(page)
  await page.goto(`/contexts/${ID}`)
  const detail = page.locator(`[data-local-git-detail="${ID}"]`)
  await expect(detail.getByRole('heading', { name: NAME, exact: true })).toBeVisible()
  await expect(detail.locator('[data-local-git-untracked-browser]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__untrackedBrowse.lists)).toBe(0)
  const { browser, toggle } = await openUntracked(detail)
  expect(await page.evaluate(() => (window as any).__untrackedBrowse.lists)).toBe(0, 'opt-in alone does not list or preview')
  await expect(detail).toContainText(/secrets/i)
  await page.evaluate(() => { (window as any).__untrackedBrowse.failList = true })
  await browser.getByRole('button', { name: 'List untracked paths', exact: true }).click()
  await expect(browser.getByRole('alert')).toBeVisible()
  await browser.getByRole('button', { name: 'Retry path listing', exact: true }).click()
  await expect(browser).toContainText('105 untracked paths')
  await expect(browser.getByRole('list', { name: 'Untracked repository paths' }).getByRole('listitem')).toHaveCount(100)
  await browser.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(browser).toContainText('page 2 of 2')
  expect(await page.evaluate(() => (window as any).__untrackedBrowse.previews)).toEqual([])
  const text = await select(browser, NOTE)
  await expect(text).toHaveText(NOTE_TEXT)
  await expect(browser.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
  await matrix(page, browser, text, info, 'untracked-canonical')
  await toggle.uncheck()
  await expect(detail.locator('[data-local-git-untracked-browser]')).toHaveCount(0)
  await toggle.check()
  await expect(browser.getByRole('button', { name: 'List untracked paths', exact: true })).toBeVisible()
  await expect(browser.getByRole('region', { name: `Preview of ${NOTE}` })).toHaveCount(0)
  await page.evaluate(() => { (window as any).__untrackedBrowse.holdList = true })
  await browser.getByRole('button', { name: 'List untracked paths', exact: true }).click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).__untrackedBrowse.resolveList)).toBe('function')
  await browser.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__untrackedBrowse.cancelled.length)).toBe(1)
  await page.evaluate(() => (window as any).__untrackedBrowse.resolveList())
  await expect(browser.locator('[data-local-git-untracked-browser-listing]')).toHaveCount(0)
  await expect(browser.getByRole('button', { name: 'List untracked paths', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => ({ snapshots: (window as any).__untrackedBrowse.snapshots, tracked: (window as any).__untrackedBrowse.trackedLists }))).toEqual({ snapshots: 0, tracked: 0 })
  await page.reload()
  await expect(detail.getByRole('checkbox', { name: 'Browse untracked files', exact: true })).not.toBeChecked()
})

test('tracked and untracked receipts attach distinct exact saved copies with real document extraction and shared-reader safety', async ({ page, browser: engine }, info) => {
  test.setTimeout(ms(120_000))
  await fixture(page)
  const made = await page.request.post(`${API}/sessions`, { data: {} })
  expect(made.ok()).toBeTruthy()
  const { id: sessionId } = await made.json()
  await page.goto(`/s/${sessionId}`)
  const { dialog, native } = await picker(page)
  const { browser } = await openUntracked(native)
  await browser.getByRole('button', { name: 'List untracked paths', exact: true }).click()
  await expect(await select(browser, NOTE)).toHaveText(NOTE_TEXT)
  const before = await (await page.request.get(`${API}/sessions/${sessionId}`)).json()
  expect(JSON.stringify(before)).not.toContain(NOTE_TEXT)
  await page.evaluate(() => { (window as any).__untrackedBrowse.noteText = 'Changed after preview; never saved' })
  await browser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
  await expect(browser.getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await expect(dialog).toContainText('1 added')
  const tracked = native.locator('[data-local-git-browser]')
  await tracked.getByRole('button', { name: 'List tracked paths', exact: true }).click()
  await tracked.getByRole('button', { name: 'src/tracked.md Tracked file', exact: true }).click()
  await expect(tracked.getByRole('button', { name: 'Attach saved copy', exact: true })).toBeEnabled()
  await tracked.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
  await expect(dialog).toContainText('2 added')
  const document = await select(browser, DOC)
  await expect(document).toContainText(DOC_TEXT, { timeout: ms(20_000) })
  await expect(browser.locator('[data-local-document-preview="docx"]')).toBeVisible()
  const reviewed = await document.textContent()
  await matrix(page, browser, document, info, 'untracked-conversation-document')
  await browser.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
  await expect(dialog).toContainText('3 added')
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const reopened = await picker(page)
  await expect(reopened.native.getByRole('checkbox', { name: 'Browse untracked files', exact: true })).toBeChecked()
  await expect(reopened.native.locator('[data-local-git-untracked-browser]').getByRole('button', { name: 'Added', exact: true })).toBeDisabled()
  await expect(reopened.dialog).toContainText('3 added')
  await reopened.dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const saved = await (await page.request.get(`${API}/sessions/${sessionId}`)).json()
  const attachments = saved.workspace.attachments
  expect(attachments).toHaveLength(3)
  expect(new Set(attachments.map((item: any) => item.id)).size).toBe(3)
  expect(attachments.find((item: any) => item.label === NOTE)?.previewText).toBe(NOTE_TEXT)
  expect(attachments.find((item: any) => item.label === 'src/tracked.md')?.previewText).toBe(TRACKED_TEXT)
  const word = attachments.find((item: any) => item.label === DOC)
  expect(word.previewText).toBe(reviewed)
  expect(word.documentImport).toEqual({ format: 'docx', status: 'ready' })
  expect(await page.evaluate(() => (window as any).__untrackedBrowse.previews.map((item: any) => item.path))).toEqual([NOTE, DOC])
  expect(await page.evaluate(() => (window as any).__untrackedBrowse.snapshots)).toBe(0)
  await page.getByRole('button', { name: 'Share this conversation', exact: true }).click()
  await page.getByLabel('Audience id').fill('tenant-beta')
  await page.getByRole('button', { name: /Share|Publish/ }).last().click()
  const visitor = await newUser(engine, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  try {
    await visitor.page.goto(`/s/${sessionId}`)
    await visitor.page.getByTitle('Files (3)', { exact: true }).click()
    await visitor.page.getByRole('menu', { name: 'Files', exact: true })
      .getByRole('button', { name: DOC, exact: true }).click()
    await expect(visitor.page.locator('[data-attachment-preview] pre')).toHaveText(reviewed!)
    await expect(visitor.page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)
  } finally { await visitor.context.close() }
  const foreign = await newUser(engine, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  try { expect((await foreign.page.request.get(`${API}/sessions/${sessionId}`)).status()).toBe(404) }
  finally { await foreign.context.close() }
})

test('Project context previews untracked documents at five viewports without attachment authority', async ({ page }, info) => {
  test.setTimeout(ms(90_000))
  await fixture(page)
  await page.goto('/')
  await createProject(page, `Untracked read-only ${Date.now().toString(36)}`)
  const section = page.locator('section[class~="group/section"]').filter({ has: page.locator('[data-section-title]', { hasText: /^Context$/i }) })
  const heading = section.getByRole('button', { name: /^Context(?:\s|$)/i })
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click()
  await section.getByRole('button', { name: 'Add context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await dialog.getByRole('button', { name: /^Repository/ }).click()
  const native = dialog.locator('[data-native-git-picker]')
  await native.getByRole('button', { name: `Browse files in ${NAME}`, exact: true }).click()
  const { browser } = await openUntracked(native)
  await browser.getByRole('button', { name: 'List untracked paths', exact: true }).click()
  const text = await select(browser, DOC)
  await expect(text).toContainText(DOC_TEXT, { timeout: ms(20_000) })
  await expect(native.getByRole('button', { name: 'Attach saved copy', exact: true })).toHaveCount(0)
  await expect(native.getByRole('button', { name: 'Attach', exact: true })).toHaveCount(0)
  await matrix(page, browser, text, info, 'untracked-project-document')
  expect(await page.evaluate(() => (window as any).__untrackedBrowse.snapshots)).toBe(0)
})

test('disconnect retires an untracked preview and cancels only its pending native operation', async ({ page }) => {
  await fixture(page)
  await page.goto(`/contexts/${ID}`)
  const detail = page.locator(`[data-local-git-detail="${ID}"]`)
  const { browser } = await openUntracked(detail)
  await browser.getByRole('button', { name: 'List untracked paths', exact: true }).click()
  await select(browser, HELD)
  await expect.poll(() => page.evaluate(() => typeof (window as any).__untrackedBrowse.resolvePreview)).toBe('function')
  await detail.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.locator('[data-resource-unavailable="missing"]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__untrackedBrowse.cancelled.length)).toBe(1)
  const cancelled = await page.evaluate(() => (window as any).__untrackedBrowse.cancelled[0])
  expect(cancelled).toMatchObject({ connectionId: ID, scope: 'untracked', userId: 'user-ada' })
  expect(cancelled.operationId).toBe(await page.evaluate(() => (window as any).__untrackedBrowse.previews[0].operationId))
  await page.evaluate(() => (window as any).__untrackedBrowse.resolvePreview())
  await expect(page.getByText('LATE_PRIVATE_UNTRACKED', { exact: true })).toHaveCount(0)
})

test('account changes clear untracked opt-in and fence late native preview results', async ({ page }) => {
  await fixture(page)
  await page.goto('/')
  for (const who of ['ada', 'grace']) {
    const result = await page.request.post(`${API}/auth/login`, { data: { email: `${who}@acme.example`, password: `${who}-demo-password` } })
    expect(result.ok()).toBeTruthy()
  }
  await page.reload()
  const switchTo = async (name: string) => {
    const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
    if (await expand.isVisible()) await expand.click()
    await page.getByTestId('account-chip').click()
    await page.getByTestId('account-stack-option').filter({ hasText: name }).first().click()
    await expect(page.getByTestId('account-chip')).toContainText(name)
  }
  await switchTo('Ada Lovelace')
  await page.goto(`/contexts/${ID}`)
  const detail = page.locator(`[data-local-git-detail="${ID}"]`)
  const { browser } = await openUntracked(detail)
  await browser.getByRole('button', { name: 'List untracked paths', exact: true }).click()
  await select(browser, HELD)
  await expect.poll(() => page.evaluate(() => typeof (window as any).__untrackedBrowse.resolvePreview)).toBe('function')
  await switchTo('Grace Hopper')
  await page.evaluate(() => (window as any).__untrackedBrowse.resolvePreview())
  await expect(page.locator('[data-local-git-untracked-browser]')).toHaveCount(0)
  await expect(page.getByText('LATE_PRIVATE_UNTRACKED', { exact: true })).toHaveCount(0)
  await switchTo('Ada Lovelace')
  await page.goto(`/contexts/${ID}`)
  await expect(detail.getByRole('checkbox', { name: 'Browse untracked files', exact: true })).not.toBeChecked()
})
