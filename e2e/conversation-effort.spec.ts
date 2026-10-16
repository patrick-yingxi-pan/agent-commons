/** A personal model preference write holds conversation transport until the
 * exact choice is acknowledged or the person explicitly dismisses the hold. */
import { randomUUID } from 'node:crypto'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import type { Session, ViewerModelPreferences } from '../contract/index.ts'
import { newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { settledNarrowRail } from './accessibility-helpers.ts'

const API = '/api/v1'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const
const BLOCKED_PLACEHOLDER = 'Finish the model preference change before sending.'

function identity(suffix: string, stamp: string) {
  return {
    'x-user-id': `user-conversation-effort-${suffix}-${stamp}`,
    'x-tenant-id': `tenant-conversation-effort-${suffix}-${stamp}`,
  }
}

async function selectLowEffort(page: Page) {
  await page.getByRole('button', { name: 'Model and effort', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Model and effort', exact: true })
  await expect(picker.getByRole('button', { name: 'Low', exact: true })).toBeEnabled()
  await picker.getByRole('button', { name: 'Low', exact: true }).click()
  return picker
}

async function readPreference(page: Page): Promise<ViewerModelPreferences> {
  const response = await page.request.get(`${API}/viewer-preferences/model`)
  expect(response.ok(), await response.text()).toBe(true)
  return response.json() as Promise<ViewerModelPreferences>
}

async function capture(page: Page, testInfo: TestInfo, state: string, viewport: { width: number; height: number }) {
  await settledNarrowRail(page)
  await page.screenshot({ path: testInfo.outputPath(`conversation-effort-${state}-${viewport.width}x${viewport.height}.png`) })
  const picker = page.getByRole('dialog', { name: 'Model and effort', exact: true })
  if (viewport.height === 390 && await picker.isVisible()) {
    // Short surfaces intentionally scroll. Prove the held effort controls are
    // reachable inside the bounded menu, not merely clipped by its shell.
    const low = picker.getByRole('button', { name: 'Low', exact: true })
    await low.scrollIntoViewIfNeeded()
    const menuBox = await picker.boundingBox()
    const effortBox = await low.boundingBox()
    expect(menuBox).not.toBeNull()
    expect(effortBox).not.toBeNull()
    expect(menuBox!.y).toBeGreaterThanOrEqual(7)
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height - 7)
    expect(effortBox!.y).toBeGreaterThanOrEqual(menuBox!.y)
    expect(effortBox!.y + effortBox!.height).toBeLessThanOrEqual(menuBox!.y + menuBox!.height)
    await expect(low).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath(`conversation-effort-${state}-${viewport.width}x${viewport.height}-scrolled.png`) })
  }
}

test('a draft retains its text while model effort is held, then retries the choice before Send', async ({ browser }, testInfo) => {
  test.setTimeout(ms(90_000))
  const stamp = randomUUID().slice(0, 8)
  const owner = await newUser(browser, identity('draft', stamp))
  const { page } = owner
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
  let preferenceWrites = 0
  let messagePosts = 0
  await page.route(`**${API}/viewer-preferences/model`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    preferenceWrites += 1
    if (preferenceWrites === 1) {
      await firstGate
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
        error: { code: 'internal', message: 'Preference service unavailable.' },
      }) })
      return
    }
    await route.continue()
  })
  await page.route(`**${API}/sessions/*/messages`, async (route) => {
    if (route.request().method() === 'POST') messagePosts += 1
    await route.continue()
  })

  try {
    await page.goto('/')
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    const draft = `Keep this unsent draft through the preference hold ${stamp}.`
    await composer.fill(draft)
    await selectLowEffort(page)
    const pending = page.locator('[data-revisioned-mutation="model-preferences"][data-mutation-status="pending"]')
    await expect(pending).toBeVisible()
    await expect(composer).toBeDisabled()
    await expect(composer).toHaveAttribute('placeholder', BLOCKED_PLACEHOLDER)
    await expect(composer).toHaveValue(draft)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      await expect(pending).toBeVisible()
      await expect(composer).toBeDisabled()
      await expect(composer).toHaveValue(draft)
      await expect(composer).toHaveAttribute('placeholder', BLOCKED_PLACEHOLDER)
      expect(messagePosts, `${viewport.width}×${viewport.height}: a held draft issues no message POST`).toBe(0)
      await capture(page, testInfo, 'draft-pending', viewport)
    }

    releaseFirst()
    const failed = page.locator('[data-revisioned-mutation="model-preferences"][data-mutation-status="failed"]')
    await expect(failed).toContainText('Couldn’t save your model preference')
    await expect(failed.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    await expect(failed.getByRole('button', { name: 'Dismiss', exact: true })).toBeVisible()
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      await expect(failed).toBeVisible()
      await expect(composer).toBeDisabled()
      await expect(composer).toHaveValue(draft)
      await expect(composer).toHaveAttribute('placeholder', BLOCKED_PLACEHOLDER)
      expect(messagePosts, `${viewport.width}×${viewport.height}: failed hold issues no message POST`).toBe(0)
      await capture(page, testInfo, 'draft-failed', viewport)
    }

    await failed.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(failed).toHaveCount(0)
    await expect.poll(async () => (await readPreference(page)).preferences.effort).toBe('Low')
    await expect(composer).toBeEnabled()
    await expect(composer).toHaveValue(draft)
    expect(preferenceWrites).toBe(2)
    expect(messagePosts).toBe(0)
  } finally {
    releaseFirst()
    await owner.context.close()
  }
})

