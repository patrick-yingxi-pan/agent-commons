/** Rendered owner-only Artifact history, exact restore retries, and access walls. */
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { ArtifactItem } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function createArtifact(page: Page, name: string, kind: 'doc' | 'sheet' | 'slide', body: unknown) {
  const response = await page.request.post(`${API}/artifacts`, {
    data: { name, kind, body },
    headers: { 'Idempotency-Key': `artifact-history-create-${crypto.randomUUID()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const created = await response.json() as { artifact: ArtifactItem }
  expect(created.artifact.name).toBe(name)
  return created.artifact
}

async function editDocument(page: Page, artifactId: string, revision: number, text: string) {
  const response = await page.request.patch(`${API}/artifacts/${artifactId}/content`, {
    data: { block: 0, text, expectedRevision: revision },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

async function editStructuredArtifact(page: Page, artifactId: string, revision: number, content: unknown) {
  const response = await page.request.patch(`${API}/artifacts/${artifactId}/content`, {
    data: { content, expectedRevision: revision },
    headers: { 'Idempotency-Key': `artifact-history-edit-${crypto.randomUUID()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

async function readHistory(page: Page, artifactId: string) {
  const response = await page.request.get(`${API}/artifacts/${artifactId}/history`)
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json() as Promise<{ artifactId: string; currentRevision: number; versions: { revision: number; reason: string; restoredFromRevision?: number }[] }>
}

function artifactPage(page: Page, id: string) {
  return page.locator(`[data-artifact-page="${id}"]`)
}

async function captureHistoryState(page: Page, subject: Locator, testInfo: TestInfo, label: string, controls: Locator[] = []) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(subject).toBeVisible()
    await subject.scrollIntoViewIfNeeded()
    await expect(subject).toBeInViewport()
    for (const control of controls) {
      await expect(control).toBeVisible()
      await control.scrollIntoViewIfNeeded()
      await expect(control).toBeInViewport()
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.width}x${viewport.height}.png`) })
    await assertWcag22Aa(page, `${label} ${viewport.width}x${viewport.height}`)
  }
}

async function stackArtifactAccounts(page: Page) {
  for (const [email, password] of [
    ['ada@acme.example', 'ada-demo-password'],
    ['grace@acme.example', 'grace-demo-password'],
  ]) {
    const response = await page.request.post(`${API}/auth/login`, { data: { email, password } })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
}

async function switchArtifactAccount(page: Page, name: string) {
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: name }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText(name, { timeout: ms(10_000) })
}

async function openArtifact(page: Page, artifact: ArtifactItem) {
  await page.goto(`/artifacts/${artifact.id}`)
  await expect(artifactPage(page, artifact.id)).toBeVisible({ timeout: ms(20_000) })
}

async function leaveAndReturnToArtifact(page: Page, artifact: ArtifactItem) {
  const expandSidebar = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expandSidebar.isVisible()) await expandSidebar.click()
  await page.getByRole('navigation').getByRole('button', { name: 'Artifacts', exact: true }).click()
  const row = page.locator('[data-artifact-preview-row]').filter({ has: page.getByRole('button', { name: artifact.name, exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: artifact.name, exact: true }).click()
  await expect(artifactPage(page, artifact.id)).toBeVisible()
}

async function grantToGrace(page: Page, artifactId: string) {
  const response = await page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'artifact', id: artifactId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
}

test('failed recovery modules preserve the workspace and refuse history intent until explicit reload', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  for (const moduleName of ['ShellMutationNotices', 'ArtifactHistoryRestoreMutationNotice']) {
    await page.setViewportSize({ width: 1280, height: 800 })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let blocked = true
    let intercepted = false
    const modulePath = `**/src/components/${moduleName}.tsx*`
    await page.route(modulePath, async (route) => {
      if (!blocked) return route.continue()
      intercepted = true
      await gate
      await route.abort('failed')
    })
    try {
      const navigation = page.goto('/s/draft')
      const composer = page.getByRole('textbox', { name: 'Message', exact: true })
      await expect(composer).toBeVisible()
      const draft = `Unsent work survives ${moduleName} failure.`
      await composer.fill(draft)
      await expect.poll(() => intercepted).toBe(true)
      release()
      await navigation
      const failure = page.locator('[data-shell-recovery-load-error]')
      await expect(failure.getByRole('alert')).toBeVisible()
      await expect(failure).toContainText('retry details')
      await expect(failure).toContainText('saved state')
      await expect(composer).toHaveValue(draft)
      await captureHistoryState(page, failure, testInfo, `artifact-history-recovery-module-${moduleName}`, [failure.getByRole('button', { name: 'Reload app', exact: true })])
      await expect(composer).toHaveValue(draft)

      const artifact = await createArtifact(page, `module-history-${crypto.randomUUID()}.md`, 'doc', 'Original retained body.')
      await editDocument(page, artifact.id, 0, 'Current body remains unchanged during module recovery.')
      // Same-document navigation preserves both the unsent draft and the failed
      // module map; only the explicit Reload below may retry a rejected import.
      await leaveAndReturnToArtifact(page, artifact)
      let restores = 0
      const countRestore = (request: import('@playwright/test').Request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/artifacts/${artifact.id}/history/0/restore`) restores += 1
      }
      page.on('request', countRestore)
      try {
        const detail = artifactPage(page, artifact.id)
        await expect(detail).toContainText('Current body remains unchanged during module recovery.')
        await detail.getByRole('button', { name: 'Load history', exact: true }).click()
        await expect(detail.getByText('Couldn’t display history. Check recovery and copy unsent text before reloading.', { exact: true })).toBeVisible()
        await expect(detail.getByRole('button', { name: /^Restore version/ })).toHaveCount(0)
        expect(restores).toBe(0)
        expect((await readHistory(page, artifact.id)).currentRevision).toBe(1)

        blocked = false
        await failure.getByRole('button', { name: 'Reload app', exact: true }).click()
        await expect(failure).toHaveCount(0)
        await detail.getByRole('button', { name: 'Load history', exact: true }).click()
        await detail.locator('[data-artifact-history-version="0"]').click()
        await detail.getByRole('button', { name: 'Restore version 0', exact: true }).click()
        await page.getByRole('dialog', { name: 'Restore artifact version', exact: true }).getByRole('button', { name: 'Restore version', exact: true }).click()
        await expect(detail.locator('[data-resource-section="Content"]')).toContainText('Original retained body.')
        await expect(detail.locator('[data-artifact-history-version="2"]')).toBeVisible()
        expect(restores).toBe(1)
      } finally {
        page.off('request', countRestore)
      }
    } finally {
      release()
      await page.unroute(modulePath)
    }
  }
})

