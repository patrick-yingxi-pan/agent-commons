/** Draft-local history: rendered controls, stable identities and recovery fences. */
import { test, expect, type Locator, type Page } from '@playwright/test'
import type { ArtifactContent, ArtifactItem, StructuredArtifactBody } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { splitPane } from './pane-actions.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]
const formats = ['doc', 'sheet', 'workbook', 'slides'] as const
type Format = typeof formats[number]
const fieldName = (format: Format) => format === 'doc' ? 'Block 1 paragraph' : format === 'slides' ? 'Slide 1 title' : 'Sheet row 1 value 1'
const editName = (format: Format) => format === 'doc' ? 'Edit document' : format === 'slides' ? 'Edit slides' : 'Edit sheet'

async function create(page: Page, format: Format) {
  const name = `draft-history-${format}-${crypto.randomUUID()}`
  const body: string | StructuredArtifactBody = format === 'doc' ? 'First original.\n\nSecond original.\n\nThird original.'
    : format === 'sheet' ? { type: 'sheet', columns: ['Label', 'Value'], rows: [['First original.', '1'], ['Second original.', '2']] }
      : format === 'workbook' ? { type: 'workbook', sheets: [
        { id: 'first', name: 'First', columns: ['Label'], rows: [['First original.']] },
        { id: 'second', name: 'Second', columns: ['Value'], rows: [['Second original.']] },
      ] } : { type: 'slides', slides: [{ title: 'First original.', bullets: ['one', 'two'] }, { title: 'Second original.', bullets: ['three'] }] }
  const response = await page.request.post(`${API}/artifacts`, {
    data: { name, kind: format === 'doc' ? 'doc' : format === 'slides' ? 'slide' : 'sheet', body },
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return (await response.json() as { artifact: ArtifactItem }).artifact
}

async function current(page: Page, id: string): Promise<ArtifactContent> {
  const response = await page.request.get(`${API}/artifact-content`)
  expect(response.ok(), await response.text()).toBeTruthy()
  const content = (await response.json() as Record<string, ArtifactContent>)[id]
  expect(content).toBeTruthy()
  return content!
}

async function open(page: Page, artifact: ArtifactItem, format: Format) {
  await page.goto(`/artifacts/${artifact.id}`)
  const detail = page.locator(`[data-artifact-page="${artifact.id}"]`)
  await expect(detail).toBeVisible({ timeout: ms(20_000) })
  await detail.getByRole('button', { name: editName(format), exact: true }).click()
  const editor = detail.locator('[data-artifact-draft-history]')
  await expect(editor).toBeVisible()
  return editor
}

const action = (editor: Locator, name: 'Undo' | 'Redo') => editor.getByRole('button', { name, exact: true })
const ids = (editor: Locator) => editor.locator('[data-doc-block-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-doc-block-id')))

