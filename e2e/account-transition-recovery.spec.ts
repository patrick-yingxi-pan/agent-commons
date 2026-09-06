/** Browser-account identity commands retain exact intent through transport
 * uncertainty and reconcile from the current cookie plus remembered ledger. */
import { test, expect, type Page } from '@playwright/test'
import { ms } from './budget.ts'

async function stackSeedAccounts(page: Page): Promise<void> {
  const ada = await page.request.post('/api/v1/auth/login', {
    data: { email: 'ada@acme.example', password: 'ada-demo-password' },
  })
  expect(ada.ok()).toBe(true)
  const grace = await page.request.post('/api/v1/auth/login', {
    data: { email: 'grace@acme.example', password: 'grace-demo-password' },
  })
  expect(grace.ok()).toBe(true)
}

test('a failed account switch remains visible and disabled for exact Retry', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await stackSeedAccounts(page)
  let attempts = 0
  const bodies: unknown[] = []
  const sources: string[] = []
  await page.route('**/api/v1/auth/session', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    bodies.push(route.request().postDataJSON())
    sources.push(route.request().headers()['x-account-transition-source'] ?? '')
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated pre-commit failure.' } }),
      })
      return
    }
    await route.continue()
  })

  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await page.getByTestId('account-chip').click()
  const ada = page.getByTestId('account-stack-option').filter({ hasText: 'Ada Lovelace' })
  await ada.click()

  const failed = page.locator('[data-account-transition="failed"]')
  await expect(failed).toContainText('Couldn’t confirm the current account', { timeout: ms(20_000) })
  await expect(ada).toContainText('Waiting for Retry')
  await expect(ada).toBeDisabled()
  await page.getByRole('navigation').getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(failed).toBeVisible()
  await expect(ada).toBeVisible()

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace', { timeout: ms(20_000) })
  await expect(page.locator('[data-account-transition]')).toHaveCount(0)
  expect(attempts).toBe(2)
  expect(bodies).toEqual([{ userId: 'user-ada' }, { userId: 'user-ada' }])
  expect(sources).toEqual(['session:user-grace', 'session:user-grace'])
})

test('a lost sign-out acknowledgement heals from exact browser truth without a second DELETE', async ({ page }) => {
  test.setTimeout(ms(60_000))
  await stackSeedAccounts(page)
  let attempts = 0
  await page.route('**/api/v1/auth/session', async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    attempts += 1
    expect(route.request().headers()['x-account-transition-source']).toBe('session:user-grace')
    const committed = await route.fetch()
    expect(committed.status()).toBe(204)
    await route.fulfill({
      status: 503,
      headers: committed.headers(),
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'internal', message: 'Acknowledgement lost after commit.' } }),
    })
  })

  await page.goto('/')
  await expect(page.getByTestId('account-chip')).toContainText('Grace Hopper')
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-signout').click()

  await expect(page.getByTestId('auth-screen')).toBeVisible({ timeout: ms(20_000) })
  await expect(page.locator('h1')).toContainText('Choose an account')
  await expect(page.getByTestId('auth-picker-account')).toContainText('Ada Lovelace')
  await expect(page.locator('[data-account-transition]')).toHaveCount(0)
  expect(attempts).toBe(1)
})
