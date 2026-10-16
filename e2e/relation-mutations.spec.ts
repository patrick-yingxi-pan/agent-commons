/** Rendered recovery path for server-identified project creation: failure keeps the
 * form and server truth unchanged; Retry reuses the logical key and only the
 * acknowledgement closes/navigates. */
import { test, expect } from '@playwright/test'
import { ms } from './budget.ts'

test('a failed project create stays in place and retries the same logical mutation', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const name = `Acknowledged project ${Date.now().toString(36)}`
  const keys: string[] = []
  let attempts = 0

  await page.route('**/api/v1/projects', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    attempts += 1
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Temporary relation outage' } }),
      })
      return
    }
    await route.continue()
  })

  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Projects', exact: true }).first().click()
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByPlaceholder('e.g. Insights dashboard').fill(name)
  await dialog.getByRole('button', { name: 'Create project' }).click()

  const failed = page.locator('[data-relation-mutation="failed"]')
  await expect(failed).toContainText('Couldn’t confirm the new Project')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByPlaceholder('e.g. Insights dashboard')).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Waiting for recovery…' })).toBeDisabled()
  expect(attempts).toBe(1)
  const before = await (await page.request.get('/api/v1/relations')).json()
  expect(before.extraProjects.some((project: { name: string }) => project.name === name)).toBe(false)

  // A desktop window can cross layout tiers while a request is unresolved. The
  // pane tree must reflow without remounting away the initiating form.
  await page.setViewportSize({ width: 320, height: 700 })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByPlaceholder('e.g. Insights dashboard')).toHaveValue(name)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await failed.getByRole('button', { name: 'Retry' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  expect(attempts).toBe(2)
  expect(keys[0]).not.toBe('')
  expect(keys[1]).toBe(keys[0])
  const after = await (await page.request.get('/api/v1/relations')).json()
  expect(after.extraProjects.filter((project: { name: string }) => project.name === name)).toHaveLength(1)
})

test('a two-device Project prose conflict holds the draft and rebases an explicit Retry', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stamp = Date.now().toString(36)
  const name = `Conflict-safe prose ${stamp}`
  const opening = 'Opening description reviewed in this editor.'
  const remote = 'Newer description from another device.'
  const held = 'My exact held description draft.'

  const createdResponse = await page.request.post('/api/v1/projects', {
    headers: { 'Idempotency-Key': `e2e-project-prose-create-${stamp}` },
    data: { name, description: opening },
  })
  expect(createdResponse.ok()).toBe(true)
  const created = await createdResponse.json() as { project: { id: string } }

  await page.goto(`/projects/${created.project.id}`)
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: ms(20_000) })
  await page.getByRole('button', { name: /^Edit description/ }).click()
  const editor = page.getByLabel('Project description')
  await editor.fill(held)

  // The other device lands after this editor froze `opening` as its reviewed
  // pre-image. Ambient sync may refresh the summary, but it must not rewrite the
  // controlled textarea or silently move the save precondition.
  const remoteResponse = await page.request.post('/api/v1/relations/ops', {
    headers: { 'Idempotency-Key': `e2e-project-prose-remote-${stamp}` },
    data: { op: {
      kind: 'set-project-description',
      projectId: created.project.id,
      projectName: name,
      description: remote,
      expectedDescription: opening,
    } },
  })
  expect(remoteResponse.status()).toBe(200)
  await expect(editor).toHaveValue(held)

  const attempts: Array<{ key: string; op: Record<string, unknown> }> = []
  await page.route('**/api/v1/relations/ops', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { op: Record<string, unknown> }
      if (body.op.projectId === created.project.id && body.op.description === held) {
        attempts.push({
          key: route.request().headers()['idempotency-key'] ?? '',
          op: body.op,
        })
      }
    }
    await route.continue()
  })

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const failed = page.locator('[data-relation-mutation="failed"]')
  await expect(failed).toContainText('This Project changed elsewhere')
  await expect(editor).toBeDisabled()
  await expect(editor).toHaveValue(held)
  expect(attempts).toHaveLength(1)
  expect(attempts[0]!.op.expectedDescription).toBe(opening)

  const about = page.locator('[data-resource-section="About"]')
  await about.locator('button[aria-expanded]').click()
  await expect(about).toContainText(remote, { timeout: ms(20_000) })
  await about.locator('button[aria-expanded]').click()
  await expect(editor).toBeDisabled()
  await expect(editor).toHaveValue(held)

  await failed.getByRole('button', { name: 'Retry' }).click()
  await expect(failed).toHaveCount(0)
  await expect(editor).toHaveCount(0)
  await expect(page.getByText(held, { exact: true })).toBeVisible()
  expect(attempts).toHaveLength(2)
  expect(attempts[0]!.key).not.toBe('')
  expect(attempts[1]!.key).toBe(attempts[0]!.key)
  expect(attempts[1]!.op.description).toBe(held)
  expect(attempts[1]!.op.expectedDescription).toBe(remote)
})
