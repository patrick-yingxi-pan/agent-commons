/** Rendered cross-device recovery for durable artifact body edits. */
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { docBlockText, type ArtifactContentLibrary, type ArtifactItem } from '../contract/index.ts'
import { ms } from './budget.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { splitPane } from './pane-actions.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const RECOVERY_VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function createDocument(page: Page, stamp: string) {
  const name = `navigation-recovery-${stamp}.md`
  const response = await page.request.post('/api/v1/relations/ops', {
    data: { op: { kind: 'save-artifact', artifact: { name, kind: 'doc', meta: 'Document', body: 'Opening paragraph.\n\nSecond paragraph.' } } },
    headers: { 'Idempotency-Key': `artifact-nav-doc-${stamp}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const graph = await response.json() as { extraArtifacts: ArtifactItem[] }
  const artifact = graph.extraArtifacts.find((row) => row.name === name)
  expect(artifact).toBeTruthy()
  return { artifact: artifact!, name }
}

async function leaveAndReturnToArtifact(page: Page, id: string, name: string) {
  const expandSidebar = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expandSidebar.isVisible()) await expandSidebar.click()
  await page.getByRole('button', { name: 'Artifacts', exact: true }).first().click()
  const row = page.locator('[data-artifact-preview-row]').filter({ has: page.getByRole('button', { name, exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name, exact: true }).click()
  await expect(page.locator(`[data-artifact-page="${id}"]`).last()).toBeVisible()
}

async function captureRecoveryState(page: Page, detail: Locator, editor: Locator, competingEdit: Locator, testInfo: TestInfo, label: string, expected: string, held: boolean, competingEnabledAfterDismiss = true) {
  const original = page.viewportSize() ?? { width: 1280, height: 800 }
  for (const viewport of RECOVERY_VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await expect(detail).toBeVisible()
    await expect(editor).toHaveValue(expected)
    await editor.scrollIntoViewIfNeeded()
    if (held) {
      await expect(editor).toBeDisabled()
      await expect(competingEdit).toBeDisabled()
    } else {
      await expect(editor).toBeEnabled()
      if (competingEnabledAfterDismiss) await expect(competingEdit).toBeEnabled()
      else await expect(competingEdit).toBeDisabled()
    }
    await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.width}x${viewport.height}.png`) })
    await assertWcag22Aa(page, `${label} ${viewport.width}x${viewport.height}`)
  }
  await page.setViewportSize(original)
  await settleArtifactPageRail(page)
}

async function stackArtifactAccounts(page: Page) {
  for (const [email, password] of [
    ['ada@acme.example', 'ada-demo-password'],
    ['grace@acme.example', 'grace-demo-password'],
  ]) {
    const response = await page.request.post('/api/v1/auth/login', { data: { email, password } })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
}

async function switchArtifactAccount(page: Page, name: string) {
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: name }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText(name, { timeout: ms(10_000) })
}

