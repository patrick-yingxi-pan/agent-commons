import { test, expect, type Page } from '@playwright/test'
import { ms } from './budget.ts'
import { startMessagesFixture } from './attachment-endpoint.ts'

const NONCE = `E2E_ATTACHMENT_${Date.now().toString(36)}_9f31`

async function closePreview(page: Page) {
  const preview = page.locator('[data-attachment-preview]')
  if (await page.locator('[data-overlay-dock]').isVisible()) {
    await page.locator('[data-overlay-dock]').getByTitle('Close', { exact: true }).click()
  } else {
    // Wide context panes use the shared rail close action, not PanelShell's X.
    await preview.click({ position: { x: 8, y: 8 } })
    const strip = page.locator('[data-mini-rail]')
    const chrome = await strip.isVisible() ? strip : page.getByRole('complementary')
    await chrome.getByRole('button', { name: 'Close pane', exact: true }).click()
  }
  await expect(preview).toHaveCount(0)
}

test('same-name local files reach the endpoint independently while preview-only content is visibly omitted', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const fixture = await startMessagesFixture()
  try {
    await page.goto('/models')
    const provider = await page.request.post('/api/v1/providers', {
      data: {
        label: `Attachment endpoint ${Date.now().toString(36)}`,
        modelFamily: 'claude',
        effortLevels: ['Default'],
        config: { baseURL: fixture.url, model: 'e2e-attachment-model' },
      },
    })
    expect(provider.ok()).toBeTruthy()
    const providerRow = await provider.json()
    const createdSession = await page.request.post('/api/v1/sessions', { data: { providerId: providerRow.id } })
    expect(createdSession.ok()).toBeTruthy()
    const sessionRow = await createdSession.json()
    await page.goto(`/s/${encodeURIComponent(sessionRow.id)}`)
    await page.getByRole('button', { name: 'Add context' }).click()
    const picker = page.getByRole('dialog', { name: 'Add context' })
    await picker.getByRole('button', { name: /^Files/ }).click()
    await picker.getByRole('button', { name: 'This computer', exact: true }).click()
    const chooserPromise = page.waitForEvent('filechooser')
    await picker.getByRole('button', { name: /Add files from this computer/ }).click()
    const chooser = await chooserPromise
    const sourceText = `# source fixture\nNONCE = ${JSON.stringify(NONCE)}\n`
    const secondSourceText = '# second selected source\nVALUE = "independent-body"\n'
    await chooser.setFiles([
      {
        name: 'e2e-source.py',
        mimeType: 'text/x-python',
        buffer: Buffer.from(sourceText),
      },
      {
        name: 'e2e-source.py',
        mimeType: 'text/x-python',
        buffer: Buffer.from(secondSourceText),
      },
    ])
    const sourceChips = page.getByTitle('Open in sidebar').filter({ hasText: 'e2e-source.py' })
    const fileGroup = page.getByTitle('Files (2)', { exact: true })
    await expect(fileGroup).toBeVisible()
    // Legacy metadata-only photos remain honest after reload. New local image
    // intake rejects corrupt PNG bytes; that path has its own image-input walk.
    const detail = await (await page.request.get(`/api/v1/sessions/${sessionRow.id}`)).json()
    const legacy = await page.request.patch(`/api/v1/sessions/${sessionRow.id}/context-state`, { data: {
      operations: [], workspace: { ...detail.workspace, attachments: [...detail.workspace.attachments,
        { id: 'legacy-photo', label: 'e2e-photo.png', kind: 'photo', source: { id: 'ui-host', kind: 'ui-host', label: 'This computer' }, previewUrl: 'blob:expired-local-photo' },
      ] },
    } })
    expect(legacy.ok()).toBe(true)
    await expect(page.getByTitle('Open in sidebar').filter({ hasText: 'e2e-photo.png' })).toBeVisible()
    await expect(page.locator('[data-attachment-input-disclosure]')).toContainText(/2 text files/i)
    await expect(page.locator('[data-attachment-input-disclosure]')).toContainText(/1 not sent|omitted/i)
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    await fileGroup.click()
    const fileMenu = page.getByRole('menu', { name: 'Files', exact: true })
    const fileRows = fileMenu.getByRole('button', { name: 'e2e-source.py', exact: true })
    await expect(fileRows).toHaveCount(2)
    await fileRows.first().click()
    const preview = page.locator('[data-attachment-preview]')
    await expect(preview).toContainText(sourceText)
    const firstId = await preview.getAttribute('data-attachment-preview')
    await page.getByRole('button', { name: 'e2e-source.py', exact: true }).last().click()
    await expect(preview).toContainText(secondSourceText)
    const secondId = await preview.getAttribute('data-attachment-preview')
    expect(firstId).toBeTruthy()
    expect(secondId).toBeTruthy()
    expect(secondId).not.toBe(firstId)
    await closePreview(page)

    const composer = page.getByPlaceholder('Reply to Claude…')
    await composer.fill('Please summarize the attached note.')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: NONCE })).toBeVisible({ timeout: ms(20_000) })
    expect(fixture.seen.some((text) => text.includes(NONCE))).toBe(true)
    const firstDocument = fixture.documents.find((document) => document.attached_files?.some((file) => file.name === 'e2e-source.py'))
    expect(firstDocument?.attached_files?.filter((file) => file.name === 'e2e-source.py')).toEqual([
      { name: 'e2e-source.py', status: 'ready', text: sourceText },
      { name: 'e2e-source.py', status: 'ready', text: secondSourceText },
    ])
    expect(firstDocument?.attached_files?.find((file) => file.name === 'e2e-photo.png')).toEqual({ name: 'e2e-photo.png', status: 'preview-only' })

    await page.reload()
    await expect(fileGroup).toBeVisible()
    await expect(page.locator('[data-attachment-input-disclosure]')).toContainText(/2 text files/i)
    await expect(page.locator('[data-attachment-input-disclosure]')).toContainText(/1 not sent|omitted/i)
    await fileGroup.click()
    await fileRows.first().click()
    await expect(preview).toHaveAttribute('data-attachment-preview', firstId!)
    await expect(preview).toContainText(sourceText)
    await page.getByRole('button', { name: 'e2e-source.py', exact: true }).last().click()
    await expect(preview).toHaveAttribute('data-attachment-preview', secondId!)
    await expect(preview).toContainText(secondSourceText)
    await closePreview(page)
    // Attaching/reloading can already restore this focused photo. Chip clicks
    // toggle a panel, so only open it when it is not already the active preview.
    if (!(await page.locator('[data-photo-preview-unavailable]').isVisible())) {
      await page.getByTitle('Open in sidebar').filter({ hasText: 'e2e-photo.png' }).click()
    }
    await expect(page.locator('[data-photo-preview-unavailable]')).toBeVisible()
    await closePreview(page)

    const remove = page.getByRole('button', { name: 'Remove e2e-source.py from the conversation' })
    await fileGroup.click()
    await expect(fileRows).toHaveCount(2)
    await fileMenu.getByTitle('Remove from context', { exact: true }).first().click()
    const confirm = page.locator('text=Remove e2e-source.py from the conversation?')
    await expect(confirm).toBeVisible()
    await confirm.locator('..').getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(sourceChips).toHaveCount(1)
    await composer.fill('What attachment text remains?')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'Read supplied attachment: # second selected source' })).toBeVisible({ timeout: ms(20_000) })
    expect(fixture.seen.at(-1) ?? '').not.toContain(NONCE)
    expect(fixture.documents.at(-1)?.attached_files).toEqual([
      { name: 'e2e-source.py', status: 'ready', text: secondSourceText },
      { name: 'e2e-photo.png', status: 'preview-only' },
    ])

    await remove.click()
    await expect(confirm).toBeVisible()
    await confirm.locator('..').getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(sourceChips).toHaveCount(0)
    await composer.fill('What attachment text remains now?')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: 'No supplied attachment text.' })).toBeVisible({ timeout: ms(20_000) })
    expect(fixture.seen.at(-1) ?? '').not.toContain(NONCE)
    expect(fixture.documents.at(-1)?.attached_files).toEqual([{ name: 'e2e-photo.png', status: 'preview-only' }])
    expect(fixture.documents.at(-1)?.attached_files?.some((file) => file.name === 'e2e-source.py')).toBe(false)
  } finally {
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()))
  }
})

