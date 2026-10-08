/** Browser proof for the authorized, exact UTF-8 conversation Markdown export. */
import { readFile } from 'node:fs/promises'
import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import type { ConversationExport, Message } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function createConversation(page: Page, firstMessage: string) {
  const response = await page.request.post(`${API}/sessions`, {
    data: { firstMessage, persistFirstMessage: true },
    headers: { 'Idempotency-Key': `conversation-export-create-${crypto.randomUUID()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const created = await response.json() as { id: string }
  expect(created.id).toBeTruthy()
  return created.id
}

async function sendMessage(page: Page, id: string, text: string, key: string) {
  const response = await page.request.post(`${API}/sessions/${encodeURIComponent(id)}/messages`, {
    data: { text },
    headers: { 'Idempotency-Key': key },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
}

async function grantReader(page: Page, id: string) {
  const response = await page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'session', id }, audience: { kind: 'org', orgId: READER }, tier: 'view' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return await response.json() as { id: string }
}

async function openExportDialog(page: Page) {
  const opener = page.getByRole('button', { name: 'Download conversation', exact: true })
  await expect(opener).toBeVisible()
  const dialog = page.getByRole('dialog', { name: 'Download conversation', exact: true })
  if (!(await dialog.isVisible())) await opener.click()
  await expect(dialog).toBeVisible()
  return dialog
}

async function downloadAndCompare(page: Page, expected: ConversationExport) {
  const dialog = await openExportDialog(page)
  const action = dialog.getByRole('button', { name: 'Download Markdown', exact: true })
  await expect(action).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await action.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(expected.filename)
  const path = await download.path()
  expect(path).toBeTruthy()
  expect(await readFile(path!, 'utf8')).toBe(expected.content)
}

async function assertDialogFitsAndCapture(page: Page, testInfo: TestInfo, label: string, unavailable = false) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    const dialog = await openExportDialog(page)
    if (unavailable) {
      await dialog.getByRole('button', { name: 'Download Markdown', exact: true }).click()
      await expect(dialog.getByRole('alert')).toHaveText('This conversation is no longer available to this account.')
    }
    const bounds = await dialog.locator('[data-bounded-dialog="conversation-download"]').boundingBox()
    expect(bounds, `${label} dialog has rendered bounds at ${viewport.width}×${viewport.height}`).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const details = dialog.locator('[data-dialog-read-region]')
    await details.focus()
    await expect(details).toBeFocused()
    await details.press('End')
    await expect(dialog.getByRole('button', { name: 'Download Markdown', exact: true })).toBeInViewport()
    await assertWcag22Aa(page, `conversation export ${label} ${viewport.width}×${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`conversation-export-${label}-${viewport.width}x${viewport.height}.png`) })
    await dialog.getByRole('button', { name: 'Close', exact: true }).press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Download conversation', exact: true })).toBeFocused()
  }
}

async function stackAdaAndGrace(page: Page) {
  for (const [email, password] of [
    ['ada@acme.example', 'ada-demo-password'],
    ['grace@acme.example', 'grace-demo-password'],
  ]) {
    const response = await page.request.post(`${API}/auth/login`, { data: { email, password } })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
  await page.reload()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: 'Ada Lovelace' }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
}

function pendingGate() {
  let release!: () => void
  let ready!: () => void
  let settled!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const readyPromise = new Promise<void>((resolve) => { ready = resolve })
  const settledPromise = new Promise<void>((resolve) => { settled = resolve })
  return { gate, ready, readyPromise, release, settled, settledPromise }
}

