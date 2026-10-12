import { test, expect, type Page, type TestInfo } from '@playwright/test'
import type { Message, ScheduleTemplate, ScheduledTask } from '../contract/index.ts'
import { ms } from './budget.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

/** A read-only projection carries the proposal; no model turn or decision is
 * involved, so a loading/error shell cannot pass by changing server truth. */
async function openHeldRelationProposal(page: Page) {
  await page.context().setExtraHTTPHeaders({ 'x-tenant-id': 'tenant-proposal-loading', 'x-user-id': 'user-ada' })
  const created = await page.request.post('/api/v1/sessions', { data: {} })
  expect(created.ok()).toBe(true)
  const { id } = await created.json() as { id: string }
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/api/v1/')) writes.push(request.url())
  })
  await page.route(`**/api/v1/sessions/${id}*`, async (route) => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const session = await response.json()
    const message: Message = {
      id: 'held-relation-proposal',
      role: 'assistant',
      content: 'This transcript remains available while proposal review loads.',
      relationActions: [{
        kind: 'create-project',
        projectId: 'proposal-loading-fixture-project',
        projectName: 'Held proposal project',
        projectDescription: 'A read-only fixture for lazy proposal review.',
      }],
    }
    await route.fulfill({ response, json: { ...session, messages: [message] } })
  })
  await page.goto(`/s/${id}`)
  return { id, writes }
}

async function captureRelationState(page: Page, testInfo: TestInfo, phase: 'loading' | 'error') {
  const state = page.locator(phase === 'loading' ? '[data-relation-action-loading]' : '[data-relation-action-load-error]')
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(state).toBeVisible()
    await expect(page.getByText('This transcript remains available while proposal review loads.', { exact: true })).toBeVisible()
    await state.scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`relation-review-${phase}-${viewport.width}x${viewport.height}.png`) })
  }
}

test('relation proposal review stays read-only while its deferred card is held, then resolves in place', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let intercepted = false
  await page.route('**/src/components/RelationActionCard.tsx*', async (route) => {
    intercepted = true
    await gate
    await route.continue()
  })
  try {
    const { writes } = await openHeldRelationProposal(page)
    const loading = page.locator('[data-relation-action-loading]')
    await expect(loading).toBeVisible({ timeout: ms(20_000) })
    await expect(loading).toHaveAttribute('role', 'status')
    await captureRelationState(page, testInfo, 'loading')
    expect(intercepted, 'the test held the real deferred relation card module').toBe(true)
    expect(writes, 'display loading never makes a consent write').toEqual([])
    release()
    await expect(page.getByText('Proposed changes', { exact: false })).toBeVisible({ timeout: ms(20_000) })
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
    expect(writes, 'resolving the module remains read-only until a person decides').toEqual([])
  } finally {
    release()
  }
})

test('a failed relation proposal module preserves the transcript and recovers only after explicit reload', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  let blocked = true
  let intercepted = false
  await page.route('**/src/components/RelationActionCard.tsx*', async (route) => {
    intercepted = true
    if (blocked) await route.abort('failed')
    else await route.continue()
  })
  const { writes } = await openHeldRelationProposal(page)
  const failed = page.locator('[data-relation-action-load-error]')
  await expect(failed).toBeVisible({ timeout: ms(20_000) })
  await expect(failed).toHaveAttribute('role', 'alert')
  await expect(failed).toContainText('No decision was made')
  await expect(failed).toContainText('Copy unsent workspace text before reloading')
  await expect(failed.getByRole('button', { name: 'Reload proposal review', exact: true })).toBeVisible()
  await captureRelationState(page, testInfo, 'error')
  expect(intercepted, 'the test failed the real deferred relation card module').toBe(true)
  expect(writes, 'module failure never makes a consent write').toEqual([])

  blocked = false
  await failed.getByRole('button', { name: 'Reload proposal review', exact: true }).click()
  await expect(page.getByText('Proposed changes', { exact: false })).toBeVisible({ timeout: ms(20_000) })
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
  expect(writes, 'explicit module recovery does not decide the proposal').toEqual([])
})

