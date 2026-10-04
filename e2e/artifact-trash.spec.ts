/** Rendered owner Trash lifecycle, public reader boundaries, and held recovery. */
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { ArtifactItem } from '../contract/index.ts'
import { API, newUser, openSection } from './social-helpers.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

type ArtifactLifecycle = {
  artifact: ArtifactItem
  lifecycle: { state: 'active' | 'trashed'; revision: number; changedAt: number }
}

async function createArtifact(page: Page, name: string, body: string, projectId?: string) {
  const response = await page.request.post(`${API}/artifacts`, {
    data: { name, kind: 'doc', body, ...(projectId ? { projectId } : {}) },
    headers: { 'Idempotency-Key': `artifact-trash-create-${crypto.randomUUID()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const created = await response.json() as { artifact: ArtifactItem }
  expect(created.artifact.name).toBe(name)
  return created.artifact
}

async function grantArtifact(page: Page, id: string) {
  const response = await page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'artifact', id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

async function lifecycle(page: Page, id: string) {
  const response = await page.request.get(`${API}/artifacts/${id}/lifecycle`)
  expect(response.ok(), await response.text()).toBeTruthy()
  return await response.json() as ArtifactLifecycle
}

async function openTrash(page: Page) {
  await page.goto('/artifacts/groups/__trash')
  const header = page.locator('main header')
  await expect(header.getByRole('heading', { name: 'Artifacts', exact: true })).toBeVisible({ timeout: ms(20_000) })
  await expect(header.locator('p', { hasText: /^Trash$/ })).toBeVisible()

  const expandSidebar = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expandSidebar.isVisible()) await expandSidebar.click()
  const artifacts = page.locator('nav[aria-label="Sections"] [data-section-tree="artifacts"]')
  const expandArtifacts = artifacts.getByRole('button', { name: 'Expand Artifacts', exact: true })
  if (await expandArtifacts.count()) await expandArtifacts.click()
  const trashDoor = artifacts.locator('[data-collection-section="__trash"]').getByRole('button', { name: 'Trash', exact: true })
  await expect(trashDoor).toBeVisible()
  await trashDoor.click()
  await expect(page).toHaveURL(/\/artifacts\/groups\/__trash$/)
}

function artifactPreview(page: Page, name: string) {
  return page.locator('[data-artifact-preview-row]').filter({ has: page.getByRole('button', { name, exact: true }) })
}

async function expectNoBodyOrMutationActions(page: Page, id: string, body: string) {
  const detail = page.locator(`[data-artifact-page="${id}"]`)
  await expect(detail.locator('p', { hasText: body })).toHaveCount(0)
  await expect(detail.getByRole('button', { name: /^(Edit|Share|Download)/ })).toHaveCount(0)
}

async function captureAcrossViewports(page: Page, subject: Locator, testInfo: TestInfo, label: string, controls: Locator[] = []) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(subject).toBeVisible()
    for (const control of controls) await expect(control).toBeInViewport()
    const prose = page.locator('[data-wrapping-prose]')
    for (const box of await prose.all()) {
      await expect.poll(() => box.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.width}x${viewport.height}.png`) })
    await assertWcag22Aa(page, `${label} ${viewport.width}x${viewport.height}`)
  }
}