test('attachment input limits and truthful previews stay usable across canonical viewports', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  const longName = `${'unbroken-'.repeat(18)}notes.md`
  const files = [
    { name: 'large-a.md', kind: 'file', sizeBytes: 65_536, text: 'a'.repeat(65_536) },
    { name: 'large-b.md', kind: 'file', sizeBytes: 65_536, text: 'b'.repeat(65_536) },
    { name: 'large-c.md', kind: 'file', sizeBytes: 65_536, text: 'c'.repeat(65_536) },
    { name: 'empty.md', kind: 'file', sizeBytes: 0, text: '' },
    { name: 'unavailable.md', kind: 'file', sizeBytes: 12 },
    { name: longName, kind: 'file', sizeBytes: 8, text: 'long-name-content' },
    ...Array.from({ length: 18 }, (_, i) => ({ name: `extra-${i}.md`, kind: 'file', sizeBytes: 1, text: 'x' })),
  ]
  expect(files).toHaveLength(24)
  await test.step('install desktop file fixture', async () => page.addInitScript(({ files: picked }) => {
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: {
        context: {
          pickFiles: async () => ({ status: 'selected', files: picked }),
          pickFolder: async () => ({ status: 'cancelled' }),
        },
      },
    })
  }, { files }))
  const created = await test.step('create session', () => page.request.post('/api/v1/sessions', { data: { firstMessage: `attachment limits ${Date.now().toString(36)}` } }))
  expect(created.ok()).toBeTruthy()
  const session = await created.json()
  await test.step('open session and picker', async () => {
    await page.goto(`/s/${encodeURIComponent(session.id)}`)
    await page.getByRole('button', { name: 'Add context' }).click()
  })
  const picker = page.getByRole('dialog', { name: 'Add context' })
  await test.step('select 24 files', async () => {
    await picker.getByRole('button', { name: /^Files/ }).click()
    await picker.getByRole('button', { name: 'This computer', exact: true }).click()
    await picker.getByRole('button', { name: /Add files from this computer/ }).click()
  })
  const disclosure = page.locator('[data-attachment-input-disclosure]')
  await test.step('assert aggregate disclosure', async () => {
    await expect(disclosure).toContainText(/3 text files?/i)
    await expect(disclosure).toContainText(/21 not sent|omitted/i)
  })
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  // The grouped Files chip opens a menu, not 24 individual composer chips.
  await page.getByTitle('Files (24)', { exact: true }).click()
  await page.getByRole('menu', { name: 'Files', exact: true }).getByRole('button', { name: 'empty.md', exact: true }).click()
  const preview = page.locator('[data-attachment-preview]')
  await expect(preview).toContainText('This text file is empty.')
  await expect(preview).toHaveAttribute('data-attachment-input-status', 'ready')
  await page.getByRole('button', { name: 'unavailable.md', exact: true }).click()
  await expect(preview).toContainText('Preview unavailable for this attachment.')
  await expect(preview).toHaveAttribute('data-attachment-input-status', 'unavailable')
  await page.getByRole('button', { name: longName, exact: true }).click()
  await expect(preview).toContainText(longName)
  await closePreview(page)

  for (const viewport of [
    { width: 320, height: 700 },
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport)
    // Resizing animates the previous rail away. Wait for its real gutter to
    // settle before taking a screenshot; visibility alone ignores clipping.
    const reopen = page.getByRole('button', { name: 'Expand sidebar', exact: true })
    await expect.poll(async () => (await reopen.boundingBox())?.x ?? Infinity).toBeLessThan(52)
    await expect(disclosure).toBeVisible()
    expect(await disclosure.evaluate((el) => el.getBoundingClientRect().height), '24 attachments keep a compact summary').toBeLessThan(90)
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`composer-${viewport.width}.png`) })
    await page.getByTitle('Files (24)', { exact: true }).click()
    await page.getByRole('menu', { name: 'Files', exact: true }).getByRole('button', { name: 'large-c.md', exact: true }).click()
    await expect(preview).toHaveAttribute('data-attachment-input-status', 'total-limit')
    await expect(preview).toContainText('128 KB message limit')
    await expect.poll(async () => preview.evaluate((el) => {
      const box = el.getBoundingClientRect()
      return box.top >= 0 && box.bottom <= innerHeight + 1 && box.right <= innerWidth + 1
    }), { message: 'file lists must leave a visible, viewport-contained preview body' }).toBe(true)
    await expect(preview.locator('p').first()).toBeInViewport({ ratio: 1 })
    // Long metadata and an unbroken whole-file body stay contained at every tier.
    await page.getByRole('button', { name: longName, exact: true }).click()
    await expect(preview).toContainText(longName)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${viewport.width}x${viewport.height} page width`).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`preview-${viewport.width}.png`) })
    await closePreview(page)
  }
})