test('owner and granted reader download exact current and archived UTF-8 Markdown; export dialogs stay bounded', async ({ browser }: { browser: Browser }, testInfo) => {
  test.setTimeout(ms(180_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': READER })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': FOREIGN })
  try {
    const archivedText = 'Archive exact text — café\n東京 stays on its own line 😀.'
    const id = await createConversation(owner.page, archivedText)
    const stamp = crypto.randomUUID()
    for (let index = 0; index < 6; index += 1) {
      await sendMessage(owner.page, id, `Current export turn ${index} ${stamp}.`, `conversation-export-${stamp}-${index}`)
    }
    const compacted = await owner.page.request.post(`${API}/sessions/${encodeURIComponent(id)}/compact`, {
      data: {}, headers: { 'Idempotency-Key': `conversation-export-compact-${stamp}` },
    })
    expect(compacted.ok(), await compacted.text()).toBeTruthy()
    const archiveResponse = await owner.page.request.get(`${API}/sessions/${encodeURIComponent(id)}/compacted-messages?limit=100`)
    expect(archiveResponse.ok()).toBeTruthy()
    const archive = await archiveResponse.json() as { items: Message[] }
    expect(archive.items.some((message) => message.content === archivedText), 'the exact Unicode source turn is retained in the archive').toBe(true)

    const grant = await grantReader(owner.page, id)
    // Keep the reader's already-open view stale through revocation. The export
    // action must use a fresh authorized endpoint read, not the retained pane.
    await reader.page.route(`**${API}/events*`, (route) => route.abort())
    for (const page of [owner.page, reader.page]) {
      await page.goto(`/s/${encodeURIComponent(id)}`)
      await expect(page.locator(`[data-conversation-pane="${id}"]`)).toBeVisible({ timeout: ms(20_000) })
    }

    const ownerResponse = await owner.page.request.get(`${API}/sessions/${encodeURIComponent(id)}/export`)
    expect(ownerResponse.ok(), await ownerResponse.text()).toBeTruthy()
    const expected = await ownerResponse.json() as ConversationExport
    expect(expected).toMatchObject({
      sessionId: id,
      mediaType: 'text/markdown;charset=utf-8',
      archivedMessageCount: archive.items.length,
    })
    expect(expected.filename).toMatch(/\.md$/u)
    expect(expected.messageCount).toBeGreaterThan(expected.archivedMessageCount)
    expect(expected.content).toContain('## Archived messages')
    expect(expected.content).toContain(archivedText)
    expect(expected.content).toContain('## Current messages')
    expect(expected.content).toContain(`Current export turn 5 ${stamp}.`)

    const readerResponse = await reader.page.request.get(`${API}/sessions/${encodeURIComponent(id)}/export`)
    expect(readerResponse.ok(), await readerResponse.text()).toBeTruthy()
    expect(await readerResponse.json()).toEqual(expected)
    await downloadAndCompare(owner.page, expected)
    await downloadAndCompare(reader.page, expected)

    // A second activation after a newly persisted turn must read a newer
    // snapshot, not reuse the first descriptor or a cached Blob.
    const latestText = `Fresh export read ${stamp} — naïve façade.`
    await sendMessage(owner.page, id, latestText, `conversation-export-late-${stamp}`)
    const refreshedResponse = await owner.page.request.get(`${API}/sessions/${encodeURIComponent(id)}/export`)
    expect(refreshedResponse.ok()).toBeTruthy()
    const refreshed = await refreshedResponse.json() as ConversationExport
    expect(refreshed.messageCount).toBeGreaterThan(expected.messageCount)
    expect(refreshed.archivedMessageCount).toBe(expected.archivedMessageCount)
    expect(refreshed.content).toContain(latestText)
    await downloadAndCompare(owner.page, refreshed)

    await assertDialogFitsAndCapture(owner.page, testInfo, 'owner')
    await assertDialogFitsAndCapture(reader.page, testInfo, 'reader')

    const foreignResponse = await foreign.page.request.get(`${API}/sessions/${encodeURIComponent(id)}/export`)
    expect(foreignResponse.status()).toBe(404)
    await foreign.page.goto(`/s/${encodeURIComponent(id)}`)
    await expect(foreign.page.getByRole('button', { name: 'Download conversation', exact: true })).toHaveCount(0)

    const revoked = await owner.page.request.delete(`${API}/grants/${encodeURIComponent(grant.id)}`)
    expect(revoked.ok(), await revoked.text()).toBeTruthy()
    expect((await reader.page.request.get(`${API}/sessions/${encodeURIComponent(id)}/export`)).status()).toBe(404)
    const staleDialog = await openExportDialog(reader.page)
    let staleDownloads = 0
    reader.page.on('download', () => { staleDownloads += 1 })
    await staleDialog.getByRole('button', { name: 'Download Markdown', exact: true }).click()
    await expect(staleDialog.getByRole('alert')).toHaveText('This conversation is no longer available to this account.')
    expect(staleDownloads).toBe(0)
    await assertDialogFitsAndCapture(reader.page, testInfo, 'revoked', true)
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})

test('invalid identity, active, and oversized exports fail closed and permit a fresh retry', async ({ page }, testInfo) => {
  test.setTimeout(ms(60_000))
  const id = await createConversation(page, `Retry export fixture ${crypto.randomUUID()}.`)
  await page.goto(`/s/${encodeURIComponent(id)}`)
  const expectedResponse = await page.request.get(`${API}/sessions/${encodeURIComponent(id)}/export`)
  expect(expectedResponse.ok()).toBeTruthy()
  const expected = await expectedResponse.json() as ConversationExport
  const endpoint = `**${API}/sessions/${encodeURIComponent(id)}/export`
  let attempts = 0
  await page.route(endpoint, async (route) => {
    attempts += 1
    if (attempts === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...expected, sessionId: 'another-session', content: 'must not download' }),
      })
    } else if (attempts === 2) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'conflict', message: 'An active reply is still running.' } }) })
    } else if (attempts === 3) {
      await route.fulfill({ status: 413, contentType: 'application/json', body: JSON.stringify({ error: { code: 'bad_request', message: 'The transcript is too large.' } }) })
    } else {
      await route.continue()
    }
  })
  let downloads = 0
  page.on('download', () => { downloads += 1 })

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const dialog = await openExportDialog(page)
    const request = page.waitForRequest((candidate) => candidate.url().includes(`/sessions/${id}/export`) && candidate.method() === 'GET')
    await dialog.getByRole('button', { name: 'Download Markdown', exact: true }).click()
    await request
    await expect.poll(() => attempts).toBe(attempt)
    await expect(dialog.getByRole('alert')).toHaveText([
      'Could not download this conversation. Check your connection and try again.',
      'Wait for the current reply to finish, then try again.',
      'This conversation exceeds the 8 MiB download limit. Nothing was downloaded.',
    ][attempt - 1])
    expect(downloads).toBe(0)
  }

  const dialog = await openExportDialog(page)
  const finalRequest = page.waitForRequest((candidate) => candidate.url().includes(`/sessions/${id}/export`) && candidate.method() === 'GET')
  const finalDownload = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download Markdown', exact: true }).click()
  await finalRequest
  const download = await finalDownload
  expect(attempts).toBe(4)
  expect(download.suggestedFilename()).toBe(expected.filename)
  const path = await download.path()
  expect(path).toBeTruthy()
  expect(await readFile(path!, 'utf8')).toBe(expected.content)
  expect(downloads).toBe(1)
  await page.unroute(endpoint)
  await page.screenshot({ path: testInfo.outputPath('conversation-export-recovered.png') })
})