test('a stale body edit loads the other device change and retries one held draft', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const { artifact } = await createDocument(page, `conflict-${stamp}`)
  const library = await (await page.request.get('/api/v1/artifact-content')).json() as ArtifactContentLibrary
  const body = library[artifact.id] ?? library[artifact.name]
  expect(body?.type).toBe('doc')
  if (!body || body.type !== 'doc') throw new Error('fixture must expose an editable document')
  const patchable = body.blocks
    .map((block, index) => ({ index, text: docBlockText(block) }))
    .filter((entry): entry is { index: number; text: string } => entry.text !== undefined)
  const remote = patchable[0]!
  const local = patchable[1]!
  const revision = body.revision ?? 0
  const remoteText = `${remote.text} Remote ${stamp}.`
  const localText = `${local.text} Local ${stamp}.`

  let attempts = 0
  const keys: string[] = []
  await page.route(`**/api/v1/artifacts/${artifact.id}/content`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      const concurrent = await page.request.patch(`/api/v1/artifacts/${artifact.id}/content`, {
        data: { block: remote.index, text: remoteText, expectedRevision: revision },
      })
      expect(concurrent.status()).toBe(200)
    }
    await route.continue()
  })

  await page.goto(`/artifacts/${artifact.id}`)
  const artifactPage = page.locator(`[data-artifact-page="${artifact.id}"]`)
  await expect(artifactPage).toBeVisible({ timeout: ms(20_000) })
  await artifactPage.getByRole('button', { name: `Edit block ${local.index + 1}` }).click()
  const editor = artifactPage.getByRole('textbox', { name: `Rewrite block ${local.index + 1}` })
  await editor.fill(localText)
  await artifactPage.getByRole('button', { name: 'Save', exact: true }).click()

  const failed = page.locator('[data-artifact-content-mutation="failed"]')
  await expect(failed).toContainText('changed elsewhere')
  await expect(artifactPage.getByText(remoteText)).toBeVisible()
  await expect(editor).toBeDisabled()
  await expect(artifactPage.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  expect(attempts).toBe(1)

  await failed.getByRole('button', { name: 'Retry' }).click()
  await expect(failed).toHaveCount(0)
  await expect(artifactPage.getByText(remoteText)).toBeVisible()
  await expect(artifactPage.getByText(localText)).toBeVisible()
  await expect(editor).toHaveCount(0)
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])

  const stored = await (await page.request.get('/api/v1/artifact-content')).json() as ArtifactContentLibrary
  const landed = stored[artifact.id] ?? stored[artifact.name]
  expect(landed?.revision).toBe(revision + 2)
  if (!landed || landed.type !== 'doc') throw new Error('stored artifact body must remain a document')
  expect(docBlockText(landed.blocks[remote.index]!)).toBe(remoteText)
  expect(docBlockText(landed.blocks[local.index]!)).toBe(localText)
})

test('New artifact creates a document whose authored content reopens after reload', async ({ page }) => {
  test.setTimeout(ms(30_000))
  const stamp = Date.now().toString(36)
  const name = `release-note-${stamp}.md`
  const first = `Release checkpoint ${stamp}.`
  const second = 'This content belongs to the document, not only its index synopsis.'

  await page.goto('/artifacts')
  await page.getByRole('button', { name: 'New artifact' }).click()
  const dialog = page.getByRole('dialog', { name: 'New artifact' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Content').fill(`${first}\n\n${second}`)
  await dialog.getByRole('button', { name: 'Create document' }).click()
  await expect(dialog).toHaveCount(0)

  const artifactPage = page.locator('[data-artifact-page]')
  await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
  await expect(artifactPage.locator('p', { hasText: first })).toBeVisible()
  await expect(artifactPage.locator('p', { hasText: second })).toBeVisible()
  await page.reload()
  await expect(artifactPage.locator('p', { hasText: first })).toBeVisible()
  await expect(artifactPage.locator('p', { hasText: second })).toBeVisible()
})

test('unsaved document prose survives in-app navigation and shared pane projection until explicit Cancel', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const { artifact, name } = await createDocument(page, `unsaved-${stamp}`)
  await page.goto(`/artifacts/${artifact.id}`)
  const firstPane = page.locator('[data-main-pane]').first()
  await firstPane.getByRole('button', { name: 'Edit block 1', exact: true }).click()
  const draft = `Unsubmitted document wording ${stamp}.`
  await firstPane.getByRole('textbox', { name: 'Rewrite block 1', exact: true }).fill(draft)

  await splitPane(page, 'right')
  await expect(page.locator('[data-main-pane]')).toHaveCount(2)
  const paneB = page.locator('[data-main-pane]').last()
  await expect(paneB.locator(`[data-artifact-page="${artifact.id}"]`).getByRole('textbox', { name: 'Rewrite block 1', exact: true })).toHaveValue(draft)
  await leaveAndReturnToArtifact(page, artifact.id, name)
  await expect(paneB.locator(`[data-artifact-page="${artifact.id}"]`).getByRole('textbox', { name: 'Rewrite block 1', exact: true })).toHaveValue(draft)
  await expect(firstPane.locator(`[data-artifact-page="${artifact.id}"]`).getByRole('textbox', { name: 'Rewrite block 1', exact: true })).toHaveValue(draft)

  await paneB.locator(`[data-artifact-page="${artifact.id}"]`).getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('[data-artifact-page] [aria-label="Rewrite block 1"]')).toHaveCount(0)
  await expect(page.locator(`[data-artifact-page="${artifact.id}"]`).locator('p', { hasText: 'Opening paragraph.' }).first()).toBeVisible()
  const library = await (await page.request.get('/api/v1/artifact-content')).json() as ArtifactContentLibrary
  const saved = library[artifact.id]
  expect(saved?.type).toBe('doc')
  if (!saved || saved.type !== 'doc') throw new Error('saved body must remain a document')
  expect(docBlockText(saved.blocks[0]!)).toBe('Opening paragraph.')
})