test('an existing interrupted conversation holds Retry through failure and Dismiss releases it without sending', async ({ browser }, testInfo) => {
  test.setTimeout(ms(90_000))
  const stamp = randomUUID().slice(0, 8)
  const owner = await newUser(browser, identity('existing', stamp))
  const { page } = owner
  let releasePreference!: () => void
  const preferenceGate = new Promise<void>((resolve) => { releasePreference = resolve })
  let messagePosts = 0
  let preferenceWrites = 0
  await page.route(`**${API}/viewer-preferences/model`, async (route) => {
    if (route.request().method() === 'PATCH') {
      preferenceWrites += 1
      await preferenceGate
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
        error: { code: 'internal', message: 'Preference service unavailable.' },
      }) })
      return
    }
    await route.continue()
  })
  await page.route(`**${API}/sessions/*/messages`, async (route) => {
    if (route.request().method() === 'POST') messagePosts += 1
    await route.continue()
  })

  try {
    const created = await page.request.post(`${API}/sessions`, {
      data: { firstMessage: `An interrupted user turn ${stamp}`, persistFirstMessage: true },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const session = await created.json() as Session
    await page.goto(`/s/${encodeURIComponent(session.id)}`)
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    // The conversation's turn control precedes the model-preference notice's
    // own Retry action in the rendered pane.
    const main = page.locator('#main-workspace')
    const retryTurn = main.getByRole('button', { name: 'Retry', exact: true })
    await expect(retryTurn).toBeVisible()
    await composer.fill(`A later draft held behind model preference ${stamp}.`)
    const baseline = await readPreference(page)

    await selectLowEffort(page)
    const pending = page.locator('[data-revisioned-mutation="model-preferences"][data-mutation-status="pending"]')
    await expect(pending).toBeVisible()
    await expect(composer).toBeDisabled()
    await expect(composer).toHaveAttribute('placeholder', BLOCKED_PLACEHOLDER)
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      await expect(pending).toBeVisible()
      await expect(composer).toBeDisabled()
      await expect(retryTurn).toHaveCount(0)
      expect(messagePosts, `${viewport.width}×${viewport.height}: a pending preference holds conversation transport`).toBe(0)
      await capture(page, testInfo, 'conversation-pending', viewport)
    }

    releasePreference()
    const failed = page.locator('[data-revisioned-mutation="model-preferences"][data-mutation-status="failed"]')
    await expect(failed).toContainText('Couldn’t save your model preference')
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      await expect(failed).toBeVisible()
      await expect(composer).toBeDisabled()
      await expect(composer).toHaveValue(`A later draft held behind model preference ${stamp}.`)
      await expect(composer).toHaveAttribute('placeholder', BLOCKED_PLACEHOLDER)
      await expect(retryTurn).toHaveCount(0)
      expect(messagePosts, `${viewport.width}×${viewport.height}: a failed preference holds conversation transport`).toBe(0)
      await capture(page, testInfo, 'conversation-failed', viewport)
    }

    await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(failed).toHaveCount(0)
    await expect(composer).toBeEnabled()
    await expect(retryTurn).toBeEnabled()
    await expect.poll(async () => (await readPreference(page)).revision).toBe(baseline.revision)
    expect(preferenceWrites).toBe(1)
    expect(messagePosts).toBe(0)
  } finally {
    releasePreference()
    await owner.context.close()
  }
})

