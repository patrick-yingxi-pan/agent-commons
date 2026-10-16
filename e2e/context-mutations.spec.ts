/** Rendered recovery path for the authorization-affecting context transaction:
 * failed delivery leaves the prior UI/server truth intact, Retry replays the
 * queued intent, and the binding + panel arrive together. */
import { test, expect } from '@playwright/test'
import { startMessagesFixture } from './attachment-endpoint.ts'
import { ms } from './budget.ts'

test('a failed context update stays unchanged and retries in place', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const created = await page.request.post('/api/v1/sessions', {
    data: { firstMessage: `context recovery ${Date.now().toString(36)}` },
  })
  expect(created.ok()).toBe(true)
  const session = await created.json()

  let attempts = 0
  await page.route('**/api/v1/sessions/*/context-state', async (route) => {
    attempts += 1
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Temporary context outage' } }),
      })
      return
    }
    await route.continue()
  })

  await page.goto(`/s/${session.id}`)
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add context' }).click()
  const picker = page.getByRole('dialog', { name: 'Add context' })
  await picker.getByRole('button', { name: /^Connector/ }).click()
  await picker.getByRole('button', { name: /Google Drive/ }).click()
  await page.keyboard.press('Escape')

  const failed = page.getByRole('alert').filter({ hasText: 'Couldn’t confirm the context update' })
  await expect(failed).toContainText('Temporary context outage')
  await expect(failed.getByRole('button', { name: 'Retry' })).toBeVisible()
  expect(attempts).toBe(1)
  const before = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
  expect(before.workspace.connectors).toEqual([])
  expect(await (await page.request.get(`/api/v1/sessions/${session.id}/contexts`)).json()).toEqual([])

  await failed.getByRole('button', { name: 'Retry' }).click()
  await expect(failed).toHaveCount(0)
  await expect(page.getByText('Google Drive').first()).toBeVisible()
  expect(attempts).toBe(2)
  const after = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
  expect(after.workspace.connectors.map((connector: { id: string }) => connector.id)).toContain('gdrive')
  expect(
    (await (await page.request.get(`/api/v1/sessions/${session.id}/contexts`)).json())
      .map((context: { id: string }) => context.id),
  ).toContain('gdrive')
})

test('composer holds typed text through failed and delayed attachment detachment', async ({ page }) => {
  test.setTimeout(ms(45_000))
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-context-hold-${Date.now().toString(36)}` })
  const fixture = await startMessagesFixture()
  let attempts = 0
  let releaseDetach: (() => void) | undefined
  const delayedDetach = new Promise<void>((resolve) => { releaseDetach = resolve })
  const messages: string[] = []
  try {
    const provider = await page.request.post('/api/v1/providers', { data: {
      label: `Context hold ${Date.now().toString(36)}`, modelFamily: 'claude', effortLevels: ['Default'],
      config: { baseURL: fixture.url, model: 'e2e-attachment-model' },
    } })
    expect(provider.ok()).toBe(true)
    const sessionResponse = await page.request.post('/api/v1/sessions', { data: { providerId: (await provider.json()).id } })
    expect(sessionResponse.ok()).toBe(true)
    const session = await sessionResponse.json() as { id: string }
    const detail = await (await page.request.get(`/api/v1/sessions/${session.id}`)).json()
    const attachment = {
      id: `context-hold-${Date.now().toString(36)}`,
      label: 'held-note.txt',
      kind: 'file',
      source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' },
      previewText: 'DETACH_CONTEXT_MARKER',
    }
    const attached = await page.request.patch(`/api/v1/sessions/${session.id}/context-state`, { data: {
      operations: [], workspace: { ...detail.workspace, attachments: [attachment] },
    } })
    expect(attached.ok()).toBe(true)

    await page.route('**/api/v1/sessions/*/context-state', async (route) => {
      attempts += 1
      if (attempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'internal', message: 'Temporary detach outage' } }),
        })
        return
      }
      if (attempts === 2) {
        await delayedDetach
      }
      await route.continue()
    })
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/sessions/') && request.url().endsWith('/messages')) messages.push(request.url())
    })

    await page.goto(`/s/${session.id}`)
    const chip = page.getByTitle('Open in sidebar').filter({ hasText: 'held-note.txt' })
    await expect(chip).toBeVisible()
    await chip.click()
    await expect(page.locator('[data-attachment-preview]')).toContainText('DETACH_CONTEXT_MARKER')
    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await composer.fill('typed draft survives context hold')
    await page.getByTitle('Remove file', { exact: true }).click()

    const failed = page.getByRole('alert').filter({ hasText: 'Couldn’t confirm the context update' }).first()
    await expect(failed).toContainText('Temporary detach outage')
    await expect(composer).toBeDisabled()
    await expect(composer).toHaveValue('typed draft survives context hold')
    expect(messages).toHaveLength(0)

    await failed.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Updating context…' }).first()).toBeVisible()
    await expect(composer).toBeDisabled()
    await expect(composer).toHaveValue('typed draft survives context hold')
    expect(messages).toHaveLength(0)
    releaseDetach?.()
    await expect(page.locator('[data-attachment-preview]')).toHaveCount(0)
    await expect(composer).toBeEnabled()
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'No supplied attachment text.' })).toBeVisible({ timeout: ms(20_000) })
    expect(messages).toHaveLength(1)
    expect(fixture.seen.at(-1)).not.toContain('DETACH_CONTEXT_MARKER')
    expect(fixture.documents.at(-1)?.attached_files).toBeUndefined()
  } finally {
    releaseDetach?.()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    fixture.server.closeAllConnections()
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()))
  }
})