test('owner moves an artifact to Trash and restores the same canonical identity', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  const stamp = Date.now().toString(36)
  const prefix = `trash-${stamp}-`
  const name = `${prefix}${'x'.repeat(240 - prefix.length)}`
  const body = `Owner-only body while active ${stamp}.`
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-trash-${stamp}` })
  const projectResponse = await page.request.post(`${API}/projects`, {
    data: { name: `Trash filing ${stamp}`, description: 'Owned filing for the lifecycle roundtrip.' },
  })
  expect(projectResponse.ok(), await projectResponse.text()).toBeTruthy()
  const project = (await projectResponse.json() as { project: { id: string } }).project
  const artifact = await createArtifact(page, name, body, project.id)
  const filedGraph = await (await page.request.get(`${API}/relations`)).json() as { artifactProject: Record<string, string> }
  expect(filedGraph.artifactProject[artifact.id]).toBe(project.id)
  const detail = page.locator(`[data-artifact-page="${artifact.id}"]`)
  expect((await lifecycle(page, artifact.id)).lifecycle).toMatchObject({ state: 'active', revision: 0 })

  await openTrash(page)
  await expect(page.locator('[data-artifact-preview-row]')).toHaveCount(0)
  await page.goto(`/artifacts/${artifact.id}`)
  await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: ms(20_000) })
  await expect(detail.locator('p', { hasText: body })).toBeVisible()
  await openSection(page, 'Manage artifact')
  await expect(detail.getByRole('button', { name: 'Move to Trash', exact: true })).toBeVisible()

  await detail.getByRole('button', { name: 'Move to Trash', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Move artifact to Trash?', exact: true })
  await expect(confirm).toContainText(name)
  await expect(confirm).toContainText(/suspend|restore/i)
  await expect(confirm.getByRole('button', { name: 'Move to Trash', exact: true })).toBeVisible()
  await expect(confirm.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await captureAcrossViewports(page, confirm, testInfo, 'artifact-trash-confirm', [
    confirm.getByRole('button', { name: 'Cancel', exact: true }),
    confirm.getByRole('button', { name: 'Move to Trash', exact: true }),
  ])
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await expect(detail.locator('p', { hasText: body })).toBeVisible()

  await openSection(page, 'Manage artifact')
  await detail.getByRole('button', { name: 'Move to Trash', exact: true }).click()
  const accepted = page.getByRole('dialog', { name: 'Move artifact to Trash?', exact: true })
  await accepted.getByRole('button', { name: 'Move to Trash', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/artifacts/${artifact.id}$`))
  await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(detail.getByText('In Trash', { exact: true })).toBeVisible()
  await expect(detail.getByRole('button', { name: 'Restore artifact', exact: true })).toBeVisible()
  await expectNoBodyOrMutationActions(page, artifact.id, body)
  expect((await lifecycle(page, artifact.id)).lifecycle).toMatchObject({ state: 'trashed', revision: 1 })
  await page.reload()
  await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(detail.getByRole('button', { name: 'Restore artifact', exact: true })).toBeVisible()
  await expectNoBodyOrMutationActions(page, artifact.id, body)
  await captureAcrossViewports(page, detail, testInfo, 'artifact-trash-canonical')

  await openTrash(page)
  const trashedRow = artifactPreview(page, name)
  await expect(trashedRow).toHaveCount(1)
  await expect(trashedRow).toContainText('In Trash')
  await expect(trashedRow.getByRole('button', { name, exact: true })).toBeVisible()
  await expect(trashedRow.getByRole('button', { name: /^(Edit|Share|Download|Restore)/ })).toHaveCount(0)
  await captureAcrossViewports(page, trashedRow, testInfo, 'artifact-trash-row')
  await trashedRow.getByRole('button', { name, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/artifacts/${artifact.id}$`))
  await expect(detail.getByRole('button', { name: 'Restore artifact', exact: true })).toBeVisible()
  await detail.getByRole('button', { name: 'Restore artifact', exact: true }).click()
  await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(detail.locator('p', { hasText: body })).toBeVisible()
  await expect(detail.getByRole('button', { name: 'Move to Trash', exact: true })).toBeVisible()
  expect((await lifecycle(page, artifact.id)).lifecycle).toMatchObject({ state: 'active', revision: 2 })
  const restoredGraph = await (await page.request.get(`${API}/relations`)).json() as { artifactProject: Record<string, string> }
  expect(restoredGraph.artifactProject[artifact.id]).toBe(project.id)

  await openTrash(page)
  await expect(page.locator('[data-artifact-preview-row]')).toHaveCount(0)
  // The nested Trash destination remains addressable when its collection is empty.
  await expect(page.locator('main header').locator('p', { hasText: /^Trash$/ })).toBeVisible()
})

test('owner Trash invalidates a granted reader while foreign accounts stay unauthorized', async ({ browser }) => {
  test.setTimeout(ms(60_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const stamp = Date.now().toString(36)
  const name = `trash-permissions-${stamp}.md`
  const body = `Private after Trash ${stamp}.`
  try {
    const artifact = await createArtifact(owner.page, name, body)
    await grantArtifact(owner.page, artifact.id)
    await owner.page.goto(`/artifacts/${artifact.id}`)
    await reader.page.goto(`/artifacts/${artifact.id}`)
    await expect(reader.page.locator(`[data-artifact-page="${artifact.id}"]`).locator('p', { hasText: body })).toBeVisible()
    await expect(reader.page.getByRole('button', { name: 'Move to Trash', exact: true })).toHaveCount(0)
    await expect(reader.page.getByRole('button', { name: 'Restore artifact', exact: true })).toHaveCount(0)
    await foreign.page.goto(`/artifacts/${artifact.id}`)
    await expect(foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
    await expect(foreign.page.getByRole('button', { name: 'Move to Trash', exact: true })).toHaveCount(0)
    const foreignPatch = await foreign.page.request.patch(`${API}/artifacts/${artifact.id}/lifecycle`, {
      data: { state: 'trashed', expectedRevision: 0 },
    })
    expect(foreignPatch.status()).toBe(404)

    const ownerDetail = owner.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await openSection(owner.page, 'Manage artifact')
    await ownerDetail.getByRole('button', { name: 'Move to Trash', exact: true }).click()
    await owner.page.getByRole('dialog', { name: 'Move artifact to Trash?' }).getByRole('button', { name: 'Move to Trash', exact: true }).click()
    await expect(ownerDetail.getByText('In Trash', { exact: true })).toBeVisible()
    await expect(reader.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
    await expect(reader.page.locator(`[data-artifact-page="${artifact.id}"]`)).toHaveCount(0)
    await expectNoBodyOrMutationActions(owner.page, artifact.id, body)
    await expect(owner.page.getByRole('button', { name: 'Restore artifact', exact: true })).toBeVisible()
    await expect(reader.page.getByRole('button', { name: 'Restore artifact', exact: true })).toHaveCount(0)
    await expect(foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()

    const readerPatch = await reader.page.request.patch(`${API}/artifacts/${artifact.id}/lifecycle`, {
      data: { state: 'active', expectedRevision: 1 },
    })
    expect(readerPatch.status()).toBe(404)
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})

test('lost acknowledgement stays held and an ABA lifecycle change cannot be applied by Retry', async ({ page }, testInfo) => {
  test.setTimeout(ms(75_000))
  const stamp = Date.now().toString(36)
  const name = `trash-uncertain-${stamp}.md`
  const body = `Never expose this while the lifecycle intent is held ${stamp}.`
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-trash-uncertain-${stamp}` })
  const artifact = await createArtifact(page, name, body)
  const detail = page.locator(`[data-artifact-page="${artifact.id}"]`)
  const requests: Array<{ key: string; body: Record<string, unknown> }> = []
  let first = true
  let failTruthReads = false
  await page.route(`**${API}/artifacts/${artifact.id}/lifecycle`, async (route) => {
    if (route.request().method() === 'GET' && failTruthReads) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'lifecycle read unavailable' }) })
    }
    if (route.request().method() !== 'PATCH') return route.continue()
    const requestBody = route.request().postDataJSON() as Record<string, unknown>
    const key = route.request().headers()['idempotency-key'] ?? ''
    requests.push({ key, body: requestBody })
    if (first) {
      first = false
      // Commit on the server, then lose the acknowledgement. The failed truth
      // read must keep the owner intent visible and held.
      const committed = await page.request.patch(`${API}/artifacts/${artifact.id}/lifecycle`, {
        data: requestBody,
        headers: { 'Idempotency-Key': key },
      })
      expect(committed.status()).toBe(200)
      failTruthReads = true
      await route.abort('failed')
      return
    }
    await route.continue()
  })

  await page.goto(`/artifacts/${artifact.id}`)
  await openSection(page, 'Manage artifact')
  await detail.getByRole('button', { name: 'Move to Trash', exact: true }).click()
  await page.getByRole('dialog', { name: 'Move artifact to Trash?' }).getByRole('button', { name: 'Move to Trash', exact: true }).click()
  const failed = page.locator('[data-revisioned-mutation="artifact-lifecycle"][data-mutation-status="failed"]')
  await expect(failed).toBeVisible()
  await expect(failed.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible()
  await expectNoBodyOrMutationActions(page, artifact.id, body)
  await expect(detail.getByRole('button', { name: 'Restore artifact', exact: true })).toHaveCount(0)

  const expandSidebar = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expandSidebar.isVisible()) await expandSidebar.click()
  await page.getByRole('button', { name: 'Artifacts', exact: true }).first().click()
  await expect(artifactPreview(page, name)).toHaveCount(1)
  await expect(artifactPreview(page, name).locator('[data-artifact-preview-copy]', { hasText: body })).toHaveCount(0)
  await expect(artifactPreview(page, name).getByRole('button', { name: /^(Edit|Share|Download|Restore)/ })).toHaveCount(0)
  await artifactPreview(page, name).getByRole('button', { name, exact: true }).click()
  await expect(detail.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(detail.getByText('Waiting for confirmation', { exact: true })).toBeVisible()
  await expect(failed).toBeVisible()
  await expectNoBodyOrMutationActions(page, artifact.id, body)
  await captureAcrossViewports(page, detail, testInfo, 'artifact-trash-held')

  // Let the authoritative read recover only after the unavailable-read failure
  // has been observed and the held projection has survived in-app navigation.
  failTruthReads = false

  // Restore the committed Trash after its acknowledgement was lost. The
  // visible state is active again, but its newer revision makes the held old
  // Trash request stale and therefore impossible to reapply by Retry.
  const committedRestore = await page.request.patch(`${API}/artifacts/${artifact.id}/lifecycle`, {
    data: { state: 'active', expectedRevision: 1 },
    headers: { 'Idempotency-Key': `aba-restore-${stamp}` },
  })
  expect(committedRestore.status()).toBe(200)
  await expect(page.getByText('In Trash', { exact: true })).toHaveCount(0)
  await expect(detail.getByRole('button', { name: 'Move to Trash', exact: true })).toHaveCount(0)

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toBeVisible()
  expect(requests).toHaveLength(2)
  expect(requests[0]!.key).not.toBe('')
  expect(requests[1]!.key).toBe(requests[0]!.key)
  expect(requests[1]!.body).toEqual(requests[0]!.body)
  expect(requests[0]!.body).toEqual({ state: 'trashed', expectedRevision: 0 })
  expect((await lifecycle(page, artifact.id)).lifecycle).toMatchObject({ state: 'active', revision: 2 })
  await expect(detail.getByRole('button', { name: 'Move to Trash', exact: true })).toHaveCount(0)
  await expectNoBodyOrMutationActions(page, artifact.id, body)

  await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(failed).toHaveCount(0)
  await expect(detail.getByRole('button', { name: 'Move to Trash', exact: true })).toBeVisible()
  await expect(detail.locator('p', { hasText: body })).toBeVisible()
})
