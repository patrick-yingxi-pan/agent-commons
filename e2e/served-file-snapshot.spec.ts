/** Rendered coverage for explicit served-file snapshots. Intake and Refresh
 * are the only source reads; sending, reopening, and a shared preview use the
 * copy already saved with the conversation. */
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { assertWcag22Aa, settledAttachmentPreview } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { tierFor } from '../src/lib/viewport.ts'
import { startMessagesFixture } from './attachment-endpoint.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

const SOURCE_PATH = '/api/v1/fs/snapshot?source=cloud&path=notes.md'
const ATTACHMENT_ID = 'cloud::notes.md'
const SAVED_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

async function pickerFile(page: Page, picker: ReturnType<Page['getByRole']>, name: RegExp) {
  // The overflow rows render in a portaled flyout outside the dialog subtree.
  const file = page.getByRole('button', { name }).first()
  const moreFiles = picker.getByRole('button', { name: /^More files\b/ })
  const visibleDirectly = await Promise.race([
    file.waitFor({ state: 'visible', timeout: ms(15_000) }).then(() => true),
    moreFiles.waitFor({ state: 'visible', timeout: ms(15_000) }).then(() => false),
  ])
  if (!visibleDirectly) {
    await moreFiles.click()
  }
  await expect(file, `the picker reveals ${name}`).toBeVisible({ timeout: ms(15_000) })
  return file
}

async function createSession(page: Page, userId = 'user-ada', tenantId = `tenant-served-snapshot-${randomUUID()}`, providerId?: string) {
  await page.context().setExtraHTTPHeaders({ 'x-user-id': userId, 'x-tenant-id': tenantId })
  const response = await page.request.post('/api/v1/sessions', { data: providerId ? { providerId } : {} })
  expect(response.ok(), 'the browser creates a real owner-scoped session').toBe(true)
  return (await response.json() as { id: string }).id
}

async function addServedNote(page: Page) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Files/ }).click()
  const note = await pickerFile(page, picker, /^notes\.md(?:\s|$)/)
  await note.click()
  await expect(page.locator('[data-attachment-input-disclosure]')).toContainText(/1 text file/i, { timeout: ms(15_000) })
  // This is a multi-add picker: even though this selection focuses its saved
  // preview, the picker stays usable through its explicit Done action.
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(picker).toHaveCount(0)
  // Preview focus and the narrow dock are restored asynchronously after the
  // intake dialog closes. Do not click its underlying composer chip during
  // that transition; the dock may already be covering it.
  await settledAttachmentPreview(page)
  const preview = page.locator('[data-attachment-preview]').filter({ visible: true })
  await expect(preview).toHaveCount(1)
  return preview
}

function visibleMutationNotice(page: Page, role: 'status' | 'alert', message: string) {
  const host = tierFor(page.viewportSize()!.width) === 'wide'
    ? page.locator('[data-context-pane]').filter({ visible: true })
    : page.locator('[data-overlay-dock]').filter({ visible: true })
  return host.getByRole(role).filter({ hasText: message }).filter({ visible: true })
}

function savedSnapshotIn(preview: ReturnType<Page['locator']>) {
  return preview.locator('[data-served-snapshot="saved"]')
}

function missingSnapshotIn(preview: ReturnType<Page['locator']>) {
  return preview.locator('[data-served-snapshot="missing"]')
}

async function assertNoHorizontalOverflow(page: Page, size: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), {
    message: `${size} served snapshot state has no horizontal overflow`,
  }).toBe(true)
}

async function capture(page: Page, testInfo: TestInfo, state: string, viewport: { width: number; height: number }) {
  const size = `${viewport.width}x${viewport.height}`
  await assertNoHorizontalOverflow(page, size)
  await assertWcag22Aa(page, `Served snapshot ${state} ${size}`)
  await mkdir('.data/screenshots', { recursive: true })
  await page.screenshot({ path: `.data/screenshots/served-snapshot-${state}-${size}-${testInfo.workerIndex}.png`, fullPage: true })
}

async function assertShellTier(page: Page, viewport: { width: number; height: number }) {
  const tier = tierFor(viewport.width)
  const dock = page.locator('[data-overlay-dock]').filter({ visible: true })
  if (tier === 'wide') {
    await expect(dock).toHaveCount(0)
    await expect(page.locator('[data-context-pane]').filter({ visible: true })).toHaveCount(1)
  } else {
    await expect(dock).toHaveCount(1)
    await expect(dock).toHaveAttribute('data-overlay-dock', tier)
  }
}