test('Document history groups typing and restores exact inserted, deleted and reordered block identities without writing', async ({ browser }) => {
  const owner = await newUser(browser)
  try {
    const { page } = owner
    const artifact = await create(page, 'doc')
    const original = await current(page, artifact.id)
    expect(original.type).toBe('doc')
    if (original.type !== 'doc') throw new Error('expected Document')
    const editor = await open(page, artifact, 'doc')
    let writes = 0
    page.on('request', request => { if (request.method() === 'PATCH' && request.url().endsWith(`/artifacts/${artifact.id}/content`)) writes++ })
    await expect(action(editor, 'Undo')).toBeDisabled()
    const field = editor.getByRole('textbox', { name: 'Block 1 paragraph', exact: true })
    await field.fill('Edited')
    await field.pressSequentially(' together')
    await field.press('Control+z')
    await expect(field).toHaveValue('First original.')
    await field.press('Control+Shift+z')
    await expect(field).toHaveValue('Edited together')
    // Focus never left the field. New typing after traversal is still one step.
    await field.press('End')
    await field.pressSequentially(' again')
    await field.press('Control+z')
    await expect(field).toHaveValue('Edited together')
    await field.press('Control+y')
    await expect(field).toHaveValue('Edited together again')
    await action(editor, 'Undo').click()
    await action(editor, 'Undo').click()
    await expect(field).toHaveValue('First original.')
    await editor.getByRole('button', { name: 'Delete block 2', exact: true }).click()
    await expect(editor.locator('[data-doc-block-id]')).toHaveCount(2)
    await expect(editor).toBeFocused()
    await page.keyboard.press('Control+z')
    expect(await ids(editor)).toEqual(original.blocks.map(block => block.id))
    await editor.getByRole('button', { name: 'Move block 2 up', exact: true }).click()
    expect(await ids(editor)).toEqual([original.blocks[1]!.id, original.blocks[0]!.id, original.blocks[2]!.id])
    await action(editor, 'Undo').click()
    expect(await ids(editor)).toEqual(original.blocks.map(block => block.id))
    await editor.getByRole('combobox', { name: 'Insert position', exact: true }).selectOption('3')
    await editor.getByRole('button', { name: 'Add paragraph', exact: true }).click()
    const inserted = (await ids(editor))[3]!
    expect(inserted).toBeTruthy()
    await action(editor, 'Undo').click()
    await expect(editor.locator('[data-doc-block-id]')).toHaveCount(3)
    await action(editor, 'Redo').click()
    expect((await ids(editor))[3]).toBe(inserted)
    await editor.getByRole('textbox', { name: 'Block 4 paragraph', exact: true }).fill('Kept insertion.')
    expect(writes).toBe(0)
    expect(await current(page, artifact.id)).toEqual(original)
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(editor).toHaveCount(0)
    expect(writes).toBe(1)
    expect(await current(page, artifact.id)).toEqual({ ...original, revision: (original.revision ?? 0) + 1,
      blocks: [...original.blocks, { id: inserted, p: 'Kept insertion.' }] })
    await page.getByRole('button', { name: 'Edit document', exact: true }).click()
    await expect(action(editor, 'Undo')).toBeDisabled()
    await expect(action(editor, 'Redo')).toBeDisabled()
  } finally { await owner.context.close() }
})

test('all four full editors expose accessible draft history at every viewport and reverse structural deletion', async ({ browser }, testInfo) => {
  test.setTimeout(ms(180_000))
  const owner = await newUser(browser)
  try {
    const { page } = owner
    for (const format of formats) {
      const artifact = await create(page, format)
      const original = await current(page, artifact.id)
      const editor = await open(page, artifact, format)
      const field = editor.getByRole('textbox', { name: fieldName(format), exact: true })
      await field.fill('Viewport draft.')
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport)
        await settleArtifactPageRail(page)
        await action(editor, 'Undo').click()
        await expect(field).toHaveValue('First original.')
        await action(editor, 'Redo').click()
        await expect(field).toHaveValue('Viewport draft.')
        await action(editor, 'Undo').scrollIntoViewIfNeeded()
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        await assertWcag22Aa(page, `draft history ${format} ${viewport.width}x${viewport.height}`)
        await page.screenshot({ path: testInfo.outputPath(`${format}-history-${viewport.width}x${viewport.height}.png`) })
      }
      await action(editor, 'Undo').click()
      const remove = format === 'doc' ? 'Delete block 1' : format === 'slides' ? 'Remove slide 1' : format === 'sheet' ? 'Remove sheet row 1' : 'Remove worksheet'
      await editor.getByRole('button', { name: remove, exact: true }).click()
      await expect(field).toHaveValue('Second original.')
      await action(editor, 'Undo').click()
      // Worksheet selection is a view preference, not draft content history.
      if (format === 'workbook') await editor.getByRole('tab', { name: 'First', exact: true }).click()
      await expect(field).toHaveValue('First original.')
      await action(editor, 'Redo').click()
      await expect(field).toHaveValue('Second original.')
      await action(editor, 'Undo').click()
      if (format === 'workbook') await editor.getByRole('tab', { name: 'First', exact: true }).click()
      await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
      await expect(editor).toHaveCount(0)
      expect(await current(page, artifact.id)).toEqual({ ...original, revision: (original.revision ?? 0) + 1 })
    }
  } finally { await owner.context.close() }
})