test('pending exports coalesce and never download after Close, navigation, or account switch', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const id = await createConversation(page, `Cancellation export fixture ${crypto.randomUUID()}.`)
  await page.goto('/projects')
  await page.goto(`/s/${encodeURIComponent(id)}`)
  const endpoint = `**${API}/sessions/${encodeURIComponent(id)}/export`
  const gates: ReturnType<typeof pendingGate>[] = []
  let requests = 0
  let settled = 0
  await page.route(endpoint, async (route) => {
    requests += 1
    const gate = gates.shift()
    const response = await route.fetch()
    gate?.ready()
    if (gate) await gate.gate
    try {
      await route.fulfill({ response })
    } catch {
      // Navigation intentionally aborts the pending response; no late download is allowed.
    } finally {
      settled += 1
      gate?.settled()
    }
  })
  let downloads = 0
  page.on('download', () => { downloads += 1 })

  // Duplicate activation during the same pending read is one network request.
  const closeGate = pendingGate()
  gates.push(closeGate)
  let dialog = await openExportDialog(page)
  const closeAction = dialog.getByRole('button', { name: 'Download Markdown', exact: true })
  await closeAction.click()
  await closeGate.readyPromise
  await expect.poll(() => requests).toBe(1)
  await closeAction.evaluate((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(requests).toBe(1)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  closeGate.release()
  await closeGate.settledPromise
  expect(downloads).toBe(0)

  // In-app navigation leaves the page mounted; the held old response must not
  // trigger a download after its destination changes.
  const navGate = pendingGate()
  gates.push(navGate)
  dialog = await openExportDialog(page)
  await dialog.getByRole('button', { name: 'Download Markdown', exact: true }).click()
  await navGate.readyPromise
  await page.goBack()
  await expect(page).toHaveURL(/\/projects$/u)
  navGate.release()
  await navGate.settledPromise
  expect(downloads).toBe(0)

  // A user can close the modal and switch accounts while its read is held.
  // The already-fetched owner snapshot must not download into the new world.
  await stackAdaAndGrace(page)
  await page.goto(`/s/${encodeURIComponent(id)}`)
  await expect(page.locator(`[data-conversation-pane="${id}"]`)).toBeVisible()
  const accountGate = pendingGate()
  gates.push(accountGate)
  dialog = await openExportDialog(page)
  await dialog.getByRole('button', { name: 'Download Markdown', exact: true }).click()
  await accountGate.readyPromise
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: 'Grace Hopper' }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await expect(dialog).toHaveCount(0)
  accountGate.release()
  await accountGate.settledPromise
  expect(downloads).toBe(0)
  expect(settled).toBe(3)
})