async function capturePanelLoadState(
  page: Page,
  testInfo: TestInfo,
  phase: 'loading' | 'error',
  viewport: typeof VIEWPORTS[number],
) {
  const state = page.locator(`[data-attachment-panel-load="${phase}"]`).filter({ visible: true })
  await expect(state).toHaveCount(1)
  await assertShellTier(page, viewport)
  await capture(page, testInfo, `panel-${phase}`, viewport)
}

async function servedSnapshotWalk(page: Page, testInfo: TestInfo, viewport: typeof VIEWPORTS[number]) {
  test.setTimeout(ms(90_000))
  await page.setViewportSize(viewport)
  const sessionId = await createSession(page)
  let intakeReads = 0
  await page.route(`**${SOURCE_PATH}`, async (route) => {
    intakeReads += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      version: 1,
      snapshotId: SAVED_UUID,
      capturedAt: '2026-10-04T12:00:00.000Z',
      sourceId: 'cloud',
      path: 'notes.md',
      text: `Prior saved copy ${testInfo.workerIndex} must remain until refresh.`,
    }) })
  })

  const refreshBodies: unknown[] = []
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
  const refreshPattern = `**/api/v1/sessions/${sessionId}/attachments/${encodeURIComponent(ATTACHMENT_ID)}/refresh`
  await page.route(refreshPattern, async (route) => {
    const payload = route.request().postDataJSON() as unknown
    refreshBodies.push(payload)
    if (refreshBodies.length === 1) {
      await firstGate
      const body = JSON.stringify({ error: { code: 'internal', message: 'The source is temporarily unavailable.' } })
      await route.fulfill({ status: 503, contentType: 'application/json', body })
      return
    }
    await route.continue()
  })

  try {
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const preview = await addServedNote(page)
    expect(intakeReads, 'the selected source is explicitly snapshotted once').toBe(1)
    await expect(savedSnapshotIn(preview)).toBeVisible()
    await expect(preview).toContainText('Prior saved copy')
    await expect(preview.getByRole('button', { name: 'Refresh saved copy', exact: true })).toBeEnabled()
    await capture(page, testInfo, 'saved', viewport)

    const refresh = preview.getByRole('button', { name: 'Refresh saved copy', exact: true })
    await refresh.click()
    const pending = visibleMutationNotice(page, 'status', 'Updating context…')
    await expect(pending).toHaveCount(1)
    await expect(pending).toBeVisible({ timeout: ms(10_000) })
    await expect(refresh).toBeDisabled()
    if (tierFor(viewport.width) !== 'narrow') {
      await expect(page.getByRole('textbox', { name: 'Message', exact: true }).filter({ visible: true })).toBeDisabled()
    }
    await expect(preview).toContainText('Prior saved copy')
    await capture(page, testInfo, 'pending', viewport)

    releaseFirst()
    const failure = visibleMutationNotice(page, 'alert', 'Couldn’t confirm the context update.')
    await expect(failure).toHaveCount(1)
    await expect(failure).toBeVisible({ timeout: ms(10_000) })
    await expect(failure).toContainText('The source is temporarily unavailable.')
    await expect(failure.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    await expect(failure.getByRole('button', { name: 'Use saved state', exact: true })).toBeVisible()
    await expect(preview).toContainText('Prior saved copy')
    await capture(page, testInfo, 'error', viewport)

    // Retry replays the original logical write unchanged; the server reads the
    // real sample-cloud file and returns the authoritative saved workspace.
    const retry = failure.getByRole('button', { name: 'Retry', exact: true })
    const acknowledged = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/sessions/${sessionId}/attachments/`) &&
      response.url().endsWith('/refresh') && response.request().method() === 'POST')
    await retry.click()
    const response = await acknowledged
    expect(response.ok(), 'the exact retry reaches the real refresh route').toBe(true)
    const result = await response.json() as { workspace: { attachments: Array<{ textSnapshot?: { snapshotId: string; text: string } }> } }
    const refreshed = result.workspace.attachments.find((item) => item.textSnapshot?.snapshotId === (refreshBodies[0] as { requestId: string }).requestId)
    expect(refreshed?.textSnapshot?.text).toBeTruthy()
    expect(refreshed?.textSnapshot?.text).not.toContain('Prior saved copy')
    expect(refreshBodies).toHaveLength(2)
    expect(refreshBodies[1], 'Retry retains expectedSnapshotId and requestId').toEqual(refreshBodies[0])
    await expect(savedSnapshotIn(preview)).toBeVisible()
    await expect(preview).toContainText(refreshed!.textSnapshot!.text)
    expect(intakeReads, 'Refresh uses its targeted route; it does not repeat intake').toBe(1)
  } finally {
    releaseFirst()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
}

test('served-file saved, pending, failure, and Use saved state remain clear at 320×700', async ({ page }, testInfo) =>
  servedSnapshotWalk(page, testInfo, VIEWPORTS[0]))

test('served-file saved, pending, failure, and Use saved state remain clear at 375×812', async ({ page }, testInfo) =>
  servedSnapshotWalk(page, testInfo, VIEWPORTS[1]))

test('served-file saved, pending, failure, and Use saved state remain clear at 768×1024', async ({ page }, testInfo) =>
  servedSnapshotWalk(page, testInfo, VIEWPORTS[2]))

test('served-file saved, pending, failure, and Use saved state remain clear at 844×390', async ({ page }, testInfo) =>
  servedSnapshotWalk(page, testInfo, VIEWPORTS[3]))

test('served-file saved, pending, failure, and Use saved state remain clear at 1280×800', async ({ page }, testInfo) =>
  servedSnapshotWalk(page, testInfo, VIEWPORTS[4]))

test('file intake leaves the picker open for a second served file and Done at every viewport', async ({ page }) => {
  test.setTimeout(ms(120_000))
  const tenantId = `tenant-served-multiadd-${randomUUID()}`
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    const sessionId = await createSession(page, 'user-ada', tenantId)
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
    await picker.getByRole('button', { name: /^Files/ }).click()
    const first = await pickerFile(page, picker, /^notes\.md(?:\s|$)/)
    const second = await pickerFile(page, picker, /^q3-roadmap\.md(?:\s|$)/)
    await first.click()
    await expect(page.locator('[data-attachment-input-disclosure]')).toContainText(/1 text file/i)
    await expect(picker).toBeVisible()
    await expect(second).toBeVisible()
    await expect(second).toBeEnabled()
    await second.click()
    await expect(page.locator('[data-attachment-input-disclosure]')).toContainText(/2 text files/i, { timeout: ms(15_000) })
    await expect(picker).toBeVisible()
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(picker).toHaveCount(0)
    await settledAttachmentPreview(page)
    const preview = page.locator('[data-attachment-preview]').filter({ visible: true })
    await expect(preview).toHaveCount(1)
    await expect(savedSnapshotIn(preview)).toBeVisible()
    const savedSession = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as {
      workspace: { attachments: Array<{ id: string; textSnapshot?: { path: string } }> }
    }
    expect(savedSession.workspace.attachments.map((item) => item.id).sort()).toEqual(['cloud::notes.md', 'cloud::q3-roadmap.md'])
    expect(savedSession.workspace.attachments.every((item) => item.textSnapshot?.path)).toBe(true)
  }
})

test('failed served-file intake stays unattached and Retry repeats the exact source snapshot read', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  try {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      const sessionId = await createSession(page)
      let attempts = 0
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const failFirstSnapshot = async (route: import('@playwright/test').Route) => {
        attempts += 1
        if (attempts === 1) {
          await gate
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Snapshot temporarily unavailable.' } }) })
          return
        }
        await route.continue()
      }
      await page.route(`**${SOURCE_PATH}`, failFirstSnapshot)
      try {
        await page.goto(`/s/${encodeURIComponent(sessionId)}`)
        await page.getByRole('button', { name: 'Add context', exact: true }).click()
        const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
        await picker.getByRole('button', { name: /^Files/ }).click()
        const note = await pickerFile(page, picker, /^notes\.md(?:\s|$)/)
        const intakeRequest = page.waitForRequest((request) => request.url().includes(SOURCE_PATH), { timeout: ms(10_000) })
        await note.click()
        await intakeRequest
        await expect(picker.locator('[data-fs-file-read="loading"]')).toBeVisible()
        await expect(note).toBeDisabled()
        release()
        const error = picker.locator('[data-fs-file-read="error"]')
        await expect(error).toBeVisible({ timeout: ms(10_000) })
        await expect(error).toContainText('Could not read notes.md. Nothing was attached.')
        await expect(error.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
        const session = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as { workspace: { attachments: unknown[] } }
        expect(session.workspace.attachments, 'failed intake never creates an attachment').toHaveLength(0)
        await capture(page, testInfo, 'intake-error', viewport)

        await error.getByRole('button', { name: 'Retry', exact: true }).click()
        await expect(page.locator('[data-attachment-input-disclosure]')).toContainText(/1 text file/i, { timeout: ms(15_000) })
        expect(attempts).toBe(2)
        const recovered = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as { workspace: { attachments: Array<{ textSnapshot?: { path: string; text: string } }> } }
        expect(recovered.workspace.attachments[0]?.textSnapshot?.path).toBe('notes.md')
        expect(recovered.workspace.attachments[0]?.textSnapshot?.text).toBeTruthy()
      } finally {
        release()
        await page.unroute(`**${SOURCE_PATH}`, failFirstSnapshot)
      }
    }
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('blocked attachment preview chunk announces loading and failure at each tier, then reloads on request', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  const initial = VIEWPORTS[4]
  await page.setViewportSize(initial)
  const sessionId = await createSession(page)
  let releaseChunk!: () => void
  const chunkGate = new Promise<void>((resolve) => { releaseChunk = resolve })
  let block = true
  await page.route('**/src/components/AttachmentPanel.tsx*', async (route) => {
    if (block) {
      await chunkGate
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  try {
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
    await picker.getByRole('button', { name: /^Files/ }).click()
    const note = picker.getByRole('button', { name: /^notes\.md(?:\s|$)/ }).first()
    await expect(note).toBeVisible({ timeout: ms(15_000) })
    const panelChunk = page.waitForRequest((request) => /\/src\/components\/AttachmentPanel\.tsx/.test(request.url()), { timeout: ms(10_000) })
    await note.click()
    await expect(page.locator('[data-attachment-input-disclosure]')).toContainText(/1 text file/i, { timeout: ms(15_000) })
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    await panelChunk
    const loading = page.locator('[data-attachment-panel-load="loading"]').filter({ visible: true })
    await expect(loading).toHaveCount(1)
    await expect(loading).toContainText('Loading attachment preview…')

    // Hold the actual Vite lazy-import request while walking every canonical
    // viewport. The shell must follow the current tier without exposing panel
    // commands before the complete preview chunk is admitted.
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect(loading).toBeVisible()
      await capturePanelLoadState(page, testInfo, 'loading', viewport)
    }

    releaseChunk()
    const error = page.locator('[data-attachment-panel-load="error"]').filter({ visible: true })
    await expect(error).toHaveCount(1, { timeout: ms(15_000) })
    await expect(page.getByRole('alert').filter({ visible: true })).toContainText('Copy any unsent text before reloading.')
    await expect(error.getByRole('button', { name: 'Reload preview', exact: true })).toBeVisible()
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expect(error).toBeVisible()
      await capturePanelLoadState(page, testInfo, 'error', viewport)
    }

    block = false
    await error.getByRole('button', { name: 'Reload preview', exact: true }).click()
    await settledAttachmentPreview(page)
    const preview = page.locator('[data-attachment-preview]').filter({ visible: true })
    await expect(preview).toHaveCount(1)
    await expect(savedSnapshotIn(preview)).toBeVisible()
    await expect(preview).toContainText(/Insights ships behind the `insights` flag/)
    await expect(page.locator('[data-attachment-panel-load]')).toHaveCount(0)
  } finally {
    block = false
    releaseChunk()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('lost Refresh acknowledgement retries the same durable request; send and reload never reread source', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await page.setViewportSize(VIEWPORTS[4])
  const modelFixture = await startMessagesFixture()
  try {
    const tenantId = `tenant-served-snapshot-input-${randomUUID()}`
    await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': tenantId })
    const providerResponse = await page.request.post('/api/v1/providers', { data: {
      label: `Served snapshot input ${randomUUID()}`,
      modelFamily: 'claude',
      effortLevels: ['Default'],
      config: { baseURL: modelFixture.url, model: 'e2e-attachment-model' },
    } })
    expect(providerResponse.ok(), 'a deterministic local model endpoint receives the real conversation input').toBe(true)
    const provider = await providerResponse.json() as { id: string }
    const sessionId = await createSession(page, 'user-ada', tenantId, provider.id)
    const priorText = 'This prior copy is replaced only by explicit Refresh.'
    const priorSnapshotId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    let intakeReads = 0
    await page.route(`**${SOURCE_PATH}`, async (route) => {
      intakeReads += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        version: 1, snapshotId: priorSnapshotId, capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'notes.md', text: priorText,
      }) })
    })
    const bodies: Array<{ expectedSnapshotId: string | null; requestId: string }> = []
    let firstResult: { workspace: { attachments: Array<{ textSnapshot?: { snapshotId: string; text: string } }> } } | undefined
    const refreshPath = `/api/v1/sessions/${sessionId}/attachments/${encodeURIComponent(ATTACHMENT_ID)}/refresh`
    await page.route(`**${refreshPath}`, async (route) => {
      bodies.push(route.request().postDataJSON() as { expectedSnapshotId: string | null; requestId: string })
      if (bodies.length === 1) {
        // The server commits the snapshot, then the browser loses only its
        // acknowledgement. Retry must replay the same requestId receipt.
        const committed = await route.fetch()
        expect(committed.ok()).toBe(true)
        firstResult = await committed.json() as typeof firstResult
        await route.abort('failed')
        return
      }
      await route.continue()
    })

    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const preview = await addServedNote(page)
    await expect(preview).toContainText(priorText)
    await preview.getByRole('button', { name: 'Refresh saved copy', exact: true }).click()
    const failure = visibleMutationNotice(page, 'alert', 'Couldn’t confirm the context update.')
    await expect(failure).toHaveCount(1)
    await expect(failure).toBeVisible({ timeout: ms(15_000) })
    expect(firstResult?.workspace.attachments[0]?.textSnapshot?.snapshotId).toBe(bodies[0]?.requestId)
    expect(firstResult?.workspace.attachments[0]?.textSnapshot?.text).not.toBe(priorText)
    const committedText = firstResult!.workspace.attachments[0]!.textSnapshot!.text
    await expect(preview).toContainText(committedText, { timeout: ms(10_000) })
    await expect(failure).toBeVisible()
    await expect(preview.getByRole('button', { name: 'Refresh saved copy', exact: true })).toBeDisabled()
    await expect(page.getByRole('textbox', { name: 'Message', exact: true }).filter({ visible: true })).toBeDisabled()

    const retryResponse = page.waitForResponse((response) => response.url().endsWith('/refresh') && response.request().method() === 'POST')
    await failure.getByRole('button', { name: 'Retry', exact: true }).click()
    const acknowledged = await retryResponse
    expect(acknowledged.ok()).toBe(true)
    expect(bodies).toHaveLength(2)
    expect(bodies[1], 'same-key retry preserves exact precondition and receipt identity').toEqual(bodies[0])
    const result = await acknowledged.json() as typeof firstResult
    const saved = result?.workspace.attachments[0]?.textSnapshot
    expect(saved?.snapshotId).toBe(bodies[0]?.requestId)
    expect(saved?.text).toBe(firstResult?.workspace.attachments[0]?.textSnapshot?.text)
    expect(saved?.text).not.toBe(priorText)
    await expect(preview).toContainText(saved!.text)
    expect(intakeReads).toBe(1)

    await page.reload()
    await settledAttachmentPreview(page)
    const restored = page.locator('[data-attachment-preview]').filter({ visible: true })
    await expect(restored).toHaveCount(1)
    await expect(savedSnapshotIn(restored)).toBeVisible()
    await expect(restored).toContainText(saved!.text)
    expect(intakeReads, 'reopening uses the persisted snapshot instead of the source').toBe(1)

    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await composer.fill('Summarize the saved note.')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: /Read supplied attachment: # Notes/ })).toBeVisible({ timeout: ms(25_000) })
    expect(modelFixture.documents.at(-1)?.attached_files).toEqual([{ name: 'notes.md', status: 'ready', text: saved!.text }])
    expect(intakeReads, 'model preparation also uses the saved snapshot with no source reread').toBe(1)
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await new Promise<void>((resolve) => modelFixture.server.close(() => resolve()))
  }
})

test('a pre-Refresh session read cannot overwrite the newer saved snapshot', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await page.setViewportSize(VIEWPORTS[4])
  const sessionId = await createSession(page)
  const priorText = 'Prior copy captured before the concurrent refresh.'
  const priorSnapshotId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  let intakeReads = 0
  await page.route(`**${SOURCE_PATH}`, async (route) => {
    intakeReads += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      version: 1,
      snapshotId: priorSnapshotId,
      capturedAt: '2026-10-04T12:00:00.000Z',
      sourceId: 'cloud',
      path: 'notes.md',
      text: priorText,
    }) })
  })

  const sessionPath = `/api/v1/sessions/${sessionId}`
  const heldReads: Array<{ body: string; delivered: Promise<void> }> = []
  let releaseHeldReads!: () => void
  const heldGate = new Promise<void>((resolve) => { releaseHeldReads = resolve })
  let resolveFirstHeldRead!: () => void
  const firstHeldRead = new Promise<void>((resolve) => { resolveFirstHeldRead = resolve })
  let staleReadsArmed = false
  let refreshRequestStarted = false
  const onRequest = (request: import('@playwright/test').Request) => {
    if (request.method() === 'POST' && request.url().endsWith(`/attachments/${encodeURIComponent(ATTACHMENT_ID)}/refresh`)) {
      refreshRequestStarted = true
    }
  }

  await page.route(`**${sessionPath}*`, async (route) => {
    const request = route.request()
    if (!staleReadsArmed || request.method() !== 'GET' || new URL(request.url()).pathname !== sessionPath || refreshRequestStarted) {
      await route.continue()
      return
    }

    // Capture the real old server representation now, but defer delivery to
    // the browser until the explicit Refresh has committed a newer snapshot.
    const response = await route.fetch()
    const body = (await response.body()).toString('utf8')
    let resolveDelivered!: () => void
    const delivered = new Promise<void>((resolve) => { resolveDelivered = resolve })
    heldReads.push({ body, delivered })
    if (heldReads.length === 1) resolveFirstHeldRead()
    await heldGate
    await route.fulfill({ response, body, headers: { ...response.headers(), 'x-test-held-stale-read': 'true' } })
    resolveDelivered()
  })

  const onSessionReadFailure = () => { releaseHeldReads() }
  page.on('close', onSessionReadFailure)
  page.on('request', onRequest)
  try {
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const preview = await addServedNote(page)
    expect(intakeReads).toBe(1)
    await expect(preview).toContainText(priorText)

    const current = await (await page.request.get(sessionPath)).json() as { metadataRevision?: number }
    expect(typeof current.metadataRevision, 'the real title patch is revision-pinned').toBe('number')
    const patchDrivenRead = page.waitForRequest((request) =>
      request.method() === 'GET' && new URL(request.url()).pathname === sessionPath,
      { timeout: ms(10_000) },
    )
    staleReadsArmed = true
    const renamed = await page.request.patch(sessionPath, {
      data: { title: `Refresh race ${randomUUID()}`, expectedRevision: current.metadataRevision },
    })
    expect(renamed.ok(), 'the real session-title patch emits the mounted pane freshness push').toBe(true)
    await patchDrivenRead
    await firstHeldRead
    const oldPayload = JSON.parse(heldReads[0]!.body) as {
      workspace: { attachments: Array<{ id: string; textSnapshot?: { snapshotId: string; text: string } }> }
    }
    const heldOldSnapshot = oldPayload.workspace.attachments.find((item) => item.id === ATTACHMENT_ID)?.textSnapshot
    expect(heldOldSnapshot).toMatchObject({ snapshotId: priorSnapshotId, text: priorText })

    const refreshResponseWait = page.waitForResponse((response) =>
      response.url().endsWith(`/attachments/${encodeURIComponent(ATTACHMENT_ID)}/refresh`) &&
      response.request().method() === 'POST',
      { timeout: ms(15_000) },
    )
    await preview.getByRole('button', { name: 'Refresh saved copy', exact: true }).click()
    const refreshResponse = await refreshResponseWait
    expect(refreshResponse.ok()).toBe(true)
    const refreshed = await refreshResponse.json() as {
      workspace: { attachments: Array<{ id: string; textSnapshot?: { snapshotId: string; text: string } }> }
    }
    const currentSnapshot = refreshed.workspace.attachments.find((item) => item.id === ATTACHMENT_ID)?.textSnapshot
    expect(currentSnapshot?.snapshotId).toBeTruthy()
    expect(currentSnapshot?.snapshotId).not.toBe(priorSnapshotId)
    expect(currentSnapshot?.text).toBeTruthy()
    expect(currentSnapshot?.text).not.toBe(priorText)
    await expect(preview).toContainText(currentSnapshot!.text)
    expect(heldReads.length).toBeGreaterThan(0)

    const oldReadResponse = page.waitForResponse((response) =>
      response.url().includes(sessionPath) && response.request().method() === 'GET' &&
      response.headers()['x-test-held-stale-read'] === 'true',
      { timeout: ms(10_000) },
    )
    const releasedReads = [...heldReads]
    releaseHeldReads()
    await oldReadResponse
    await Promise.all(releasedReads.map((read) => read.delivered))
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(preview).toContainText(currentSnapshot!.text)
    expect(intakeReads, 'the browser does not reread the served source during session reconciliation').toBe(1)
  } finally {
    releaseHeldReads()
    page.off('request', onRequest)
    page.off('close', onSessionReadFailure)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('Use saved state releases a failed Refresh without replacing the acknowledged copy', async ({ page }, testInfo) => {
  test.setTimeout(ms(60_000))
  const viewport = VIEWPORTS[4]
  await page.setViewportSize(viewport)
  const sessionId = await createSession(page)
  await page.route(`**${SOURCE_PATH}`, async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ version: 1, snapshotId: SAVED_UUID, capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'notes.md', text: 'Last confirmed copy remains visible.' }),
  }))
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route(`**/api/v1/sessions/${sessionId}/attachments/${encodeURIComponent(ATTACHMENT_ID)}/refresh`, async (route) => {
    await gate
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Refresh is unavailable.' } }) })
  })
  try {
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const preview = await addServedNote(page)
    await expect(preview).toContainText('Last confirmed copy remains visible.')
    const refresh = preview.getByRole('button', { name: 'Refresh saved copy', exact: true })
    await refresh.click()
    const pending = visibleMutationNotice(page, 'status', 'Updating context…')
    await expect(pending).toHaveCount(1)
    await expect(pending).toBeVisible()
    release()
    const failure = visibleMutationNotice(page, 'alert', 'Couldn’t confirm the context update.')
    await expect(failure).toHaveCount(1)
    await expect(failure).toBeVisible()
    await capture(page, testInfo, 'use-saved-error', viewport)
    await failure.getByRole('button', { name: 'Use saved state', exact: true }).click()
    await expect(failure).toHaveCount(0)
    await expect(refresh).toBeEnabled()
    await expect(preview).toContainText('Last confirmed copy remains visible.')
    await expect(page.getByRole('textbox', { name: 'Message', exact: true }).filter({ visible: true })).toBeEnabled()
  } finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('legacy served metadata starts missing and Save snapshot explicitly fills its saved copy', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  try {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      const sessionId = await createSession(page)
      const detail = await (await page.request.get(`/api/v1/sessions/${sessionId}`)).json() as { workspace?: Record<string, unknown> }
      const oldWorkspace = detail.workspace ?? { workspaces: [], repos: [], connectors: [], attachments: [] }
      const attachment = { id: ATTACHMENT_ID, label: 'notes.md', kind: 'file', source: { id: 'cloud', kind: 'cloud', label: 'Cloud storage' } }
      const attached = await page.request.patch(`/api/v1/sessions/${sessionId}/context-state`, {
        data: { operations: [], workspace: { ...oldWorkspace, attachments: [attachment] } },
      })
      expect(attached.ok(), 'the server accepts the legacy metadata-only attachment fixture').toBe(true)
      let intakeReads = 0
      const countIntakes = async (route: import('@playwright/test').Route) => { intakeReads += 1; await route.continue() }
      await page.route(`**${SOURCE_PATH}`, countIntakes)
      try {
        await page.goto(`/s/${encodeURIComponent(sessionId)}`)
        const chip = page.getByTitle('Open in sidebar').filter({ hasText: 'notes.md' })
        await expect(chip).toBeVisible()
        await chip.click()
        await settledAttachmentPreview(page)
        const preview = page.locator('[data-attachment-preview]').filter({ visible: true })
        await expect(preview).toHaveCount(1)
        await expect(missingSnapshotIn(preview)).toBeVisible()
        await expect(preview).toContainText('No saved text yet.')
        const save = preview.getByRole('button', { name: 'Save snapshot', exact: true })
        await expect(save).toBeEnabled()
        await capture(page, testInfo, 'missing', viewport)
        const ack = page.waitForResponse((response) => response.url().endsWith('/refresh') && response.request().method() === 'POST', { timeout: ms(10_000) })
        await save.click()
        const response = await ack
        expect(response.ok()).toBe(true)
        const refreshed = await response.json() as { workspace: { attachments: Array<{ textSnapshot?: { text: string } }> } }
        const savedText = refreshed.workspace.attachments[0]?.textSnapshot?.text
        expect(savedText).toBeTruthy()
        await expect(savedSnapshotIn(preview)).toBeVisible()
        await expect(preview).toContainText(savedText!)
        expect(intakeReads, 'Save snapshot uses the explicit session Refresh endpoint, not another picker intake').toBe(0)
      } finally {
        await page.unroute(`**${SOURCE_PATH}`, countIntakes)
      }
    }
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

test('fresh draft takes a source snapshot only on Add and explicit Refresh', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await page.setViewportSize(VIEWPORTS[4])
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-served-draft-${randomUUID()}` })
  let snapshotReads = 0
  let refreshPosts = 0
  page.on('request', (request) => {
    if (request.method() === 'GET' && request.url().includes('/api/v1/fs/snapshot?')) snapshotReads += 1
    if (request.method() === 'POST' && request.url().endsWith('/refresh')) refreshPosts += 1
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Files/ }).click()
  const note = picker.getByRole('button', { name: /^notes\.md(?:\s|$)/ }).first()
  await expect(note).toBeVisible({ timeout: ms(15_000) })
  const intakeWait = page.waitForResponse((response) => response.url().includes('/api/v1/fs/snapshot?source=cloud&path=notes.md'), { timeout: ms(10_000) })
  await note.click()
  const firstRead = await intakeWait
  expect(firstRead.ok()).toBe(true)
  const initial = await firstRead.json() as { snapshotId: string; text: string }
  await expect(page.locator('[data-attachment-input-disclosure]')).toContainText(/1 text file/i)
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await settledAttachmentPreview(page)
  const preview = page.locator('[data-attachment-preview]').filter({ visible: true })
  await expect(preview).toHaveCount(1)
  await expect(savedSnapshotIn(preview)).toBeVisible()
  await expect(preview).toContainText(initial.text)

  const refreshWait = page.waitForResponse((response) => response.url().includes('/api/v1/fs/snapshot?source=cloud&path=notes.md'), { timeout: ms(10_000) })
  await preview.getByRole('button', { name: 'Refresh saved copy', exact: true }).click()
  const refreshedRead = await refreshWait
  expect(refreshedRead.ok()).toBe(true)
  const refreshed = await refreshedRead.json() as { snapshotId: string; text: string }
  expect(refreshed.snapshotId).not.toBe(initial.snapshotId)
  expect(snapshotReads, 'the fresh draft source is read exactly on Add and Refresh').toBe(2)
  expect(refreshPosts, 'a client-only draft does not call the durable session Refresh route').toBe(0)
  await expect(preview).toContainText(refreshed.text)
})

