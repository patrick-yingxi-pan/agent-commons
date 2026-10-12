/** Rendered structured authored artifacts: consent previews and canonical bodies share one identity. */
import { test, expect, type Browser, type Page } from '@playwright/test'
import type { ArtifactItem, Session } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

async function propose(page: Page, prompt: string, stamp: string) {
  const sessionResponse = await page.request.post(`${API}/sessions`, { data: { firstMessage: `Structured artifact walk ${stamp}` } })
  expect(sessionResponse.ok(), await sessionResponse.text()).toBeTruthy()
  const session = await sessionResponse.json() as Session
  const messageResponse = await page.request.post(`${API}/sessions/${session.id}/messages`, {
    data: { text: prompt },
    headers: { 'Idempotency-Key': `structured-artifact-${stamp}` },
  })
  expect(messageResponse.ok(), await messageResponse.text()).toBeTruthy()
  await messageResponse.body()
  return session
}

async function walkStructuredArtifact({ browser, testInfo, kind }: { browser: Browser; testInfo: TestInfo; kind: 'sheet' | 'slide' }) {
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const stamp = Date.now().toString(36)
  const name = `${kind}-${stamp}.${kind === 'sheet' ? 'sheet' : 'slides'}`
  const prompt = kind === 'sheet' ? `Save a sheet as ${name}` : `Save slides as ${name}`
  const expected = kind === 'sheet' ? ['Metric', 'Value', 'Summary', 'Saved from this conversation'] : ['Summary', 'Saved from this conversation']
  try {
    const session = await propose(owner.page, prompt, stamp)
    await owner.page.goto(`/s/${session.id}`)
    const row = owner.page.locator('[data-relation-action-key]').first()
    await expect(row).toContainText(name)
    const review = row.getByRole('button', { name: new RegExp(`Review ${kind === 'sheet' ? 'Sheet' : 'Slide'} content`) })
    await expect(review).toBeVisible({ timeout: ms(20_000) })
    await expect(row.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
    const before = await (await owner.page.request.get(`${API}/artifacts`)).json() as ArtifactItem[]
    expect(before.some((candidate) => candidate.name === name)).toBe(false)
    await review.click()
    for (const text of expected) await expect(row).toContainText(text)
    for (const viewport of VIEWPORTS) {
      await owner.page.setViewportSize(viewport)
      await settleArtifactPageRail(owner.page)
      // A narrow transition can briefly leave the old rail over the card.
      // Prove the real confirmation target is hit-testable before capture.
      await row.getByRole('button', { name: 'Confirm', exact: true }).click({ trial: true })
      await expect.poll(() => owner.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await owner.page.screenshot({ path: testInfo.outputPath(`structured-${kind}-consent-${viewport.width}x${viewport.height}.png`) })
    }

    await row.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(row).toContainText('Saved as an artifact')
    const graph = await (await owner.page.request.get(`${API}/relations`)).json() as { extraArtifacts: ArtifactItem[] }
    const artifact = graph.extraArtifacts.find((candidate) => candidate.name === name)
    expect(artifact, 'confirmed structured artifact exists once').toBeTruthy()
    expect(graph.extraArtifacts.filter((candidate) => candidate.id === artifact!.id)).toHaveLength(1)

    await owner.page.goto(`/artifacts/${artifact!.id}`)
    const ownerPage = owner.page.locator(`[data-artifact-page="${artifact!.id}"]`)
    for (const text of expected) await expect(ownerPage).toContainText(text)
    await owner.page.reload()
    for (const text of expected) await expect(ownerPage).toContainText(text)
    const grant = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'artifact', id: artifact!.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(grant.ok(), await grant.text()).toBeTruthy()
    await reader.page.goto(`/artifacts/${artifact!.id}`)
    const readerPage = reader.page.locator(`[data-artifact-page="${artifact!.id}"]`)
    for (const text of expected) await expect(readerPage).toContainText(text)
    for (const viewport of VIEWPORTS) {
      for (const [role, page, subject] of [['owner', owner.page, ownerPage], ['reader', reader.page, readerPage]] as const) {
        await page.setViewportSize(viewport)
        await settleArtifactPageRail(page)
        await expect(subject).toBeVisible()
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        if (kind === 'sheet') {
          await expect.poll(() => subject.getByRole('region', { name: 'Sheet preview' }).evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
        }
        await page.screenshot({ path: testInfo.outputPath(`structured-${kind}-${role}-${viewport.width}x${viewport.height}.png`) })
      }
    }
    await foreign.page.goto(`/artifacts/${artifact!.id}`)
    await expect(foreign.page.locator(`[data-artifact-page="${artifact!.id}"]`)).toHaveCount(0)
    await expect(foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).')).toBeVisible()
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
}

test('sheet proposal previews exact content, then survives save, reload, and a grant', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  await walkStructuredArtifact({ browser, testInfo, kind: 'sheet' })
})

test('slide proposal previews exact content, then survives save, reload, and a grant', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  await walkStructuredArtifact({ browser, testInfo, kind: 'slide' })
})

async function createExtremeArtifact(page: Page, kind: 'sheet' | 'slide', stamp: string) {
  const name = `extreme-${kind}-${stamp}.${kind === 'sheet' ? 'sheet' : 'slides'}`
  const body = kind === 'sheet'
    ? {
        type: 'sheet' as const,
        columns: Array.from({ length: 12 }, (_, index) => `Column ${index + 1}`),
        rows: [['first value with  \nline break', ...Array.from({ length: 11 }, (_, index) => `value-${index + 1}-${'x'.repeat(48)}`)]],
        note: 'A note with  \npreserved spacing and a very long token: ' + 'n'.repeat(160),
      }
    : {
        type: 'slides' as const,
        slides: [{ title: `A title with  \npreserved spacing and ${'t'.repeat(140)}`, bullets: [`A bullet with  \npreserved spacing and ${'b'.repeat(180)}`] }],
      }
  const response = await page.request.post(`${API}/relations/ops`, {
    data: { op: { kind: 'save-artifact', artifact: { name, kind, meta: kind === 'sheet' ? 'Sheet' : 'Slides', body } } },
    headers: { 'Idempotency-Key': `structured-extreme-${stamp}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const graph = await response.json() as { extraArtifacts: ArtifactItem[] }
  const artifact = graph.extraArtifacts.find((candidate) => candidate.name === name)
  expect(artifact).toBeTruthy()
  return { artifact: artifact!, body }
}

test('extreme structured bodies preserve whitespace, wrap tokens, and keep sheet scrolling contained', async ({ page }, testInfo) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const { artifact } = await createExtremeArtifact(page, 'sheet', stamp)
  await page.goto(`/artifacts/${artifact.id}`)
  const detail = page.locator(`[data-artifact-page="${artifact.id}"]`)
  const region = detail.getByRole('region', { name: 'Sheet preview' })
  await expect(region).toBeVisible()
  await expect(region).toContainText('Column 12')
  await expect(region).toContainText('value-11-')
  await expect(region).toContainText('first value with')
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect.poll(() => detail.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    await expect.poll(() => region.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
    await expect(region.locator('td').first()).toHaveCSS('white-space', 'pre-wrap')
    await expect(region.locator('td').first()).toContainText('first value with')
    await region.focus()
    const lastHeader = region.locator('thead th').last()
    await expect.poll(() => lastHeader.evaluate((node) => ({
      cell: node.getBoundingClientRect().width,
      region: node.closest('[role="region"]')!.clientWidth,
      fits: node.getBoundingClientRect().width <= node.closest('[role="region"]')!.clientWidth,
    }))).toMatchObject({ fits: true })
    // Native scrolling is animated and its distance varies with cell width.
    // Keep pressing the real key until the final column is contained, within
    // the normal assertion budget; never assign scrollLeft to fake reachability.
    await expect.poll(async () => {
      await region.press('ArrowRight')
      return lastHeader.evaluate((node) => {
        const box = node.getBoundingClientRect()
        const parent = node.closest('[role="region"]')!.getBoundingClientRect()
        return box.left >= parent.left && box.right <= parent.right
      })
    }, { intervals: [16] }).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`structured-extreme-sheet-${viewport.width}x${viewport.height}.png`) })
  }
})

test('extreme slide text wraps without widening the page', async ({ page }, testInfo) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const { artifact } = await createExtremeArtifact(page, 'slide', stamp)
  await page.goto(`/artifacts/${artifact.id}`)
  const detail = page.locator(`[data-artifact-page="${artifact.id}"]`)
  const slides = detail.locator('[data-structured-artifact-body="slides"]')
  await expect(slides).toContainText('A title with')
  await expect(slides).toContainText('A bullet with')
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect.poll(() => detail.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    await expect(slides.locator('h3')).toHaveCSS('white-space', 'pre-wrap')
    await page.screenshot({ path: testInfo.outputPath(`structured-extreme-slide-${viewport.width}x${viewport.height}.png`) })
  }
})

type TestInfo = import('@playwright/test').TestInfo
