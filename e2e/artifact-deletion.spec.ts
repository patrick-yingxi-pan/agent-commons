/** Permanent deletion is a separate, reviewed Trash act with held recovery. */
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { ArtifactItem } from '../contract/index.ts'
import { API, newUser, openSection } from './social-helpers.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function fixture(page: Page, name = `Delete review ${crypto.randomUUID()}.md`) {
  const created = await page.request.post(`${API}/artifacts`, {
    data: { name, kind: 'doc', body: 'Original version retained until permanent deletion.' },
    headers: { 'Idempotency-Key': `delete-fixture-${crypto.randomUUID()}` },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const { artifact } = await created.json() as { artifact: ArtifactItem }
  const edit = await page.request.patch(`${API}/artifacts/${artifact.id}/content`, {
    data: { block: 0, text: 'Current version retained until permanent deletion.', expectedRevision: 0 },
  })
  expect(edit.ok(), await edit.text()).toBeTruthy()
  const trashed = await page.request.patch(`${API}/artifacts/${artifact.id}/lifecycle`, {
    data: { state: 'trashed', expectedRevision: 0 },
  })
  expect(trashed.ok(), await trashed.text()).toBeTruthy()
  return artifact
}

const detail = (page: Page, id: string) => page.locator(`[data-artifact-page="${id}"]`)
const failure = (page: Page) => page.locator('[data-revisioned-mutation="artifact-delete"][data-mutation-status="failed"]')

async function openReview(page: Page, artifact: ArtifactItem) {
  await page.goto(`/artifacts/${artifact.id}`)
  await expect(detail(page, artifact.id).getByText('In Trash', { exact: true })).toBeVisible({ timeout: ms(20_000) })
  await openSection(page, 'Delete permanently')
  await detail(page, artifact.id).getByRole('button', { name: 'Delete permanently…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete artifact permanently?', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(artifact.name)
  return dialog
}

async function capture(page: Page, subject: Locator, testInfo: TestInfo, label: string, controls: Locator[] = []) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(subject).toBeVisible()
    for (const control of controls) await expect(control).toBeInViewport()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    for (const prose of await subject.locator('[data-wrapping-prose]').all()) {
      await expect.poll(() => prose.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    }
    await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.width}x${viewport.height}.png`) })
    await assertWcag22Aa(page, `${label} ${viewport.width}x${viewport.height}`)
  }
}

async function navigateToTrash(page: Page) {
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
  if (await expand.isVisible()) await expand.click()
  await page.getByRole('navigation').getByRole('button', { name: 'Artifacts', exact: true }).click()
  // Use the rail's canonical collection door, not the main fold toggle. This
  // stays in the same document, preserving the memory-only recovery queue.
  const artifacts = page.locator('nav[aria-label="Sections"] [data-section-tree="artifacts"]')
  const expandArtifacts = artifacts.getByRole('button', { name: 'Expand Artifacts', exact: true })
  if (await expandArtifacts.count()) await expandArtifacts.click()
  await artifacts.locator('[data-collection-section="__trash"]').getByRole('button', { name: 'Trash', exact: true }).click()
  await expect(page).toHaveURL(/\/artifacts\/groups\/__trash$/)
}

test('permanent deletion names its full scope, focuses Cancel, and removes only after explicit confirmation', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-delete-${crypto.randomUUID()}` })
  const name = `Delete-${'x'.repeat(230)}.md`
  const artifact = await fixture(page, name)
  let deletes = 0
  page.on('request', request => {
    if (request.method() === 'DELETE' && new URL(request.url()).pathname === `${API}/artifacts/${artifact.id}`) deletes += 1
  })
  let dialog = await openReview(page, artifact)
  await expect(dialog).toContainText(/versions/i)
  await expect(dialog).toContainText(/shares/i)
  await expect(dialog).toContainText(/discussions/i)
  await expect(dialog).toContainText(/proposals/i)
  await expect(dialog).toContainText(/conversations/i)
  await expect(dialog).toContainText(/backups/i)
  await expect(dialog).toContainText(/cannot be undone|no undo/i)
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await capture(page, dialog, testInfo, 'permanent-delete-review', [
    dialog.getByRole('button', { name: 'Cancel', exact: true }),
    dialog.getByRole('button', { name: 'Delete permanently', exact: true }),
  ])
  // The long reviewed name really overflows in short landscape. Reach the
  // prose with Tab, scroll it with keys, and keep both actions in view.
  await page.setViewportSize({ width: 844, height: 390 })
  await settleArtifactPageRail(page)
  const details = dialog.getByRole('region', { name: 'Confirmation details', exact: true })
  await expect(details).toHaveAttribute('data-dialog-read-region', 'true')
  await expect.poll(() => details.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
  await cancel.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(details).toBeFocused()
  await details.press('End')
  await expect.poll(() => details.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(cancel).toBeInViewport()
  await expect(dialog.getByRole('button', { name: 'Delete permanently', exact: true })).toBeInViewport()
  await details.press('Home')
  await expect.poll(() => details.evaluate(element => element.scrollTop)).toBe(0)
  await page.keyboard.press('Tab')
  await expect(cancel).toBeFocused()
  await cancel.click()
  await expect(dialog).toHaveCount(0)
  await expect(detail(page, artifact.id).getByRole('button', { name: 'Delete permanently…', exact: true })).toBeFocused()
  expect(deletes).toBe(0)
  expect((await page.request.get(`${API}/artifacts/${artifact.id}/history`)).status()).toBe(200)
  await detail(page, artifact.id).getByRole('button', { name: 'Delete permanently…', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Delete artifact permanently?', exact: true })
  await dialog.getByRole('button', { name: 'Delete permanently', exact: true }).click()
  await expect(page).toHaveURL(/\/artifacts\/groups\/__trash$/)
  await expect(page.locator('[data-artifact-preview-row]').filter({ has: page.getByRole('button', { name, exact: true }) })).toHaveCount(0)
  expect(deletes).toBe(1)
  expect((await page.request.get(`${API}/artifacts/${artifact.id}/history`)).status()).toBe(404)
  await page.goto(`/artifacts/${artifact.id}`)
  await expect(page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete permanently…', exact: true })).toHaveCount(0)
})

test('a restored then re-trashed artifact cannot be deleted using older reviewed consent', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-delete-stale-${crypto.randomUUID()}` })
  const artifact = await fixture(page)
  const dialog = await openReview(page, artifact)
  let release!: () => void
  let reached!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const intercepted = new Promise<void>(resolve => { reached = resolve })
  await page.route(`**${API}/artifacts/${artifact.id}`, async route => {
    if (route.request().method() !== 'DELETE') return route.continue()
    reached()
    await gate
    await route.continue()
  })
  // Consent is committed while revision 1 is still on screen, but the actual
  // request is delayed. Another device can cycle the lifecycle before arrival.
  const refusal = page.waitForResponse(response => response.request().method() === 'DELETE' &&
    new URL(response.url()).pathname === `${API}/artifacts/${artifact.id}`)
  try {
    await dialog.getByRole('button', { name: 'Delete permanently', exact: true }).click()
    await intercepted
    for (const [state, expectedRevision] of [['active', 1], ['trashed', 2]] as const) {
      const response = await page.request.patch(`${API}/artifacts/${artifact.id}/lifecycle`, { data: { state, expectedRevision } })
      expect(response.status()).toBe(200)
    }
  } finally {
    release()
  }
  const response = await refusal
  expect(response.status()).toBe(409)
  expect(response.request().postDataJSON()).toMatchObject({ expectedLifecycleRevision: 1 })
  await expect(failure(page)).toBeVisible()
  const surviving = await page.request.get(`${API}/artifacts/${artifact.id}/lifecycle`)
  expect(surviving.status()).toBe(200)
  expect((await surviving.json()).lifecycle).toMatchObject({ state: 'trashed', revision: 3 })
  await expect(detail(page, artifact.id).getByRole('button', { name: 'Restore artifact', exact: true })).toBeDisabled()
  await failure(page).getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(failure(page)).toHaveCount(0)
  await expect(detail(page, artifact.id).getByRole('button', { name: 'Restore artifact', exact: true })).toBeEnabled()
})

test('a failed preview offers read-only Retry and never opens destructive consent', async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-delete-preview-${crypto.randomUUID()}` })
  const artifact = await fixture(page)
  let reads = 0
  let deletes = 0
  page.on('request', request => {
    if (request.method() === 'DELETE' && new URL(request.url()).pathname === `${API}/artifacts/${artifact.id}`) deletes += 1
  })
  await page.route(`**${API}/artifacts/${artifact.id}/deletion-preview`, route => {
    reads += 1
    if (reads === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Preview unavailable' }) })
    return route.continue()
  })
  await page.goto(`/artifacts/${artifact.id}`)
  await openSection(page, 'Delete permanently')
  await detail(page, artifact.id).getByRole('button', { name: 'Delete permanently…', exact: true }).click()
  const notice = page.locator('[data-artifact-deletion-review-notice]')
  await expect(notice).toContainText('Nothing was deleted')
  await expect(page.getByRole('dialog', { name: 'Delete artifact permanently?', exact: true })).toHaveCount(0)
  expect(deletes).toBe(0)
  await notice.getByRole('button', { name: 'Retry preview', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete artifact permanently?', exact: true })
  await expect(dialog).toBeVisible()
  expect(reads).toBe(2)
  expect(deletes).toBe(0)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await page.request.get(`${API}/artifacts/${artifact.id}/history`)).status()).toBe(200)
})

async function assertDeletionModuleRefusal(page: Page, module: string) {
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-delete-module-${crypto.randomUUID()}` })
  const artifact = await fixture(page)
  let writes = 0
  page.on('request', request => {
    if (request.method() === 'DELETE') writes += 1
  })
  await page.route(`**/src/components/${module}.tsx*`, route => route.abort('failed'))
  await page.goto(`/artifacts/${artifact.id}`)
  await expect(detail(page, artifact.id)).toBeVisible()
  await expect(detail(page, artifact.id).getByText(/Couldn’t load permanent deletion (controls|recovery)/)).toBeVisible()
  await expect(detail(page, artifact.id).getByRole('button', { name: 'Reload app', exact: true })).toBeVisible()
  await expect(detail(page, artifact.id).getByRole('button', { name: 'Restore artifact', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Delete permanently…', exact: true })).toHaveCount(0)
  expect(writes).toBe(0)
}

test('failed deletion control loading preserves Trash recovery and accepts no destructive intent', async ({ page }) => {
  await assertDeletionModuleRefusal(page, 'ArtifactPermanentDeletionSection')
})

test('failed deletion shell loading preserves Trash recovery and accepts no destructive intent', async ({ page }) => {
  await assertDeletionModuleRefusal(page, 'DeferredArtifactPermanentDeletionSection')
})

test('failed recovery notice loading preserves Trash recovery and accepts no destructive intent', async ({ page }) => {
  await assertDeletionModuleRefusal(page, 'ShellMutationNotices')
})

test('a lost delete acknowledgement retains the row through navigation and Retry preserves exact consent', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-delete-retry-${crypto.randomUUID()}` })
  const artifact = await fixture(page)
  const requests: Array<{ key: string; body: unknown }> = []
  let hideTruth = false
  await page.route(`**${API}/artifacts/${artifact.id}/lifecycle`, route => {
    if (!hideTruth) return route.continue()
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary read outage' }) })
  })
  await page.route(`**${API}/artifacts/${artifact.id}`, async route => {
    if (route.request().method() !== 'DELETE') return route.continue()
    const key = route.request().headers()['idempotency-key'] ?? ''
    const body = route.request().postDataJSON()
    requests.push({ key, body })
    if (requests.length === 1) {
      const response = await page.request.delete(`${API}/artifacts/${artifact.id}`, { data: body, headers: { 'Idempotency-Key': key } })
      expect(response.status()).toBe(200)
      hideTruth = true
      return route.abort('failed')
    }
    return route.continue()
  })
  const dialog = await openReview(page, artifact)
  await dialog.getByRole('button', { name: 'Delete permanently', exact: true }).click()
  await expect(failure(page)).toBeVisible()
  await expect(detail(page, artifact.id).getByRole('heading', { name: artifact.name, exact: true })).toBeVisible()
  await expect(detail(page, artifact.id).getByRole('button', { name: 'Restore artifact', exact: true })).toBeDisabled()
  await capture(page, failure(page), testInfo, 'permanent-delete-recovery', [
    failure(page).getByRole('button', { name: 'Retry', exact: true }),
    failure(page).getByRole('button', { name: 'Dismiss', exact: true }),
  ])
  await navigateToTrash(page)
  const row = page.locator('[data-artifact-preview-row]').filter({ has: page.getByRole('button', { name: artifact.name, exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: artifact.name, exact: true }).click()
  await expect(detail(page, artifact.id).getByRole('heading', { name: artifact.name, exact: true })).toBeVisible()
  hideTruth = false
  await failure(page).getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failure(page)).toHaveCount(0)
  expect(requests).toHaveLength(2)
  expect(requests[0].key).not.toBe('')
  expect(requests[1]).toEqual(requests[0])
  expect(requests[0].body).toMatchObject({ expectedLifecycleRevision: 1, reviewToken: expect.any(String) })
  expect((await page.request.get(`${API}/artifacts/${artifact.id}/lifecycle`)).status()).toBe(404)
})