test('owner history previews immutable revisions, follows another-device edits, and restores by appending', async ({ browser, page }, testInfo) => {
  test.setTimeout(ms(120_000))
  await page.goto('/')
  const secondOwnerContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
  const secondOwner = await secondOwnerContext.newPage()
  try {
  const stamp = Date.now().toString(36)
  const baseline = `History baseline ${stamp}.`
  const firstEdit = `First saved edit ${stamp}.`
  const secondEdit = `Second device edit ${stamp}.`
  const artifact = await createArtifact(page, `history-${stamp}.md`, 'doc', baseline)
  await editDocument(page, artifact.id, 0, firstEdit)
  await openArtifact(page, artifact)
  const detail = artifactPage(page, artifact.id)

  let historyReads = 0
  await page.route(`**${API}/artifacts/${artifact.id}/history**`, async (route) => {
    if (new URL(route.request().url()).pathname !== `${API}/artifacts/${artifact.id}/history`) return route.continue()
    historyReads += 1
    if (historyReads === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'temporarily_unavailable', message: 'retry' } }) })
    return route.continue()
  })
  await detail.getByRole('button', { name: 'Load history', exact: true }).click()
  const historyError = detail.getByText('Couldn’t load version history.', { exact: true })
  await expect(historyError).toBeVisible()
  await detail.getByRole('button', { name: 'Retry history load', exact: true }).click()
  await expect(historyError).toHaveCount(0)
  expect(historyReads).toBe(2)
  const baselineRow = detail.locator('[data-artifact-history-version="0"]')
  const firstRow = detail.locator('[data-artifact-history-version="1"]')
  await expect(baselineRow).toBeVisible()
  await expect(firstRow).toBeVisible()
  await baselineRow.click()
  const preview = detail.locator('[data-artifact-history-body]')
  await expect(detail.getByRole('heading', { name: 'Version 0 · Baseline', exact: true })).toBeVisible()
  await expect(preview).toContainText(baseline)
  await expect(preview).not.toContainText(firstEdit)
  await captureHistoryState(page, preview, testInfo, 'artifact-history-preview')

  // An independently opened owner surface edits the latest revision while this
  // history remains mounted. The metadata timeline must advance from the live
  // event without a page navigation or a second Load history action.
  await editDocument(secondOwner, artifact.id, 1, secondEdit)
  const secondRow = detail.locator('[data-artifact-history-version="2"]')
  await expect(secondRow).toBeVisible({ timeout: ms(10_000) })
  await secondRow.click()
  await expect(detail.getByRole('heading', { name: 'Version 2 · Edited', exact: true })).toBeVisible()
  await expect(detail.locator('[data-artifact-history-body]')).toContainText('Current version')
  const liveHistory = await readHistory(page, artifact.id)
  expect(liveHistory).toMatchObject({ currentRevision: 2 })

  await baselineRow.click()
  await detail.getByRole('button', { name: 'Restore version 0', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Restore artifact version', exact: true })
  await expect(confirmation).toContainText('Restore version 0')
  await expect(confirmation).toContainText('current version 2')
  await captureHistoryState(page, confirmation, testInfo, 'artifact-history-restore-confirmation', [
    confirmation.getByRole('button', { name: 'Cancel', exact: true }),
    confirmation.getByRole('button', { name: 'Restore version', exact: true }),
  ])
  await confirmation.getByRole('button', { name: 'Restore version', exact: true }).click()

  await expect(page.getByRole('dialog', { name: 'Restore artifact version', exact: true })).toHaveCount(0)
  const finalHistory = await readHistory(page, artifact.id)
  expect(finalHistory).toMatchObject({
    currentRevision: 3,
    versions: [
      { revision: 3, reason: 'restore', restoredFromRevision: 0 },
      { revision: 2, reason: 'edit' },
      { revision: 1, reason: 'edit' },
      { revision: 0, reason: 'baseline' },
    ],
  })
  const restored = await page.request.get(`${API}/artifacts/${artifact.id}/history/3`)
  expect(restored.ok()).toBeTruthy()
  expect((await restored.json()).version.body).toMatchObject({ type: 'doc', blocks: [{ p: baseline }] })
  await expect(detail.locator('[data-resource-section="Content"]').locator('p', { hasText: baseline })).toBeVisible()
  } finally {
    await secondOwnerContext.close()
  }
})