test('native text paste is its own step and later typing branches from shared history across panes and navigation', async ({ browser }) => {
  const owner = await newUser(browser)
  await owner.context.grantPermissions(['clipboard-read', 'clipboard-write'])
  try {
    const { page } = owner
    const artifact = await create(page, 'doc')
    await open(page, artifact, 'doc')
    await splitPane(page, 'right')
    const panes = page.locator('[data-main-pane]')
    await expect(panes).toHaveCount(2)
    const first = panes.nth(0).locator('[data-artifact-draft-history]')
    const second = panes.nth(1).locator('[data-artifact-draft-history]')
    const field = first.getByRole('textbox', { name: 'Block 1 paragraph', exact: true })
    await field.fill('Before paste')
    await field.press('ControlOrMeta+A')
    await page.evaluate(() => navigator.clipboard.writeText('Pasted text'))
    await field.press('ControlOrMeta+V')
    await expect(field).toHaveValue('Pasted text')
    await field.pressSequentially(' plus')
    await action(second, 'Undo').click()
    await expect(field).toHaveValue('Pasted text')
    await action(first, 'Undo').click()
    await expect(field).toHaveValue('Before paste')
    await action(second, 'Redo').click()
    await expect(field).toHaveValue('Pasted text')
    await second.getByRole('textbox', { name: 'Block 1 paragraph', exact: true }).fill('New branch')
    await expect(action(first, 'Redo')).toBeDisabled()
    await expect(action(second, 'Redo')).toBeDisabled()
    // Close the focused second pane, then navigate away without a reload.
    await page.locator('[data-close-view]').click()
    await expect(panes).toHaveCount(1)
    await page.getByRole('button', { name: 'Artifacts', exact: true }).first().click()
    const row = page.locator('[data-artifact-preview-row]').filter({ has: page.getByRole('button', { name: artifact.name, exact: true }) })
    await row.getByRole('button', { name: artifact.name, exact: true }).click()
    const returned = page.locator('[data-artifact-draft-history]')
    await expect(returned.getByRole('textbox', { name: 'Block 1 paragraph', exact: true })).toHaveValue('New branch')
    await action(returned, 'Undo').click()
    await expect(returned.getByRole('textbox', { name: 'Block 1 paragraph', exact: true })).toHaveValue('Pasted text')
    await returned.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Edit document', exact: true }).click()
    await expect(action(returned, 'Undo')).toBeDisabled()
    await expect(action(returned, 'Redo')).toBeDisabled()
  } finally { await owner.context.close() }
})

test('held uncertain and conflicting saves freeze history until Dismiss without replaying or losing the draft', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  try {
    const { page } = owner
    const artifact = await create(page, 'doc')
    const original = await current(page, artifact.id)
    const editor = await open(page, artifact, 'doc')
    const field = editor.getByRole('textbox', { name: 'Block 1 paragraph', exact: true })
    let writes = 0
    let conflict = false
    await page.route(`**${API}/artifacts/${artifact.id}/content`, async route => {
      if (route.request().method() !== 'PATCH') return route.continue()
      writes++
      if (conflict) return route.continue()
      await route.abort('failed')
    })
    await field.fill('Held private draft')
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
    const notice = page.locator('[data-revisioned-mutation="structured-artifact"]')
    await expect(notice).toContainText('Couldn’t confirm the artifact edit')
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settleArtifactPageRail(page)
      await expect(action(editor, 'Undo')).toBeDisabled()
      await expect(action(editor, 'Redo')).toBeDisabled()
      await editor.focus()
      await page.keyboard.press('Control+z')
      await expect(field).toHaveValue('Held private draft')
      await action(editor, 'Undo').scrollIntoViewIfNeeded()
      await assertWcag22Aa(page, `held draft history ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: testInfo.outputPath(`held-history-${viewport.width}x${viewport.height}.png`) })
    }
    await notice.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(field).toBeEnabled()
    await action(editor, 'Undo').click()
    await expect(field).toHaveValue('First original.')
    await action(editor, 'Redo').click()
    await expect(field).toHaveValue('Held private draft')
    expect(writes).toBe(1)
    expect(await current(page, artifact.id)).toEqual(original)
    // A second device advances the exact revision. Undo must not rebase it.
    const remote = await page.request.patch(`${API}/artifacts/${artifact.id}/content`, {
      data: { blockId: original.type === 'doc' ? original.blocks[0]!.id : '', text: 'Remote saved edit', expectedRevision: original.revision ?? 0 },
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    })
    expect(remote.ok(), await remote.text()).toBeTruthy()
    conflict = true
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(notice).toContainText(/changed|conflict/i)
    await expect(action(editor, 'Undo')).toBeDisabled()
    await expect(action(editor, 'Redo')).toBeDisabled()
    await notice.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await action(editor, 'Undo').click()
    await expect(field).toHaveValue('First original.')
    expect(writes).toBe(2)
    const saved = await current(page, artifact.id)
    expect(saved).toMatchObject({ revision: (original.revision ?? 0) + 1, blocks: [{ p: 'Remote saved edit' }, {}, {}] })
  } finally { await owner.context.close() }
})