test('late deletion acknowledgement cannot redirect a newly chosen page', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-delete-late-${crypto.randomUUID()}` })
  const artifact = await fixture(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let committed = false
  await page.route(`**${API}/artifacts/${artifact.id}`, async route => {
    if (route.request().method() !== 'DELETE') return route.continue()
    const response = await route.fetch()
    expect(response.status()).toBe(200)
    committed = true
    await gate
    await route.fulfill({ response })
  })
  try {
    const dialog = await openReview(page, artifact)
    await dialog.getByRole('button', { name: 'Delete permanently', exact: true }).click()
    await expect.poll(() => committed).toBe(true)
    const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first()
    if (await expand.isVisible()) await expand.click()
    await page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
    await expect(page).toHaveURL(/\/projects$/)
    release()
    await expect(page.locator('[data-revisioned-mutation="artifact-delete"]')).toHaveCount(0)
    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.locator('main').getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  } finally { release() }
})

test('shared and foreign readers never receive permanent deletion controls or preview', async ({ browser }) => {
  test.setTimeout(ms(60_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  try {
    const artifact = await fixture(owner.page)
    const restore = await owner.page.request.patch(`${API}/artifacts/${artifact.id}/lifecycle`, { data: { state: 'active', expectedRevision: 1 } })
    expect(restore.status()).toBe(200)
    const grant = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(grant.ok(), await grant.text()).toBeTruthy()
    await reader.page.goto(`/artifacts/${artifact.id}`)
    await expect(detail(reader.page, artifact.id)).toBeVisible()
    await expect(reader.page.getByRole('button', { name: 'Delete permanently…', exact: true })).toHaveCount(0)
    for (const visitor of [reader.page, foreign.page]) {
      expect((await visitor.request.get(`${API}/artifacts/${artifact.id}/deletion-preview`)).status()).toBe(404)
    }
    const trash = await owner.page.request.patch(`${API}/artifacts/${artifact.id}/lifecycle`, { data: { state: 'trashed', expectedRevision: 2 } })
    expect(trash.status()).toBe(200)
    for (const visitor of [reader.page, foreign.page]) {
      await visitor.goto(`/artifacts/${artifact.id}`)
      await expect(visitor.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
      await expect(visitor.getByRole('button', { name: 'Delete permanently…', exact: true })).toHaveCount(0)
      expect((await visitor.request.get(`${API}/artifacts/${artifact.id}/deletion-preview`)).status()).toBe(404)
    }
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})