test('history Load older adds the bounded continuation and preserves its boundary after a live edit', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = Date.now().toString(36)
  const baseline = `Paging baseline ${stamp}.`
  const artifact = await createArtifact(page, `history-pages-${stamp}.md`, 'doc', baseline)
  for (let revision = 0; revision < 51; revision += 1) {
    await editDocument(page, artifact.id, revision, `Paging edit ${revision + 1} ${stamp}.`)
  }
  await openArtifact(page, artifact)
  const detail = artifactPage(page, artifact.id)
  await detail.getByRole('button', { name: 'Load history', exact: true }).click()
  await expect(detail.locator('[data-artifact-history-version="51"]')).toBeVisible()
  await expect(detail.locator('[data-artifact-history-version="2"]')).toBeVisible()
  await expect(detail.locator('[data-artifact-history-version="1"]')).toHaveCount(0)
  await detail.getByRole('button', { name: 'Load older', exact: true }).click()
  await expect(detail.locator('[data-artifact-history-version="1"]')).toBeVisible()
  await expect(detail.locator('[data-artifact-history-version="0"]')).toBeVisible()

  await editDocument(page, artifact.id, 51, `Live paging edit ${stamp}.`)
  await expect(detail.locator('[data-artifact-history-version="52"]')).toBeVisible({ timeout: ms(10_000) })
  const revisionRows = detail.locator('[data-artifact-history-version]')
  await expect(revisionRows).toHaveCount(53)
  const revisions = await revisionRows.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-artifact-history-version')))
  expect(revisions).toEqual(Array.from({ length: 53 }, (_, index) => String(52 - index)))
  await detail.locator('[data-artifact-history-version="0"]').click()
  await expect(detail.locator('[data-artifact-history-body]')).toContainText(baseline)
  await expect(detail.locator('[data-artifact-history-body]')).not.toContainText(`Live paging edit ${stamp}.`)
})