async function createRoutineWithOfferedChange(page: Page) {
  const templateResponse = await page.request.get('/api/v1/schedule-templates')
  expect(templateResponse.ok()).toBe(true)
  const [template] = await templateResponse.json() as ScheduleTemplate[]
  expect(template, 'the isolated fixture has a routine template').toBeTruthy()
  const stamp = Date.now().toString(36)
  const response = await page.request.post('/api/v1/schedules', {
    data: { seed: { ...template!.seed, name: `Deferred improvements ${stamp}`, runs: [] } },
  })
  expect(response.ok()).toBe(true)
  const routine = await response.json() as ScheduledTask
  const offered = await page.request.post('/api/v1/proposals', {
    data: {
      subject: { kind: 'schedule', id: routine.id },
      delta: { kind: 'suggestion', text: `Review this suggestion ${stamp}` },
      rationale: 'A test-owned offer ensures the Land control is absent until the panel is ready.',
    },
  })
  expect(offered.ok()).toBe(true)
  return routine
}

async function openImprovements(page: Page, routine: ScheduledTask) {
  await page.goto(`/scheduled/${routine.id}`)
  const main = page.locator('main')
  await expect(main.getByRole('heading', { name: routine.name, exact: true })).toBeVisible({ timeout: ms(20_000) })
  const section = main.getByRole('button', { name: /^Improvements\b/ })
  if ((await section.getAttribute('aria-expanded')) === 'false') await section.click()
  return { main, section }
}

async function captureImprovements(page: Page, testInfo: TestInfo, phase: 'loading' | 'error') {
  const state = page.locator(`[data-proposals-load="${phase}"]`)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(state).toBeVisible()
    await expect(page.getByRole('button', { name: 'Offer a change', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Land', exact: true })).toHaveCount(0)
    await state.scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`improvements-${phase}-${viewport.width}x${viewport.height}.png`) })
  }
}

test('Improvements keeps its Section shell and hides offer/verdict actions until its deferred panel is ready', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  const routine = await createRoutineWithOfferedChange(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let intercepted = false
  await page.route('**/src/components/ProposalsPanel.tsx*', async (route) => {
    intercepted = true
    await gate
    await route.continue()
  })
  try {
    const { main, section } = await openImprovements(page, routine)
    const loading = page.locator('[data-proposals-load="loading"]')
    await expect(loading).toBeVisible({ timeout: ms(20_000) })
    await expect(section).toContainText('Improvements')
    await expect(section).toHaveAttribute('aria-expanded', 'true')
    await captureImprovements(page, testInfo, 'loading')
    expect(intercepted, 'the test held the real deferred proposal panel module').toBe(true)
    release()
    await expect(main.getByRole('button', { name: 'Offer a change', exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(main.getByRole('button', { name: 'Land', exact: true })).toBeVisible()
  } finally {
    release()
  }
})

test('a failed Improvements panel keeps its shell and offers warned explicit recovery', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  const routine = await createRoutineWithOfferedChange(page)
  let blocked = true
  let intercepted = false
  await page.route('**/src/components/ProposalsPanel.tsx*', async (route) => {
    intercepted = true
    if (blocked) await route.abort('failed')
    else await route.continue()
  })
  const { main, section } = await openImprovements(page, routine)
  const failed = page.locator('[data-proposals-load="error"]')
  await expect(failed).toBeVisible({ timeout: ms(20_000) })
  await expect(failed).toContainText('No change was offered or decision made')
  await expect(failed).toContainText('Copy unsent workspace text before reloading')
  await expect(section).toContainText('Improvements')
  await expect(section).toHaveAttribute('aria-expanded', 'true')
  await captureImprovements(page, testInfo, 'error')
  expect(intercepted, 'the test failed the real deferred proposal panel module').toBe(true)

  blocked = false
  await failed.getByRole('button', { name: 'Reload improvements', exact: true }).click()
  await expect(main.getByRole('button', { name: 'Offer a change', exact: true })).toBeVisible({ timeout: ms(20_000) })
  await expect(main.getByRole('button', { name: 'Land', exact: true })).toBeVisible()
})
