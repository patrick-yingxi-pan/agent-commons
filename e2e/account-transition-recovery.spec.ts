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

test('credential sign-in freezes exact input through a source-bound Retry', async ({ page }) => {
  test.setTimeout(ms(60_000))
  let attempts = 0
  const bodies: unknown[] = []
  const sources: string[] = []
  const keys: Array<string | undefined> = []
  await page.route('**/api/v1/auth/login', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    bodies.push(route.request().postDataJSON())
    sources.push(route.request().headers()['x-account-transition-source'] ?? '')
    keys.push(route.request().headers()['idempotency-key'])
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Simulated login transport failure.' } }),
      })
      return
    }
    await route.continue()
  })

  await page.goto('/')
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-signin').click()
  await page.getByTestId('auth-email').fill('ada@acme.example')
  await page.getByTestId('auth-password').fill('ada-demo-password')
  await page.getByTestId('auth-submit').click()

  const failed = page.locator('[data-account-transition="failed"]')
  await expect(failed).toContainText('Couldn’t confirm the current account', { timeout: ms(20_000) })
  await expect(page.getByTestId('auth-email')).toBeDisabled()
  await expect(page.getByTestId('auth-password')).toBeDisabled()
  await expect(page.getByTestId('auth-open-signup')).toBeDisabled()
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()

  await expect(page.getByTestId('auth-screen')).toHaveCount(0, { timeout: ms(20_000) })
  await expect(page.getByTestId('account-chip')).toContainText('Ada Lovelace')
  expect(attempts).toBe(2)
  expect(bodies).toEqual([
    { email: 'ada@acme.example', password: 'ada-demo-password' },
    { email: 'ada@acme.example', password: 'ada-demo-password' },
  ])
  expect(sources).toEqual(['unsigned', 'unsigned'])
  expect(keys).toEqual([undefined, undefined])
})

test('a lost signup response retries into the same persisted account', async ({ page, request }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const who = {
    name: `Recovery River ${stamp}`,
    email: `recovery-river-${stamp}@example.test`,
    password: `recovery-river-password-${stamp}`,
  }
  let attempts = 0
  const bodies: unknown[] = []
  const sources: string[] = []
  const keys: string[] = []
  await page.route('**/api/v1/auth/signup', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    attempts += 1
    bodies.push(route.request().postDataJSON())
    sources.push(route.request().headers()['x-account-transition-source'] ?? '')
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      const committed = await request.post('/api/v1/auth/signup', {
        data: route.request().postDataJSON(),
        headers: {
          'x-account-transition-source': sources.at(-1)!,
          'idempotency-key': keys.at(-1)!,
        },
      })
      expect(committed.status()).toBe(200)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Signup acknowledgement lost.' } }),
      })
      return
    }
    await route.continue()
  })

  await page.goto('/')
  await page.getByTestId('account-chip').click()
  await page.getByTestId('auth-signup').click()
  await page.getByTestId('auth-name').fill(who.name)
  await page.getByTestId('auth-email').fill(who.email)
  await page.getByTestId('auth-continue').click()
  await page.getByTestId('auth-password').fill(who.password)
  await page.getByTestId('auth-submit').click()

  const failed = page.locator('[data-account-transition="failed"]')
  await expect(failed).toContainText('Couldn’t confirm whether the account was created', { timeout: ms(20_000) })
  await expect(page.getByTestId('auth-password')).toBeDisabled()
  await expect(page.getByTestId('auth-back')).toBeDisabled()
  await expect(page.getByTestId('auth-open-signin')).toBeDisabled()
  await expect(failed.getByRole('button', { name: 'Dismiss', exact: true })).toHaveCount(0)
  await failed.getByRole('button', { name: 'Retry', exact: true }).click()

  await expect(page.getByTestId('account-chip')).toContainText(who.name, { timeout: ms(20_000) })
  const remembered = await page.request.get('/api/v1/auth/accounts')
  expect(remembered.ok()).toBe(true)
  const rows = await remembered.json() as Array<{ user: { email?: string } }>
  expect(rows.filter((row) => row.user.email === who.email)).toHaveLength(1)
  expect(attempts).toBe(2)
  expect(bodies).toEqual([who, who])
  expect(sources).toEqual(['unsigned', 'unsigned'])
  expect(keys[0]).toBeTruthy()
  expect(keys[1]).toBe(keys[0])
})