test('shared readers see current document, workbook and slides only; history stays owner-only', async ({ browser }, testInfo) => {
  test.setTimeout(ms(90_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const stamp = Date.now().toString(36)
  const fixtures = [
    { kind: 'doc' as const, name: `history-reader-${stamp}.md`, body: `Prior document ${stamp}.`, currentBody: `Current document ${stamp}.`, visible: `Current document ${stamp}.`, prior: `Prior document ${stamp}.` },
    { kind: 'sheet' as const, name: `history-reader-${stamp}.sheet`, body: { type: 'workbook', sheets: [
      { id: 'overview', name: 'Overview', columns: ['Metric', 'Value'], rows: [['metric', `Prior workbook ${stamp}.`]] },
      { id: 'details', name: 'Details', columns: ['Field', 'Value'], rows: [['status', 'ready']] },
    ] }, currentBody: { type: 'workbook', sheets: [
      { id: 'overview', name: 'Overview', columns: ['Metric', 'Value'], rows: [['metric', `Current workbook ${stamp}.`]] },
      { id: 'details', name: 'Details', columns: ['Field', 'Value'], rows: [['status', 'published']] },
    ] }, visible: `Current workbook ${stamp}.`, prior: `Prior workbook ${stamp}.` },
    { kind: 'slide' as const, name: `history-reader-${stamp}.slides`, body: { type: 'slides', slides: [{ title: `Prior slide ${stamp}.`, bullets: [`Prior slide body ${stamp}.`] }] }, currentBody: { type: 'slides', slides: [{ title: `Current slide ${stamp}.`, bullets: [`Current slide body ${stamp}.`] }] }, visible: `Current slide ${stamp}.`, prior: `Prior slide ${stamp}.` },
  ]
  try {
    const artifacts = []
    for (const fixture of fixtures) {
      const artifact = await createArtifact(owner.page, fixture.name, fixture.kind, fixture.body)
      if (fixture.kind === 'doc') await editDocument(owner.page, artifact.id, 0, fixture.currentBody)
      else await editStructuredArtifact(owner.page, artifact.id, 0, fixture.currentBody)
      artifacts.push({ ...fixture, artifact })
      await grantToGrace(owner.page, artifact.id)
    }

    let capturedForeignUnavailable = false
    for (const fixture of artifacts) {
      await openArtifact(owner.page, fixture.artifact)
      const ownerDetail = artifactPage(owner.page, fixture.artifact.id)
      await ownerDetail.getByRole('button', { name: 'Load history', exact: true }).click()
      await ownerDetail.locator('[data-artifact-history-version="0"]').click()
      const priorBody = ownerDetail.locator('[data-artifact-history-body]')
      await expect(priorBody).toContainText(fixture.prior)
      await expect(priorBody).not.toContainText(fixture.visible)
      if (fixture.kind !== 'doc') {
        await captureHistoryState(owner.page, priorBody, testInfo, `artifact-history-owner-${fixture.kind}-preview`)
      }

      await openArtifact(reader.page, fixture.artifact)
      const detail = artifactPage(reader.page, fixture.artifact.id)
      await expect(detail).toContainText(fixture.visible)
      await expect(detail).not.toContainText(fixture.prior)
      await captureHistoryState(reader.page, detail.locator('[data-resource-section="Content"]'), testInfo, `artifact-history-shared-${fixture.kind}`)
      await expect(detail.getByRole('button', { name: 'Load history', exact: true })).toHaveCount(0)
      await expect(detail.getByRole('button', { name: /^(Edit block|Edit sheet|Edit slides)/ })).toHaveCount(0)
      const currentLibrary = await (await reader.page.request.get(`${API}/artifact-content`)).json()
      expect(JSON.stringify(currentLibrary[fixture.artifact.id])).toContain(fixture.visible)
      expect(JSON.stringify(currentLibrary[fixture.artifact.id])).not.toContain(fixture.prior)
      expect((await reader.page.request.get(`${API}/artifacts/${fixture.artifact.id}/history`)).status()).toBe(404)
      expect((await reader.page.request.get(`${API}/artifacts/${fixture.artifact.id}/history/0`)).status()).toBe(404)
      await foreign.page.goto(`/artifacts/${fixture.artifact.id}`)
      await expect(artifactPage(foreign.page, fixture.artifact.id)).toHaveCount(0)
      const unavailable = foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).')
      await expect(unavailable).toBeVisible()
      if (!capturedForeignUnavailable) {
        await captureHistoryState(foreign.page, unavailable, testInfo, 'artifact-history-foreign-unavailable')
        capturedForeignUnavailable = true
      }
      expect((await foreign.page.request.get(`${API}/artifacts/${fixture.artifact.id}/history`)).status()).toBe(404)
    }
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})

test('restore keeps one reviewed revision and key through navigation, pre-commit failure, and lost acknowledgement', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  await stackArtifactAccounts(page)
  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await switchArtifactAccount(page, 'Ada Lovelace')
  const stamp = Date.now().toString(36)
  const baseline = `Retained restore body ${stamp}.`
  const artifact = await createArtifact(page, `history-retry-${stamp}.md`, 'doc', baseline)
  await editDocument(page, artifact.id, 0, `Pre-restore edit ${stamp}.`)
  await openArtifact(page, artifact)
  const detail = artifactPage(page, artifact.id)
  await detail.getByRole('button', { name: 'Load history', exact: true }).click()
  const baselineRow = detail.locator('[data-artifact-history-version="0"]')
  await baselineRow.click()
  await detail.getByRole('button', { name: 'Restore version 0', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Restore artifact version', exact: true })

  let attempts = 0
  const payloads: unknown[] = []
  const keys: string[] = []
  let releaseLostResponse!: () => void
  const lostResponseGate = new Promise<void>((resolve) => { releaseLostResponse = resolve })
  await page.route(`**${API}/artifacts/${artifact.id}/history/*/restore`, async (route) => {
    attempts += 1
    payloads.push(route.request().postDataJSON())
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'temporarily_unavailable', message: 'retry' } }) })
    if (attempts === 2) {
      await lostResponseGate
      const committed = await route.fetch()
      expect(committed.status()).toBe(200)
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'temporarily_unavailable', message: 'ack lost' } }) })
    }
    return route.continue()
  })

  await confirmation.getByRole('button', { name: 'Restore version', exact: true }).click()
  const failed = page.locator('[data-artifact-history-restore-status]')
  await expect(failed).toBeVisible()
  await expect(failed.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  expect(attempts).toBe(1)
  await captureHistoryState(page, failed, testInfo, 'artifact-history-restore-failed', [failed.getByRole('button', { name: 'Retry', exact: true })])

  // Leave the canonical page using the app rail, then return through the real
  // artifact row. The recovery notice must keep its exact revision/key.
  await leaveAndReturnToArtifact(page, artifact)
  const retry = failed.getByRole('button', { name: 'Retry', exact: true })
  await retry.click()
  await expect.poll(() => attempts).toBe(2)
  await expect(failed).toHaveAttribute('data-pending', 'true')
  releaseLostResponse()
  await expect(failed).toBeVisible()
  await expect(failed).not.toHaveAttribute('data-pending', 'true')
  await page.locator('[data-artifact-history-restore-status]').getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.locator('[data-artifact-history-restore-status]')).toHaveCount(0)
  expect(attempts).toBe(3)
  expect(keys[0]).toBeTruthy()
  expect(keys[1]).toBe(keys[0])
  expect(keys[2]).toBe(keys[0])
  expect(payloads).toEqual([{ expectedRevision: 1 }, { expectedRevision: 1 }, { expectedRevision: 1 }])
  expect((await readHistory(page, artifact.id)).currentRevision).toBe(2)

  // A later pending restore is fenced when this same browser switches account:
  // the old-owner body and acknowledgement never enter Grace's view.
  await detail.getByRole('button', { name: 'Load history', exact: true }).click()
  await editDocument(page, artifact.id, 2, `Later edit ${stamp}.`)
  await expect(detail.locator('[data-artifact-history-version="3"]')).toBeVisible()
  await detail.locator('[data-artifact-history-version="0"]').click()
  await detail.getByRole('button', { name: 'Restore version 0', exact: true }).click()
  const accountSwitchConfirmation = page.getByRole('dialog', { name: 'Restore artifact version', exact: true })
  let releasePending!: () => void
  const pendingGate = new Promise<void>((resolve) => { releasePending = resolve })
  await page.route(`**${API}/artifacts/${artifact.id}/history/*/restore`, async (route) => {
    attempts += 1
    await pendingGate
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'temporarily_unavailable', message: 'late old-account response' } }) })
  })
  await accountSwitchConfirmation.getByRole('button', { name: 'Restore version', exact: true }).click()
  await expect.poll(() => attempts).toBe(4)
  const held = page.locator('[data-artifact-history-restore-status][data-pending="true"]')
  await expect(held).toBeVisible()
  await switchArtifactAccount(page, 'Grace Hopper')
  await expect(page.locator('[data-artifact-history-restore-status]')).toHaveCount(0)
  // Keep the document alive so the held old-account HTTP response actually
  // arrives; a full navigation would cancel it instead of testing the fence.
  await expect(artifactPage(page, artifact.id)).toHaveCount(0)
  await expect(page.getByText(baseline, { exact: true })).toHaveCount(0)
  const lateResponse = page.waitForResponse((response) => response.url().includes(`/artifacts/${artifact.id}/history/0/restore`) && response.request().method() === 'POST')
  releasePending()
  expect((await lateResponse).status()).toBe(503)
  await expect(page.getByText(baseline, { exact: true })).toHaveCount(0)
})