test('optional download loading can be closed and a failed module recovers only by explicit reload', async ({ page }) => {
  const id = await createConversation(page, `Loading export fixture ${crypto.randomUUID()}.`)
  const gate = pendingGate()
  await page.route('**/src/components/ConversationDownload.tsx', async route => {
    gate.ready()
    await gate.gate
    await route.abort('failed')
    gate.settled()
  })
  let exportReads = 0
  page.on('request', request => { if (request.url().endsWith(`/sessions/${id}/export`)) exportReads += 1 })
  await page.goto(`/s/${id}`)
  const opener = page.getByRole('button', { name: 'Download conversation', exact: true })
  await opener.click()
  await gate.readyPromise
  await expect(page.getByText('Loading conversation download…', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close download', exact: true }).click()
  gate.release()
  await gate.settledPromise
  await expect(page.getByRole('dialog', { name: 'Download conversation' })).toHaveCount(0)
  await opener.click()
  await expect(page.getByText('Couldn’t load conversation download. Copy any unsent text before reloading.', { exact: true })).toBeVisible()
  await page.unroute('**/src/components/ConversationDownload.tsx')
  await page.getByRole('button', { name: 'Reload app', exact: true }).click()
  await openExportDialog(page)
  expect(exportReads).toBe(0, 'opening or recovering the module never exports anything')
})

test('choosing Download while Find is loading supersedes that dialog without a late focus takeover', async ({ page }) => {
  const id = await createConversation(page, `Exclusive conversation tools ${crypto.randomUUID()}.`)
  const gate = pendingGate()
  await page.route('**/src/components/ConversationSearch.tsx', async route => {
    gate.ready()
    await gate.gate
    await route.continue()
    gate.settled()
  })
  await page.goto(`/s/${id}`)
  await page.getByRole('button', { name: 'Find in conversation', exact: true }).click()
  await gate.readyPromise
  await expect(page.getByText('Loading conversation search…', { exact: true })).toBeVisible()
  const dialog = await openExportDialog(page)
  await expect(page.getByText('Loading conversation search…', { exact: true })).toHaveCount(0)
  const loaded = page.waitForResponse(response => response.url().endsWith('/src/components/ConversationSearch.tsx'))
  gate.release()
  await gate.settledPromise
  await loaded
  await expect(page.getByRole('dialog', { name: 'Find in conversation', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Download Markdown', exact: true })).toBeFocused()
})