test('saved served previews are readable to a viewer but only the owner can Refresh', async ({ browser }, testInfo) => {
  test.setTimeout(ms(90_000))
  const ownerContext = await browser.newContext({ extraHTTPHeaders: { 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-served-owner-${randomUUID()}` } })
  const readerContext = await browser.newContext({ extraHTTPHeaders: { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' } })
  const foreignContext = await browser.newContext({ extraHTTPHeaders: { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' } })
  const owner = await ownerContext.newPage()
  const reader = await readerContext.newPage()
  const foreign = await foreignContext.newPage()
  await owner.setViewportSize(VIEWPORTS[4])
  await reader.setViewportSize(VIEWPORTS[4])
  let ownerIntakes = 0
  let readerIntakes = 0
  let readerRefreshes = 0
  await owner.route(`**${SOURCE_PATH}`, async (route) => {
    ownerIntakes += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      version: 1, snapshotId: SAVED_UUID, capturedAt: '2026-10-04T12:00:00.000Z', sourceId: 'cloud', path: 'notes.md', text: 'Shared saved note text.',
    }) })
  })
  await reader.route('**/api/v1/fs/snapshot?*', async (route) => { readerIntakes += 1; await route.continue() })
  await reader.route('**/api/v1/sessions/*/attachments/*/refresh', async (route) => { readerRefreshes += 1; await route.continue() })
  try {
    const sessionId = await createSession(owner)
    await owner.goto(`/s/${encodeURIComponent(sessionId)}`)
    const ownerPreview = await addServedNote(owner)
    await expect(ownerPreview).toContainText('Shared saved note text.')
    const grantResponse = await owner.request.post('/api/v1/grants', {
      data: { subject: { kind: 'session', id: sessionId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(grantResponse.ok(), 'the real owner grants Grace view access to this conversation').toBe(true)

    await reader.goto(`/s/${encodeURIComponent(sessionId)}`)
    const sharedChip = reader.getByTitle('Open in sidebar').filter({ hasText: 'notes.md' })
    await expect(sharedChip).toBeVisible({ timeout: ms(15_000) })
    await sharedChip.click()
    await settledAttachmentPreview(reader)
    const sharedPreview = reader.locator('[data-attachment-preview]').filter({ visible: true })
    await expect(sharedPreview).toHaveCount(1)
    await expect(savedSnapshotIn(sharedPreview)).toBeVisible()
    await expect(sharedPreview).toContainText('Shared saved note text.')
    await expect(sharedPreview.getByRole('button', { name: 'Refresh saved copy', exact: true })).toHaveCount(0)
    // Keep the saved preview open while resizing: the viewer projection must
    // remain readable at every canonical tier without reading the source.
    for (const viewport of VIEWPORTS) {
      await reader.setViewportSize(viewport)
      await settledAttachmentPreview(reader)
      await expect(sharedPreview).toBeVisible()
      await expect(savedSnapshotIn(sharedPreview)).toBeVisible()
      await expect(sharedPreview).toContainText('Shared saved note text.')
      await expect(sharedPreview.getByRole('button', { name: 'Refresh saved copy', exact: true })).toHaveCount(0)
      await capture(reader, testInfo, 'shared-saved', viewport)
    }
    expect(ownerIntakes).toBe(1)
    expect(readerIntakes, 'opening a shared preview reads the saved snapshot only').toBe(0)
    expect(readerRefreshes, 'a view grant exposes no Refresh mutation').toBe(0)

    await foreign.setViewportSize(VIEWPORTS[4])
    const foreignRead = foreign.waitForResponse((response) =>
      response.url().includes(`/api/v1/sessions/${sessionId}`) && response.request().method() === 'GET',
      { timeout: ms(10_000) },
    )
    await foreign.goto(`/s/${encodeURIComponent(sessionId)}`)
    expect((await foreignRead).status(), 'opening the actual UI route hides an owner session from a foreign tenant').toBe(404)
    await expect(foreign.getByText('Shared saved note text.', { exact: false })).toHaveCount(0)
    await capture(foreign, testInfo, 'foreign-404', VIEWPORTS[4])
  } finally {
    await ownerContext.close()
    await readerContext.close()
    await foreignContext.close()
  }
})