test('switching accounts clears an unsaved private Document draft before returning to its owner', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await stackArtifactAccounts(page)
  await page.goto('/artifacts')
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await switchArtifactAccount(page, 'Ada Lovelace')
  const stamp = Date.now().toString(36)
  const { artifact } = await createDocument(page, `account-switch-${stamp}`)
  const grant = await page.request.post('/api/v1/grants', {
    data: { subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
  })
  expect(grant.ok(), await grant.text()).toBeTruthy()

  await page.goto(`/artifacts/${artifact.id}`)
  await page.getByRole('button', { name: 'Edit block 1', exact: true }).click()
  const privateDraft = `Ada private unsubmitted text ${stamp}.`
  await page.getByRole('textbox', { name: 'Rewrite block 1', exact: true }).fill(privateDraft)
  await switchArtifactAccount(page, 'Grace Hopper')
  await expect(page.locator('[data-artifact-page] [aria-label="Rewrite block 1"]')).toHaveCount(0)
  await expect(page.getByText(privateDraft, { exact: true })).toHaveCount(0)
  await page.goto(`/artifacts/${artifact.id}`)
  await expect(page.getByRole('button', { name: 'Edit block 1', exact: true })).toHaveCount(0)
  await expect(page.getByText(privateDraft, { exact: true })).toHaveCount(0)

  await switchArtifactAccount(page, 'Ada Lovelace')
  await page.goto(`/artifacts/${artifact.id}`)
  await expect(page.getByRole('button', { name: 'Edit block 1', exact: true })).toBeVisible()
  await expect(page.getByText(privateDraft, { exact: true })).toHaveCount(0)
  await expect(page.locator(`[data-artifact-page="${artifact.id}"] p`).first()).toHaveText('Opening paragraph.')
})

test('a failed document edit survives in-app navigation; Dismiss keeps its draft and Retry reuses its exact write', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  const stamp = Date.now().toString(36)
  const { artifact, name } = await createDocument(page, stamp)
  const detail = page.locator(`[data-artifact-page="${artifact.id}"]`)
  const requests: Array<{ key: string; body: unknown }> = []
  let retryKey: string | null = null
  await page.route(`**/api/v1/artifacts/${artifact.id}/content`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    const key = route.request().headers()['idempotency-key'] ?? ''
    requests.push({ key, body: route.request().postDataJSON() })
    if (retryKey === key) return route.continue()
    await route.abort('failed')
  })

  await page.goto(`/artifacts/${artifact.id}`)
  await detail.getByRole('button', { name: 'Edit block 1', exact: true }).click()
  const editorName = 'Rewrite block 1'
  const editor = () => detail.getByRole('textbox', { name: editorName })
  const dismissedDraft = `Kept after dismiss ${stamp}.`
  await editor().fill(dismissedDraft)
  await detail.getByRole('button', { name: 'Save', exact: true }).click()
  const notice = page.locator('[data-artifact-content-mutation="failed"]')
  await expect(notice).toContainText('Couldn’t confirm the document edit')

  await leaveAndReturnToArtifact(page, artifact.id, name)
  await expect(editor()).toHaveValue(dismissedDraft)
  await expect(editor()).toBeDisabled()
  await expect(detail.getByRole('button', { name: 'Edit block 2', exact: true })).toBeDisabled()
  await splitPane(page, 'right')
  const projectedPages = page.locator(`[data-artifact-page="${artifact.id}"]`)
  await expect(projectedPages).toHaveCount(2)
  for (const projected of await projectedPages.all()) {
    await expect(projected.getByRole('textbox', { name: editorName, exact: true })).toHaveValue(dismissedDraft)
    await expect(projected.getByRole('textbox', { name: editorName, exact: true })).toBeDisabled()
    await expect(projected.getByRole('button', { name: 'Edit block 2', exact: true })).toBeDisabled()
  }
  await page.locator('[data-close-view]').click()
  await expect(page.locator('[data-main-pane]')).toHaveCount(1)
  await expect(detail).toBeVisible()
  await captureRecoveryState(page, detail, editor(), detail.getByRole('button', { name: 'Edit block 2', exact: true }), testInfo, 'document-edit-held', dismissedDraft, true)
  await notice.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(notice).toHaveCount(0)
  await expect(editor()).toBeEnabled()
  await expect(editor()).toHaveValue(dismissedDraft)
  await leaveAndReturnToArtifact(page, artifact.id, name)
  await expect(editor()).toBeEnabled()
  await expect(editor()).toHaveValue(dismissedDraft)
  await captureRecoveryState(page, detail, editor(), detail.getByRole('button', { name: 'Edit block 2', exact: true }), testInfo, 'document-edit-dismissed', dismissedDraft, false, false)

  const retriedDraft = `Exact retry payload ${stamp}.`
  await editor().fill(retriedDraft)
  await detail.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(notice).toContainText('Couldn’t confirm the document edit')
  await leaveAndReturnToArtifact(page, artifact.id, name)
  await expect(editor()).toHaveValue(retriedDraft)
  await expect(editor()).toBeDisabled()
  await expect(detail.getByRole('button', { name: 'Edit block 2', exact: true })).toBeDisabled()
  const submitted = requests.at(-1)!
  expect(submitted.key).toBeTruthy()
  expect(requests).toHaveLength(2)

  retryKey = submitted.key
  await page.locator('[data-artifact-content-mutation="failed"]')
    .getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(notice).toHaveCount(0)
  await expect(editor()).toHaveCount(0)
  expect(requests).toHaveLength(3)
  expect(requests[2]!.key).toBe(submitted.key)
  expect(requests[2]!.body).toEqual(submitted.body)

  const library = await (await page.request.get('/api/v1/artifact-content')).json() as ArtifactContentLibrary
  const saved = library[artifact.id]
  expect(saved?.type).toBe('doc')
  if (!saved || saved.type !== 'doc') throw new Error('saved body must remain a document')
  expect(docBlockText(saved.blocks[0]!)).toBe(retriedDraft)
})

