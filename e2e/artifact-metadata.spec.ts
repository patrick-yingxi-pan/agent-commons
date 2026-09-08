import { test, expect } from '@playwright/test'
import type { ArtifactItem } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'

const READER = 'tenant-beta'
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

async function exposeArtifactPage(page: import('@playwright/test').Page) {
  // Resizing can still be animating the previous rail tier. Capture the
  // explicitly closed, inert rail only after its rendered width reaches zero.
  const closeRail = page.locator('button[aria-label="Collapse sidebar"]')
  if (!await closeRail.evaluate((button) => button.closest('[inert]') !== null)) await closeRail.click()
  await expect.poll(() => closeRail.evaluate((button) => button.closest('[inert]')?.getBoundingClientRect().width ?? -1)).toBe(0)
}

async function createArtifact(page: import('@playwright/test').Page, name: string): Promise<ArtifactItem> {
  const response = await page.request.post(`${API}/relations/ops`, {
    data: { op: { kind: 'save-artifact', artifact: { name, kind: 'doc', meta: 'Document', body: 'Renameable body.' } } },
    headers: { 'Idempotency-Key': `artifact-metadata-${name}-${Date.now()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const graph = await response.json() as { extraArtifacts: ArtifactItem[] }
  const artifact = graph.extraArtifacts.find((row) => row.name === name)
  expect(artifact).toBeTruthy()
  return artifact!
}

async function grantArtifact(page: import('@playwright/test').Page, artifactId: string) {
  const response = await page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'artifact', id: artifactId }, audience: { kind: 'org', orgId: READER }, tier: 'view' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

test('owner rename is discoverable and remains readable to a granted reader at every viewport', async ({ browser }, testInfo) => {
  test.setTimeout(ms(75_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': READER })
  const stamp = Date.now().toString(36)
  const original = `rename-${stamp}.md`
  const renamed = `renamed-${stamp}.md`
  try {
    const artifact = await createArtifact(owner.page, original)
    await grantArtifact(owner.page, artifact.id)
    await owner.page.goto(`/artifacts/${artifact.id}`)
    await reader.page.goto(`/artifacts/${artifact.id}`)
    const ownerPage = owner.page.locator(`[data-artifact-page="${artifact.id}"]`)
    const readerPage = reader.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await expect(ownerPage).toBeVisible()
    await expect(readerPage).toBeVisible()
    await expect(ownerPage.getByRole('button', { name: 'Rename artifact', exact: true })).toBeVisible()
    await expect(readerPage.getByRole('button', { name: 'Rename artifact', exact: true })).toHaveCount(0)

    await ownerPage.getByRole('button', { name: 'Rename artifact', exact: true }).click()
    const editor = ownerPage.getByRole('textbox', { name: 'Artifact name', exact: true })
    await editor.fill(renamed)
    await expect(ownerPage.getByRole('button', { name: 'Save artifact name', exact: true })).toBeEnabled()
    await expect(ownerPage.getByRole('button', { name: 'Download Markdown', exact: true })).toBeDisabled()
    for (const viewport of VIEWPORTS) {
      await owner.page.setViewportSize(viewport)
      await exposeArtifactPage(owner.page)
      await expect(editor).toBeInViewport()
      await owner.page.screenshot({ path: testInfo.outputPath(`artifact-rename-editor-owner-${viewport.width}.png`) })
    }
    await ownerPage.getByRole('button', { name: 'Save artifact name', exact: true }).click()
    await expect(ownerPage.getByRole('heading', { name: renamed, exact: true })).toBeVisible()
    await expect(readerPage.getByRole('heading', { name: renamed, exact: true })).toBeVisible()

    for (const [role, page] of [['owner', owner.page], ['reader', reader.page]] as const) {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport)
        await exposeArtifactPage(page)
        await expect(page.locator(`[data-artifact-page="${artifact.id}"]`).getByRole('heading', { name: renamed, exact: true })).toBeInViewport()
        await expect(page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).resolves.toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`artifact-rename-settled-${role}-${viewport.width}.png`) })
      }
    }

    const rows = await (await owner.page.request.get(`${API}/artifacts`)).json() as ArtifactItem[]
    expect(rows.filter((row) => row.id === artifact.id)).toHaveLength(1)
    expect(rows.find((row) => row.id === artifact.id)?.name).toBe(renamed)
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close()])
  }
})

test('rename holds the draft through delay and rebases a stale CAS retry', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const artifact = await createArtifact(page, `cas-${stamp}.md`)
  await page.goto(`/artifacts/${artifact.id}`)
  const detail = page.locator(`[data-artifact-page="${artifact.id}"]`)
  await detail.getByRole('button', { name: 'Rename artifact', exact: true }).click()
  const editor = detail.getByRole('textbox', { name: 'Artifact name', exact: true })
  await editor.fill(`delayed-${stamp}.md`)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route(`${API}/artifacts/${artifact.id}`, async (route) => {
    if (route.request().method() === 'PATCH') await gate
    await route.continue()
  })
  await detail.getByRole('button', { name: 'Save artifact name', exact: true }).click()
  await expect(editor).toHaveValue(`delayed-${stamp}.md`)
  await expect(detail.getByRole('button', { name: 'Download Markdown', exact: true })).toBeDisabled()
  release()
  await expect(detail.getByRole('heading', { name: `delayed-${stamp}.md`, exact: true })).toBeVisible()
  await page.unroute(`${API}/artifacts/${artifact.id}`)

  const current = await (await page.request.get(`${API}/artifacts/${artifact.id}`)).json() as ArtifactItem
  await detail.getByRole('button', { name: 'Rename artifact', exact: true }).click()
  const staleEditor = detail.getByRole('textbox', { name: 'Artifact name', exact: true })
  const localName = `local-${stamp}.md`
  await staleEditor.fill(localName)
  const remote = await page.request.patch(`${API}/artifacts/${artifact.id}`, {
    data: { name: `remote-${stamp}.md`, expectedRevision: current.metadataRevision ?? 0 },
    headers: { 'Idempotency-Key': `remote-artifact-${stamp}` },
  })
  expect(remote.ok()).toBeTruthy()
  await detail.getByRole('button', { name: 'Save artifact name', exact: true }).click()
  const failure = page.locator('[data-artifact-metadata-mutation="failed"]')
  await expect(failure).toBeVisible()
  await failure.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(detail.getByRole('heading', { name: localName, exact: true })).toBeVisible()
})

test('lost rename acknowledgement replays one stable mutation and shared readers cannot rename', async ({ browser }) => {
  test.setTimeout(ms(60_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': READER })
  const stamp = Date.now().toString(36)
  try {
    const artifact = await createArtifact(owner.page, `lost-${stamp}.md`)
    await grantArtifact(owner.page, artifact.id)
    await owner.page.goto(`/artifacts/${artifact.id}`)
    await reader.page.goto(`/artifacts/${artifact.id}`)
    const detail = owner.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await detail.getByRole('button', { name: 'Rename artifact', exact: true }).click()
    const editor = detail.getByRole('textbox', { name: 'Artifact name', exact: true })
    const nextName = `replayed-${stamp}.md`
    await editor.fill(nextName)
    let lost = true
    const attemptedKeys: string[] = []
    await owner.page.route(`${API}/artifacts/${artifact.id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      attemptedKeys.push(route.request().headers()['idempotency-key'] ?? '')
      if (!lost) return route.continue()
      lost = false
      const response = await owner.page.request.patch(`${API}/artifacts/${artifact.id}`, {
        data: route.request().postDataJSON(),
        headers: { 'Idempotency-Key': route.request().headers()['idempotency-key'] ?? '' },
      })
      expect(response.ok()).toBeTruthy()
      await route.abort()
    })
    await detail.getByRole('button', { name: 'Save artifact name', exact: true }).click()
    const failure = owner.page.locator('[data-artifact-metadata-mutation="failed"]')
    await expect(failure).toBeVisible()
    await failure.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(detail.getByRole('heading', { name: nextName, exact: true })).toBeVisible()
    const rows = await (await owner.page.request.get(`${API}/artifacts`)).json() as ArtifactItem[]
    expect(rows.filter((row) => row.id === artifact.id)).toHaveLength(1)
    expect(rows.find((row) => row.id === artifact.id)?.metadataRevision).toBe(1)
    expect(attemptedKeys).toHaveLength(2)
    expect(attemptedKeys[0]).not.toBe('')
    expect(attemptedKeys[1]).toBe(attemptedKeys[0])

    await expect(reader.page.getByRole('button', { name: 'Rename artifact', exact: true })).toHaveCount(0)
    const readerPatch = await reader.page.request.patch(`${API}/artifacts/${artifact.id}`, {
      data: { name: `foreign-${stamp}.md`, expectedRevision: 0 },
    })
    expect(readerPatch.status()).toBe(404)
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close()])
  }
})
