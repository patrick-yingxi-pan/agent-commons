/** Owner-only whole-body editing for authored sheets and slides. */
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { ArtifactContent, ArtifactItem, Grant, StructuredArtifactBody } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function createArtifact(page: Page, kind: 'sheet' | 'slide', stamp: string) {
  const name = `editable-${kind}-${stamp}.${kind === 'sheet' ? 'sheet' : 'slides'}`
  const body: StructuredArtifactBody = kind === 'sheet'
    ? { type: 'sheet', columns: ['Metric', 'Value'], rows: [['Revenue', '00042']] }
    : { type: 'slides', slides: [{ title: 'Quarterly review', bullets: ['A saved bullet.'] }] }
  const response = await page.request.post(`${API}/relations/ops`, {
    data: { op: { kind: 'save-artifact', artifact: { name, kind, meta: kind === 'sheet' ? 'Sheet' : 'Slides', body } } },
    headers: { 'Idempotency-Key': `structured-edit-${kind}-${stamp}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const graph = await response.json() as { extraArtifacts: ArtifactItem[] }
  const artifact = graph.extraArtifacts.find((row) => row.name === name)
  expect(artifact).toBeTruthy()
  return { artifact: artifact!, body, name }
}

async function grant(page: Page, id: string): Promise<Grant> {
  const response = await page.request.post(`${API}/grants`, {
    data: { subject: { kind: 'artifact', id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return await response.json() as Grant
}

async function stackSeedAccounts(page: Page) {
  for (const [email, password] of [
    ['ada@acme.example', 'ada-demo-password'],
    ['grace@acme.example', 'grace-demo-password'],
  ]) {
    const response = await page.request.post('/api/v1/auth/login', { data: { email, password } })
    expect(response.ok(), await response.text()).toBeTruthy()
  }
}

async function switchAccount(page: Page, name: string) {
  await page.getByTestId('account-chip').click()
  await page.getByTestId('account-stack-option').filter({ hasText: name }).first().click()
  await expect(page.getByTestId('account-chip')).toContainText(name, { timeout: ms(10_000) })
}

async function capture(page: Page, detail: Locator, testInfo: TestInfo, label: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await expect(detail).toBeVisible()
    const actions = detail.locator('[data-structured-artifact-editor] [data-inline-action]')
    if (await detail.locator('[data-structured-artifact-editor]').count()) {
      expect(await actions.count()).toBeGreaterThan(2)
      expect(await actions.evaluateAll((buttons) => buttons.filter((button) => {
        const style = getComputedStyle(button)
        // A flex parent's inline-flex child is blockified to computed flex.
        return !['inline-flex', 'flex'].includes(style.display) || style.alignItems !== 'center'
      }).map((button) => button.textContent?.trim()))).toEqual([])
    }
    await detail.getByRole('button', { name: 'Content', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.width}x${viewport.height}.png`) })
    const sheet = detail.getByRole('region', { name: /^(Edit sheet|Sheet preview)$/ })
    if (await sheet.count() && await sheet.evaluate((node) => node.scrollWidth > node.clientWidth)) {
      await sheet.focus()
      const finalColumn = await sheet.getByRole('textbox').count()
        ? sheet.locator('th:has(textarea)').last() : sheet.locator('th').last()
      await expect.poll(async () => {
        await sheet.press('ArrowRight')
        return finalColumn.evaluate((node) => {
          const box = node.getBoundingClientRect()
          const parent = node.closest('[role="region"]')!.getBoundingClientRect()
          return box.left >= parent.left && box.right <= parent.right
        })
      }, { intervals: [16] }).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${label}-right-edge-${viewport.width}x${viewport.height}.png`) })
    }
    if (await detail.locator('[data-structured-artifact-editor]').count()) {
      await detail.getByRole('button', { name: 'Save changes', exact: true }).click({ trial: true })
      await detail.getByRole('button', { name: 'Cancel', exact: true }).click({ trial: true })
      await page.screenshot({ path: testInfo.outputPath(`${label}-actions-${viewport.width}x${viewport.height}.png`) })
    } else {
      await detail.locator('[data-structured-artifact-body]').locator('article, tr').last().scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`${label}-end-${viewport.width}x${viewport.height}.png`) })
      const provenance = detail.locator('[data-resource-section="Provenance"]')
      await provenance.scrollIntoViewIfNeeded()
      await expect(provenance).toBeInViewport({ ratio: 1 })
      await page.screenshot({ path: testInfo.outputPath(`${label}-footer-${viewport.width}x${viewport.height}.png`) })
    }
  }
}

test('successful structured save refreshes Edited recency without ambient events', async ({ browser }) => {
  test.setTimeout(ms(45_000))
  const owner = await newUser(browser)
  const stamp = Date.now().toString(36)
  try {
    const { artifact } = await createArtifact(owner.page, 'sheet', `no-events-${stamp}`)
    const historicalEditedAt = Date.now() - 2 * 24 * 60 * 60 * 1_000
    let artifactReads = 0
    let relationReads = 0
    let artifactProjectionStaled = false
    let relationProjectionStaled = false

    await owner.page.route(`**${API}/events*`, (route) => route.abort('connectionrefused'))
    await owner.page.route(`**${API}/artifacts`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      artifactReads += 1
      if (artifactReads > 1) return route.continue()
      const response = await route.fetch()
      const rows = await response.json() as ArtifactItem[]
      artifactProjectionStaled = rows.some((row) => row.id === artifact.id)
      await route.fulfill({ response, json: rows.map((row) =>
        row.id === artifact.id ? { ...row, editedAt: historicalEditedAt } : row) })
    })
    await owner.page.route(`**${API}/relations`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      relationReads += 1
      if (relationReads > 1) return route.continue()
      const response = await route.fetch()
      const graph = await response.json() as { extraArtifacts: ArtifactItem[] }
      relationProjectionStaled = graph.extraArtifacts.some((row) => row.id === artifact.id)
      await route.fulfill({ response, json: {
        ...graph,
        extraArtifacts: graph.extraArtifacts.map((row) =>
          row.id === artifact.id ? { ...row, editedAt: historicalEditedAt } : row),
      } })
    })

    await owner.page.goto(`/artifacts/${artifact.id}`)
    const detail = owner.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await expect(detail).toBeVisible()
    expect(artifactProjectionStaled).toBe(true)
    expect(relationProjectionStaled).toBe(true)
    await expect(detail.getByText('Edited 2 days ago', { exact: true })).toBeVisible()

    await detail.getByRole('button', { name: 'Edit sheet', exact: true }).click()
    await detail.getByRole('textbox', { name: 'Sheet row 1 value 2' }).fill('00777')
    await detail.getByRole('button', { name: 'Save changes', exact: true }).click()

    await expect(detail.getByText('00777', { exact: true })).toBeVisible()
    await expect(detail.getByText('Edited just now', { exact: true })).toBeVisible()
    expect(artifactReads).toBeGreaterThanOrEqual(2)
    expect(relationReads).toBeGreaterThanOrEqual(2)
  } finally {
    await owner.context.close()
  }
})

test('owner edits a sheet structure with a held CAS draft; reader remains read-only', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const stamp = Date.now().toString(36)
  try {
    const { artifact } = await createArtifact(owner.page, 'sheet', stamp)
    const detail = owner.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await owner.page.goto(`/artifacts/${artifact.id}`)
    await expect(owner.page.getByRole('button', { name: 'Edit sheet', exact: true })).toBeVisible()
    await owner.page.getByRole('button', { name: 'Edit sheet', exact: true }).click()
    await expect(owner.page.locator('[data-structured-artifact-editor="sheet"]')).toBeVisible()
    await owner.page.getByRole('textbox', { name: 'Sheet row 1 value 2' }).fill('00043')
    await owner.page.getByRole('textbox', { name: 'Sheet column 1' }).fill('')
    await expect(owner.page.getByRole('alert')).toContainText('blank labels')
    await expect(owner.page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled()
    await owner.page.getByRole('textbox', { name: 'Sheet column 1' }).fill('Metric\nLabel')
    await owner.page.getByRole('button', { name: 'Add row', exact: true }).click()
    await owner.page.getByRole('textbox', { name: 'Sheet row 2 value 1' }).fill('Temporary row')
    await owner.page.getByRole('button', { name: 'Remove sheet row 2', exact: true }).click()
    await owner.page.getByRole('button', { name: 'Add row', exact: true }).click()
    await owner.page.getByRole('button', { name: 'Add column', exact: true }).click()
    await owner.page.getByRole('textbox', { name: 'Sheet column 3' }).fill('Status')
    await owner.page.getByRole('textbox', { name: 'Sheet row 2 value 3' }).fill('Draft')
    await owner.page.getByRole('button', { name: 'Remove sheet column 3', exact: true }).click()
    await owner.page.getByRole('button', { name: 'Add column', exact: true }).click()
    await owner.page.getByRole('textbox', { name: 'Sheet column 3' }).fill('Status')
    await owner.page.getByRole('textbox', { name: 'Sheet row 2 value 3' }).fill('Draft')
    await capture(owner.page, detail, testInfo, 'structured-edit-sheet-editor')

    // A concurrent full-body write makes the reviewed opening revision stale.
    const bodyResponse = await owner.page.request.get(`${API}/artifact-content`)
    expect(bodyResponse.ok()).toBeTruthy()
    const library = await bodyResponse.json() as Record<string, ArtifactContent>
    const current = library[artifact.id]
    expect(current?.type).toBe('sheet')
    if (!current || current.type !== 'sheet') throw new Error('sheet body missing')
    const remote: StructuredArtifactBody = {
      type: 'sheet',
      columns: [...current.columns],
      rows: [['Remote', '00099'], ...current.rows.slice(1)],
      ...(current.note === undefined ? {} : { note: current.note }),
    }
    let attempts = 0
    await owner.page.route(`**${API}/artifacts/${artifact.id}/content`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      attempts += 1
      if (attempts === 1) {
        const response = await owner.page.request.patch(`${API}/artifacts/${artifact.id}/content`, {
          data: { content: remote, expectedRevision: current.revision ?? 0 },
        })
        expect(response.ok(), await response.text()).toBeTruthy()
      }
      await route.continue()
    })
    await owner.page.getByRole('button', { name: 'Save changes', exact: true }).click()
    const notice = owner.page.locator('[data-revisioned-mutation="structured-artifact"]')
    await expect(notice).toContainText('Retry replaces the entire saved sheet or deck')
    await expect(owner.page.getByRole('textbox', { name: 'Sheet row 1 value 2' })).toBeDisabled()
    await expect(owner.page.getByText('Remote')).toBeVisible()
    await notice.getByRole('button', { name: 'Retry' }).click()
    await expect(notice).toHaveCount(0)
    await expect(owner.page.getByText('00043')).toBeVisible()
    expect(attempts).toBe(2)
    await owner.page.unroute(`**${API}/artifacts/${artifact.id}/content`)

    await owner.page.getByRole('button', { name: 'Edit sheet', exact: true }).click()
    const heldDraft = owner.page.getByRole('textbox', { name: 'Sheet row 1 value 2' })
    await heldDraft.fill('Dismissed draft')
    const latestResponse = await owner.page.request.get(`${API}/artifact-content`)
    const latestLibrary = await latestResponse.json() as Record<string, ArtifactContent>
    const latest = latestLibrary[artifact.id]
    expect(latest?.type).toBe('sheet')
    if (!latest || latest.type !== 'sheet') throw new Error('latest sheet body missing')
    const remoteAfterRetry: StructuredArtifactBody = {
      type: 'sheet',
      columns: [...latest.columns],
      rows: [
        latest.columns.length > 2 ? ['Remote after retry', '00098', ''] : ['Remote after retry', '00098'],
        ...latest.rows.slice(1),
      ],
      ...(latest.note === undefined ? {} : { note: latest.note }),
    }
    let dismissAttempts = 0
    await owner.page.route(`**${API}/artifacts/${artifact.id}/content`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      dismissAttempts += 1
      if (dismissAttempts === 1) {
        const response = await owner.page.request.patch(`${API}/artifacts/${artifact.id}/content`, {
          data: { content: remoteAfterRetry, expectedRevision: latest.revision ?? 0 },
        })
        expect(response.ok(), await response.text()).toBeTruthy()
      }
      await route.continue()
    })
    await owner.page.getByRole('button', { name: 'Save changes', exact: true }).click()
    const dismissNotice = owner.page.locator('[data-revisioned-mutation="structured-artifact"]')
    await expect(dismissNotice).toContainText('Retry replaces the entire saved sheet or deck')
    await dismissNotice.getByRole('button', { name: 'Dismiss' }).click()
    await expect(dismissNotice).toHaveCount(0)
    await expect(heldDraft).toBeEnabled()
    await expect(heldDraft).toHaveValue('Dismissed draft')
    await owner.page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(owner.page.getByText('Dismissed draft')).toHaveCount(0)
    await expect(owner.page.getByText('00098')).toBeVisible()
    await owner.page.unroute(`**${API}/artifacts/${artifact.id}/content`)
    await capture(owner.page, detail, testInfo, 'structured-edit-sheet-settled')

    const grantReceipt = await grant(owner.page, artifact.id)
    expect(grantReceipt.id).toBeTruthy()
    await reader.page.goto(`/artifacts/${artifact.id}`)
    await expect(reader.page.getByRole('button', { name: 'Edit sheet', exact: true })).toHaveCount(0)
    await expect(reader.page.locator(`[data-artifact-page="${artifact.id}"]`)).toContainText('00098')
    await capture(reader.page, reader.page.locator(`[data-artifact-page="${artifact.id}"]`), testInfo, 'structured-edit-sheet-reader')
    await foreign.page.goto(`/artifacts/${artifact.id}`)
    await expect(foreign.page.getByRole('button', { name: 'Edit sheet', exact: true })).toHaveCount(0)
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})

test('owner edits slide title, bullets, order, and structure while reader stays read-only', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  try {
    const { artifact } = await createArtifact(owner.page, 'slide', Date.now().toString(36))
    const detail = owner.page.locator(`[data-artifact-page="${artifact.id}"]`)
    await owner.page.goto(`/artifacts/${artifact.id}`)
    await owner.page.getByRole('button', { name: 'Edit slides', exact: true }).click()
    await expect(owner.page.locator('[data-structured-artifact-editor="slides"]')).toBeVisible()
    await owner.page.getByRole('textbox', { name: 'Slide 1 title' }).fill('Updated\nmultiline title')
    await expect(owner.page.getByRole('textbox', { name: 'Slide 1 title' })).toHaveValue('Updated\nmultiline title')
    await owner.page.getByRole('textbox', { name: 'Slide 1 bullet 1' }).fill('Updated bullet')
    await owner.page.getByRole('button', { name: 'Add bullet to slide 1', exact: true }).click()
    await owner.page.getByRole('textbox', { name: 'Slide 1 bullet 2' }).fill('Second bullet')
    await owner.page.getByRole('button', { name: 'Add bullet to slide 1', exact: true }).click()
    await owner.page.getByRole('textbox', { name: 'Slide 1 bullet 3' }).fill('Temporary bullet')
    await owner.page.getByRole('button', { name: 'Remove slide 1 bullet 3', exact: true }).click()
    await owner.page.getByRole('button', { name: 'Add slide', exact: true }).click()
    await expect(owner.page.getByRole('textbox', { name: 'Slide 2 bullet 1', exact: true })).toHaveCount(0)
    await owner.page.getByRole('textbox', { name: 'Slide 2 title' }).fill('Follow-up')
    await owner.page.getByRole('button', { name: 'Move slide 2 up', exact: true }).click()
    await expect(owner.page.getByRole('textbox', { name: 'Slide 1 title' })).toHaveValue('Follow-up')
    await owner.page.getByRole('button', { name: 'Add slide', exact: true }).click()
    await owner.page.getByRole('textbox', { name: 'Slide 3 title' }).fill('Temporary slide')
    await owner.page.getByRole('button', { name: 'Remove slide 3', exact: true }).click()
    await capture(owner.page, detail, testInfo, 'structured-edit-slides-editor')
    await owner.page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(owner.page.getByRole('button', { name: 'Edit slides', exact: true })).toBeVisible()
    await expect(detail).toContainText('Updated')
    await expect(detail).toContainText('Second bullet')
    await expect(detail).toContainText('Follow-up')
    await owner.page.getByRole('button', { name: 'Edit slides', exact: true }).click()
    await owner.page.getByRole('textbox', { name: 'Slide 1 title' }).fill('Canceled draft')
    await owner.page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(owner.page.getByText('Canceled draft')).toHaveCount(0)
    await expect(detail).toContainText('Follow-up')
    await owner.page.reload()
    await expect(detail).toContainText('Updated')
    await capture(owner.page, detail, testInfo, 'structured-edit-slides-owner')

    await grant(owner.page, artifact.id)
    await reader.page.goto(`/artifacts/${artifact.id}`)
    await expect(reader.page.getByRole('button', { name: 'Edit slides', exact: true })).toHaveCount(0)
    await expect(reader.page.locator(`[data-artifact-page="${artifact.id}"]`)).toContainText('Follow-up')
    await capture(reader.page, reader.page.locator(`[data-artifact-page="${artifact.id}"]`), testInfo, 'structured-edit-slides-reader')
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close()])
  }
})

test('account switching clears a retained structured draft on the same canonical artifact', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await stackSeedAccounts(page)
  await page.goto('/artifacts')
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await switchAccount(page, 'Ada Lovelace')

  const { artifact } = await createArtifact(page, 'slide', Date.now().toString(36))
  await grant(page, artifact.id)
  await page.goto(`/artifacts/${artifact.id}`)
  await page.getByRole('button', { name: 'Edit slides', exact: true }).click()
  const title = page.getByRole('textbox', { name: 'Slide 1 title' })
  await title.fill('Ada private draft')

  await switchAccount(page, 'Grace Hopper')
  await expect(page.locator('[data-structured-artifact-editor]')).toHaveCount(0)
  await expect(page.getByText('Ada private draft')).toHaveCount(0)
  await page.goto(`/artifacts/${artifact.id}`)
  await expect(page.getByRole('button', { name: 'Edit slides', exact: true })).toHaveCount(0)
  await expect(page.getByText('Ada private draft')).toHaveCount(0)

  await switchAccount(page, 'Ada Lovelace')
  await page.goto(`/artifacts/${artifact.id}`)
  await expect(page.getByRole('button', { name: 'Edit slides', exact: true })).toBeVisible()
  await expect(page.getByText('Ada private draft')).toHaveCount(0)
  await expect(page.getByText('Quarterly review')).toBeVisible()
})

test('a lost structured save response retries one logical edit without advancing twice', async ({ browser }) => {
  const owner = await newUser(browser)
  try {
    const { artifact } = await createArtifact(owner.page, 'sheet', `lost-${Date.now().toString(36)}`)
    await owner.page.goto(`/artifacts/${artifact.id}`)
    await owner.page.getByRole('button', { name: 'Edit sheet', exact: true }).click()
    await owner.page.getByRole('textbox', { name: 'Sheet row 1 value 2', exact: true }).fill('Committed once')
    const keys: string[] = []
    await owner.page.route(`**${API}/artifacts/${artifact.id}/content`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      keys.push(route.request().headers()['idempotency-key'] ?? '')
      if (keys.length === 1) {
        const committed = await route.fetch()
        expect(committed.ok(), await committed.text()).toBeTruthy()
        await route.abort('failed')
      } else await route.continue()
    })
    await owner.page.getByRole('button', { name: 'Save changes', exact: true }).click()
    const notice = owner.page.locator('[data-revisioned-mutation="structured-artifact"]')
    await expect(notice).toContainText('Couldn’t confirm the content edit')
    await expect(owner.page.getByRole('textbox', { name: 'Sheet row 1 value 2', exact: true })).toBeDisabled()
    await notice.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(notice).toHaveCount(0)
    await expect(owner.page.getByRole('button', { name: 'Edit sheet', exact: true })).toBeVisible()
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    const response = await owner.page.request.get(`${API}/artifact-content`)
    const saved = (await response.json())[artifact.id]
    expect(saved.revision).toBe(1)
    expect(saved.rows[0][1]).toBe('Committed once')
  } finally {
    await owner.context.close()
  }
})