test('a disappeared document block keeps its submitted draft visible and prevents a retargeted write', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const { artifact } = await createDocument(page, `disappeared-block-${stamp}`)
  const detail = page.locator(`[data-artifact-page="${artifact.id}"]`)
  await page.goto(`/artifacts/${artifact.id}`)
  await detail.getByRole('button', { name: 'Edit block 2', exact: true }).click()
  const editor = detail.getByRole('textbox', { name: 'Rewrite block 2', exact: true })
  const draft = `Keep this if its block disappears ${stamp}.`
  await editor.fill(draft)

  let failedPatch = false
  let patchAttempts = 0
  await page.route(`**/api/v1/artifacts/${artifact.id}/content`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    patchAttempts += 1
    failedPatch = true
    await route.abort('failed')
  })
  await page.route('**/api/v1/artifact-content*', async (route) => {
    if (route.request().method() !== 'GET' || !failedPatch) return route.continue()
    const response = await route.fetch()
    const library = await response.json() as ArtifactContentLibrary
    const current = library[artifact.id]
    if (!current || current.type !== 'doc') return route.fulfill({ response, json: library })
    const latest = { ...current, revision: (current.revision ?? 0) + 1, blocks: [current.blocks[0]!] }
    await route.fulfill({ response, json: { ...library, [artifact.id]: latest } })
  })

  await detail.getByRole('button', { name: 'Save', exact: true }).click()
  const notice = page.locator('[data-artifact-content-mutation="failed"]')
  await expect(notice).toContainText('Couldn’t confirm the document edit')
  await expect(editor).toHaveValue(draft)
  await expect(editor).toBeDisabled()

  await notice.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(notice).toHaveCount(0)
  await expect(editor).toHaveValue(draft)
  await expect(editor).toBeEnabled()
  await expect(detail.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect(detail.getByRole('status').filter({ hasText: /removed|no longer/i })).toBeVisible()
  await expect(detail.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
  expect(patchAttempts).toBe(1)

  await detail.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(detail.getByRole('textbox', { name: 'Rewrite block 2', exact: true })).toHaveCount(0)
  await expect(detail.getByText(draft, { exact: true })).toHaveCount(0)
  expect(patchAttempts).toBe(1)
})
