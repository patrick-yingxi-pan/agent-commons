import { test, expect, type Page } from '@playwright/test'
import { clearAutoPanel, splitPane } from './pane-actions.ts'

async function delayedBoot(page: Page, outcome: 'success' | 'not-found' | 'same-address-focus') {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/s/auth-refactor')
  await expect(page.getByText('token refresh logic').first()).toBeVisible()
  await clearAutoPanel(page)
  if (outcome === 'same-address-focus') await splitPane(page, 'right')

  // Restore the conversation shell, but hold every session read so both
  // pane hydration and the independent boot validation stay pending.
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let held = 0
  const reads: Promise<void>[] = []
  await page.route((url) => url.pathname === '/api/v1/sessions/auth-refactor', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    held += 1
    const read = (async () => {
      const response = await route.fetch()
      await gate
      if (outcome === 'not-found') await route.fulfill({ status: 404, json: { error: 'not_found' } })
      else await route.fulfill({ response })
    })()
    reads.push(read)
    await read
  })
  try {
    await page.reload()
    await expect.poll(() => held).toBeGreaterThan(0)
    await expect(page.locator('[data-main-pane]')).toHaveCount(outcome === 'same-address-focus' ? 2 : 1)
    if (outcome === 'success') {
      await page.getByRole('navigation', { name: 'Sections' }).getByText('Projects', { exact: true }).click()
      await expect(page.getByText('Platform hardening').first()).toBeVisible()
    } else if (outcome === 'not-found') {
      await page.locator('[data-close-view]').click()
      await expect(page.locator('[data-main-background]')).toBeVisible()
    } else {
      await page.locator('[data-main-pane="b"]').dispatchEvent('pointerdown')
      await expect(page.locator('[data-main-pane="b"]')).toHaveAttribute('data-focused', 'true')
    }
    release()
    await Promise.all(reads)
    // Let the delivered fetch continuations and their React commit paint
    // before checking absence; a pre-response empty tree proves nothing.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    if (outcome === 'success') {
      await expect(page).toHaveURL(/\/projects$/)
      await expect(page.getByText('Platform hardening').first()).toBeVisible()
      await expect(page.locator('[data-conversation-pane]')).toHaveCount(0)
    } else if (outcome === 'not-found') {
      await expect(page.locator('[data-main-background]')).toBeVisible()
      await expect(page.locator('[data-main-pane]')).toHaveCount(0)
    } else {
      await expect(page.locator('[data-main-pane="b"]')).toHaveAttribute('data-focused', 'true')
    }
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
}

// Top-level declarations are also the verifier's static coverage manifest.
test('a delayed successful boot cannot undo newer workspace navigation', async ({ page }) => {
  await delayedBoot(page, 'success')
})

test('a delayed not-found boot cannot recreate a closed workspace', async ({ page }) => {
  await delayedBoot(page, 'not-found')
})

test('a delayed boot cannot reclaim focus between panes at the same address', async ({ page }) => {
  await delayedBoot(page, 'same-address-focus')
})

test('cached session preferences preserve the closed panel and open sharing draft through hydration', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  const preference = await page.request.patch('/api/v1/sessions/auth-refactor/preferences', {
    data: { panelFocus: null },
  })
  expect(preference.ok()).toBe(true)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let reads = 0
  let held = 0
  const completions: Promise<void>[] = []
  await page.route((url) => url.pathname === '/api/v1/sessions/auth-refactor', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    reads += 1
    if (reads === 1) return route.continue() // boot validation fills the exact cache
    held += 1
    const completion = (async () => {
      const response = await route.fetch()
      await gate
      await route.fulfill({ response })
    })()
    completions.push(completion)
    await completion
  })
  try {
    await page.goto('/s/auth-refactor')
    const conversation = page.locator('[data-conversation-pane="auth-refactor"]')
    await expect(conversation.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled()
    await expect.poll(() => held).toBeGreaterThan(0)
    // The cached, account-scoped row already says closed. A later read must
    // not be needed to correct an invented auto-open or remount this form.
    await expect(page.locator('[data-context-pane]')).toHaveCount(0)
    const share = conversation.getByRole('button', { name: 'Share this conversation' })
    await share.click()
    const audience = conversation.getByLabel('Audience id')
    await audience.fill('pending audience')
    release()
    await Promise.all(completions)
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    await expect(page.locator('[data-context-pane]')).toHaveCount(0)
    await expect(share).toHaveAttribute('aria-expanded', 'true')
    await expect(audience).toHaveValue('pending audience')
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
})
