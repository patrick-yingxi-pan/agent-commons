import { test, expect, type Page } from '@playwright/test'
import { ms } from './budget.ts'

const MODULE = '**/src/components/ServedFileIntake.tsx*'

async function openKind(page: Page, kind: 'Files' | 'Photos') {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: new RegExp(`^${kind}`) }).click()
  return picker
}

test('served-file intake loads only after Files or Photos opens and cancel fences late module delivery', async ({ page }) => {
  test.setTimeout(ms(60_000))
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let finish!: () => void
  const routeFinished = new Promise<void>(resolve => { finish = resolve })
  let requests = 0
  await page.route(MODULE, async route => {
    requests += 1
    await held
    try { await route.continue() } finally { finish() }
  })
  try {
    await page.goto('/')
    const composer = page.getByPlaceholder('Reply to Claude…')
    await composer.fill('keep this draft while image intake loads')
    expect(requests, 'the optional read/parse/upload runtime is not in the boot graph').toBe(0)

    let picker = await openKind(page, 'Files')
    await expect(picker.locator('[data-served-file-intake="loading"]')).toContainText('Loading saved-file intake…')
    expect(requests).toBe(1)
    await picker.getByRole('button', { name: 'Cancel intake', exact: true }).click()
    await expect(picker).toHaveCount(0)
    await expect(composer).toHaveValue('keep this draft while image intake loads')
    release()
    await routeFinished
    expect(await page.locator('[data-fs-picker-body]').count(), 'late delivery cannot reopen a cancelled picker').toBe(0)

    picker = await openKind(page, 'Photos')
    await expect(picker.getByText(/^Images up to 8 MB attach as saved PNG copies/)).toBeVisible()
    expect(requests, 'the resolved module is reused for the other picker kind').toBe(1)
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(composer).toHaveValue('keep this draft while image intake loads')
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('a rejected served-file intake chunk stays local and only explicit reload retries admission', async ({ page }) => {
  test.setTimeout(ms(60_000))
  let blocked = true
  await page.route(MODULE, route => blocked ? route.abort() : route.continue())
  await page.goto('/')
  const composer = page.getByPlaceholder('Reply to Claude…')
  await composer.fill('keep this draft if intake is closed')
  const picker = await openKind(page, 'Photos')
  const failure = picker.locator('[data-served-file-intake="error"]')
  await expect(failure.getByRole('alert')).toContainText('Nothing was attached.')
  await expect(failure).toContainText('Copy any unsent text before reloading.')
  await expect(failure.getByRole('button', { name: 'Close picker', exact: true })).toBeVisible()
  await expect(failure.getByRole('button', { name: 'Reload app', exact: true })).toBeVisible()
  await failure.getByRole('button', { name: 'Close picker', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(composer).toHaveValue('keep this draft if intake is closed')

  blocked = false
  await openKind(page, 'Files').then(async reopened => {
    await expect(reopened.locator('[data-served-file-intake="error"]')).toBeVisible()
    await reopened.getByRole('button', { name: 'Done', exact: true }).click()
  })
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const retryPicker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await retryPicker.getByRole('button', { name: /^Files/ }).click()
  await retryPicker.locator('[data-served-file-intake="error"]').getByRole('button', { name: 'Reload app', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add context', exact: true })).toBeVisible()
  const recovered = await openKind(page, 'Files')
  await expect(recovered.getByText(/^Text, documents and images attach as saved copies/)).toBeVisible()
  await expect(recovered.locator('[data-served-file-intake="error"]')).toHaveCount(0)
  await recovered.getByRole('button', { name: 'Done', exact: true }).click()
})