test('a committed preference with lost acknowledgement stays held until Dismiss can read saved truth', async ({ browser }, testInfo) => {
  test.setTimeout(ms(90_000))
  const stamp = randomUUID().slice(0, 8)
  const owner = await newUser(browser, identity('lost-ack', stamp))
  const { page } = owner
  let preferenceWrites = 0
  let failedReads = false
  let reconciliationReads = 0
  let messagePosts = 0
  let sessionCreates = 0
  await page.route(`**${API}/viewer-preferences/model`, async (route) => {
    const method = route.request().method()
    if (method === 'PATCH') {
      preferenceWrites += 1
      const committed = await route.fetch()
      expect(committed.ok(), await committed.text()).toBe(true)
      failedReads = true
      // The server has committed Low, but this page loses the acknowledgement.
      await route.abort('failed')
      return
    }
    if (method === 'GET' && failedReads) {
      reconciliationReads += 1
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
        error: { code: 'internal', message: 'Preference read unavailable.' },
      }) })
      return
    }
    await route.continue()
  })
  await page.route(`**${API}/sessions`, async (route) => {
    if (route.request().method() === 'POST') sessionCreates += 1
    await route.continue()
  })
  await page.route(`**${API}/sessions/*/messages`, async (route) => {
    if (route.request().method() === 'POST') messagePosts += 1
    await route.continue()
  })

  try {
    await page.goto('/')
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    const draft = `Keep this draft while saved model truth is unavailable ${stamp}.`
    await composer.fill(draft)
    await selectLowEffort(page)

    const failed = page.locator('[data-revisioned-mutation="model-preferences"][data-mutation-status="failed"]')
    await expect(failed).toContainText('Couldn’t save your model preference')
    await expect(failed.getByRole('button', { name: 'Dismiss', exact: true })).toBeVisible()
    await expect(composer).toBeDisabled()
    await expect(composer).toHaveAttribute('placeholder', BLOCKED_PLACEHOLDER)
    await expect(composer).toHaveValue(draft)
    await expect.poll(() => reconciliationReads).toBeGreaterThan(0)
    expect(preferenceWrites).toBe(1)
    expect(messagePosts).toBe(0)
    expect(sessionCreates).toBe(0)

    await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(failed).toContainText('Couldn’t read saved changes. Dismiss again to recheck without resending.')
    await expect(failed.getByRole('button', { name: 'Dismiss', exact: true })).toBeVisible()
    await expect(composer).toBeDisabled()
    await expect(composer).toHaveAttribute('placeholder', BLOCKED_PLACEHOLDER)
    await expect(composer).toHaveValue(draft)
    expect(preferenceWrites, 'a failed Dismiss read never repeats the committed PATCH').toBe(1)
    expect(messagePosts).toBe(0)
    expect(sessionCreates).toBe(0)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      await expect(failed).toBeVisible()
      await expect(failed).toContainText('Couldn’t read saved changes. Dismiss again to recheck without resending.')
      await expect(composer).toBeDisabled()
      await expect(composer).toHaveValue(draft)
      await expect(composer).toHaveAttribute('placeholder', BLOCKED_PLACEHOLDER)
      expect(messagePosts, `${viewport.width}×${viewport.height}: failed Dismiss keeps message transport held`).toBe(0)
      expect(sessionCreates, `${viewport.width}×${viewport.height}: failed Dismiss does not materialize a draft`).toBe(0)
      await capture(page, testInfo, 'lost-ack-dismiss-failed', viewport)
    }

    failedReads = false
    await failed.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(failed).toHaveCount(0)
    await expect(composer).toBeEnabled()
    await expect(composer).toHaveValue(draft)
    await expect.poll(async () => (await readPreference(page)).preferences.effort).toBe('Low')
    expect(preferenceWrites, 'the successful Dismiss read releases the exact committed choice without replay').toBe(1)
    expect(messagePosts).toBe(0)
    expect(sessionCreates).toBe(0)
  } finally {
    await owner.context.close()
  }
})