test('stale restore refusal cannot rebase; the owner must review the version again', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const baseline = `Reviewed body ${stamp}.`
  const artifact = await createArtifact(page, `history-stale-${stamp}.md`, 'doc', baseline)
  await editDocument(page, artifact.id, 0, `First current edit ${stamp}.`)
  await openArtifact(page, artifact)
  const detail = artifactPage(page, artifact.id)
  await detail.getByRole('button', { name: 'Load history', exact: true }).click()
  await detail.locator('[data-artifact-history-version="0"]').click()
  await detail.getByRole('button', { name: 'Restore version 0', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Restore artifact version', exact: true })
  const concurrent = `Concurrent current edit ${stamp}.`
  let restoreRequests = 0
  const expectedRevisions: number[] = []
  await page.route(`**${API}/artifacts/${artifact.id}/history/*/restore`, async (route) => {
    restoreRequests += 1
    expectedRevisions.push(route.request().postDataJSON().expectedRevision)
    if (restoreRequests === 1) await editDocument(page, artifact.id, 1, concurrent)
    return route.continue()
  })
  await confirmation.getByRole('button', { name: 'Restore version', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  const stale = page.locator('[data-artifact-history-restore-status]')
  await expect(stale).toContainText('This artifact changed before the restore. Dismiss this reviewed action, reload history, and review the version again.')
  await expect(stale.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
  expect(restoreRequests).toBe(1)
  expect(expectedRevisions).toEqual([1])
  expect((await readHistory(page, artifact.id)).currentRevision).toBe(2)
  await expect(detail.locator('[data-resource-section="Content"]').locator('p', { hasText: concurrent })).toBeVisible()

  // Fresh selection/confirmation is the only path that binds the reviewed
  // snapshot to currentRevision=2; stale intent is never silently rebased.
  await stale.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(stale).toHaveCount(0)
  await detail.getByRole('button', { name: 'Reload history', exact: true }).click()
  await detail.locator('[data-artifact-history-version="0"]').click()
  await detail.getByRole('button', { name: 'Restore version 0', exact: true }).click()
  const reviewedAgain = page.getByRole('dialog', { name: 'Restore artifact version', exact: true })
  await expect(reviewedAgain).toContainText('current version 2')
  await reviewedAgain.getByRole('button', { name: 'Restore version', exact: true }).click()
  await expect(detail.locator('[data-resource-section="Content"]').locator('p', { hasText: baseline })).toBeVisible()
  expect(restoreRequests).toBe(2)
  expect(expectedRevisions).toEqual([1, 2])
  expect((await readHistory(page, artifact.id)).currentRevision).toBe(3)
})

test('Trash preserves owner inspection history but does not expose a body restore action', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const baseline = `Trashed history body ${stamp}.`
  const artifact = await createArtifact(page, `history-trash-${stamp}.md`, 'doc', baseline)
  await editDocument(page, artifact.id, 0, `Current body in Trash ${stamp}.`)
  const trashed = await page.request.patch(`${API}/artifacts/${artifact.id}/lifecycle`, { data: { state: 'trashed', expectedRevision: 0 } })
  expect(trashed.ok(), await trashed.text()).toBeTruthy()
  await openArtifact(page, artifact)
  const detail = artifactPage(page, artifact.id)
  await expect(detail.getByText('In Trash', { exact: true })).toBeVisible()
  await detail.getByRole('button', { name: 'Load history', exact: true }).click()
  const row = detail.locator('[data-artifact-history-version="0"]')
  await expect(row).toBeVisible()
  await row.click()
  await expect(detail.locator('[data-artifact-history-body]')).toContainText(baseline)
  await expect(detail.getByRole('button', { name: 'Restore version 0', exact: true })).toHaveCount(0)
  const refused = await page.request.post(`${API}/artifacts/${artifact.id}/history/0/restore`, {
    data: { expectedRevision: 1 },
    headers: { 'Idempotency-Key': `trash-history-restore-${stamp}` },
  })
  expect(refused.status()).toBe(409)
  expect((await readHistory(page, artifact.id)).currentRevision).toBe(1)
})
