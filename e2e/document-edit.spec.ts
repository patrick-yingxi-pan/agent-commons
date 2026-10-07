/** Rendered stable-identity Document editing and discussion-anchor recovery. */
import { test, expect, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { ArtifactContent, ArtifactItem, Discussion } from '../contract/index.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
]
const GRACE_HEADERS = { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' }
const MAYA_HEADERS = { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' }

async function createDocument(page: Page, name: string, text: string): Promise<ArtifactItem> {
  const response = await page.request.post(`${API}/artifacts`, {
    data: { name, kind: 'doc', body: text },
    headers: { 'Idempotency-Key': `document-editor-${crypto.randomUUID()}` },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const created = await response.json() as { artifact: ArtifactItem }
  expect(created.artifact.name).toBe(name)
  return created.artifact
}

async function currentBody(page: Page, id: string): Promise<Extract<ArtifactContent, { type: 'doc' }>> {
  const response = await page.request.get(`${API}/artifact-content`)
  expect(response.ok(), await response.text()).toBeTruthy()
  const library = await response.json() as Record<string, ArtifactContent>
  const body = library[id]
  expect(body?.type, `the exact Artifact ${id} has a current Document body`).toBe('doc')
  if (!body || body.type !== 'doc') throw new Error('expected an exact authored Document body')
  return body
}

async function createBlockDiscussion(page: Page, artifactId: string, blockId: string, post: string): Promise<Discussion> {
  const response = await page.request.post(`${API}/discussions`, {
    data: {
      anchor: { ref: { kind: 'artifact', id: artifactId }, locus: { kind: 'artifact-block', blockId } },
      firstPost: post,
    },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return await response.json() as Discussion
}

function artifactPage(page: Page, artifactId: string): Locator {
  return page.locator(`[data-artifact-page="${artifactId}"]`)
}

async function expectArtifactRoute(page: Page, artifactId: string) {
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/artifacts/${encodeURIComponent(artifactId)}`)
}

async function captureViewportMatrix(page: Page, testInfo: TestInfo, label: string, surface: Locator) {
  const original = page.viewportSize() ?? { width: 1280, height: 800 }
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(surface).toBeVisible()
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ), `${label} has no page-level horizontal overflow at ${viewport.width}x${viewport.height}`).toBe(true)
    await assertWcag22Aa(page, `${label} ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.width}x${viewport.height}.png`), fullPage: true })
  }
  await page.setViewportSize(original)
  await settleArtifactPageRail(page)
}

async function gotoThread(page: Page, discussion: Discussion) {
  await page.goto(`/discussions/${encodeURIComponent(discussion.id)}`)
  await expect(page.getByRole('heading', { name: discussion.posts[0]!.body, exact: true })).toBeVisible({ timeout: ms(20_000) })
  const chip = page.locator('button[data-artifact-anchor-state]')
  await expect(chip).toBeVisible({ timeout: ms(20_000) })
  return chip
}

test('the owner inserts every block kind, reorders and deletes by stable identity, and discussion doors follow the original block', async ({ page }, testInfo) => {
  test.setTimeout(ms(150_000))
  const stamp = Date.now().toString(36)
  const artifact = await createDocument(page, `structured-edit-${stamp}.md`, 'Retired original block.\n\nDiscussion target block.\n\nUnchanged neighbor block.')
  const original = await currentBody(page, artifact.id)
  const retiredId = original.blocks[0]!.id!
  const targetId = original.blocks[1]!.id!
  const neighborId = original.blocks[2]!.id!
  const targetDiscussion = await createBlockDiscussion(page, artifact.id, targetId, `Talk about the movable block ${stamp}`)
  const deletedDiscussion = await createBlockDiscussion(page, artifact.id, retiredId, `Talk about the deleted block ${stamp}`)

  await page.goto(`/artifacts/${encodeURIComponent(artifact.id)}`)
  const detail = artifactPage(page, artifact.id)
  await expect(detail).toBeVisible({ timeout: ms(20_000) })
  await detail.getByRole('button', { name: 'Edit document', exact: true }).click()
  const editor = detail.locator('[data-document-artifact-editor]')
  await expect(editor).toBeVisible()

  // Insert all five authored variants through the visible editor, exercising the
  // actual identity-preserving body draft rather than constructing a test-only UI state.
  await editor.getByRole('button', { name: 'Add heading', exact: true }).click()
  await editor.getByRole('textbox', { name: 'Block 4 heading', exact: true }).fill('Inserted stable heading')
  await editor.getByRole('button', { name: 'Add paragraph', exact: true }).click()
  await editor.getByRole('textbox', { name: 'Block 5 paragraph', exact: true }).fill('Inserted stable paragraph')
  await editor.getByRole('button', { name: 'Add bullet list', exact: true }).click()
  const firstBullet = editor.getByRole('textbox', { name: 'Block 6 bullet 1', exact: true })
  await firstBullet.fill('First retained bullet\nembedded line stays in this item')
  await editor.getByRole('button', { name: 'Add bullet to block 6', exact: true }).click()
  await editor.getByRole('textbox', { name: 'Block 6 bullet 2', exact: true }).fill('Second retained bullet')
  await expect(firstBullet).toHaveValue('First retained bullet\nembedded line stays in this item',
    'editing another list item preserves the first item’s embedded newline')
  await editor.getByRole('button', { name: 'Add code block', exact: true }).click()
  const firstCodeLine = editor.getByRole('textbox', { name: 'Block 7 code line 1', exact: true })
  await firstCodeLine.fill('const reviewed = true\n  // embedded line stays in this item')
  await editor.getByRole('button', { name: 'Add code line to block 7', exact: true }).click()
  await editor.getByRole('textbox', { name: 'Block 7 code line 2', exact: true }).fill('return reviewed && safe')
  await expect(firstCodeLine).toHaveValue('const reviewed = true\n  // embedded line stays in this item',
    'editing another code item preserves the first item’s embedded newline')
  await editor.getByRole('button', { name: 'Add email header', exact: true }).click()
  await editor.getByRole('textbox', { name: 'Block 8 email recipient', exact: true }).fill('review@example.test')
  await editor.getByRole('textbox', { name: 'Block 8 email subject', exact: true }).fill('Stable identity review')

  const targetEditor = editor.locator(`[data-doc-block-id="${targetId}"]`)
  await expect(targetEditor).toBeVisible()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const currentIndex = await targetEditor.evaluate((node) => [...node.parentElement!.querySelectorAll(':scope > [data-doc-block-id]')].indexOf(node))
    if (currentIndex === 0) break
    await targetEditor.getByRole('button', { name: /^Move block \d+ up$/ }).click()
  }
  const retiredEditor = editor.locator(`[data-doc-block-id="${retiredId}"]`)
  const retiredIndex = await retiredEditor.evaluate((node) => [...node.parentElement!.querySelectorAll(':scope > [data-doc-block-id]')].indexOf(node))
  await editor.getByRole('button', { name: `Delete block ${retiredIndex + 1}`, exact: true }).click()
  await expect(editor.locator(`[data-doc-block-id="${retiredId}"]`)).toHaveCount(0)
  await expect(editor.locator(`[data-doc-block-id="${targetId}"]`)).toBeVisible()

  await captureViewportMatrix(page, testInfo, 'document-editor-owner', editor)
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(editor).toHaveCount(0, { timeout: ms(20_000) })

  const saved = await currentBody(page, artifact.id)
  expect(saved.revision).toBe((original.revision ?? 0) + 1)
  expect(saved.blocks.map((block) => block.id)).toContain(targetId)
  expect(saved.blocks.map((block) => block.id)).not.toContain(retiredId)
  expect(saved.blocks.map((block) => block.id)).toContain(neighborId)
  expect(saved.blocks[0]?.id, 'the chosen discussion target moved to a new ordinal').toBe(targetId)
  expect(saved.blocks.some((block) => 'h' in block && block.h === 'Inserted stable heading')).toBe(true)
  expect(saved.blocks.some((block) => 'p' in block && block.p === 'Inserted stable paragraph')).toBe(true)
  expect(saved.blocks.some((block) => 'ul' in block && block.ul.join('|') === 'First retained bullet\nembedded line stays in this item|Second retained bullet')).toBe(true)
  expect(saved.blocks.some((block) => 'code' in block && block.code.join('|') === 'const reviewed = true\n  // embedded line stays in this item|return reviewed && safe')).toBe(true)
  expect(saved.blocks.some((block) => 'email' in block && block.email.to === 'review@example.test' && block.email.subject === 'Stable identity review')).toBe(true)

  const attachedChip = await gotoThread(page, targetDiscussion)
  await expect(attachedChip).toHaveAttribute('data-artifact-anchor-state', 'attached')
  await expect(attachedChip).toContainText('one block')
  await attachedChip.click()
  await expectArtifactRoute(page, artifact.id)
  const landedBlock = page.locator(`[data-doc-block-id="${targetId}"]`).first()
  await expect(landedBlock).toBeInViewport({ timeout: ms(10_000) })
  await expect(landedBlock).toHaveClass(/ring-co\/40/)
  await expect(page.locator(`[data-doc-block-id="${neighborId}"]`).first()).not.toHaveClass(/ring-co\/40/)

  const deletedChip = await gotoThread(page, deletedDiscussion)
  await expect(deletedChip).toHaveAttribute('data-artifact-anchor-state', 'deleted')
  await expect(deletedChip).toContainText('original block deleted')
  await deletedChip.click()
  await expectArtifactRoute(page, artifact.id)
  await expect(page.locator(`[data-doc-block-id="${retiredId}"]`)).toHaveCount(0)
})

test('an anchored discussion holds its exact focus through a retained full-document draft until Cancel', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = Date.now().toString(36)
  const savedText = `Saved opening ${stamp}.\n\nSaved discussion target ${stamp}.\n\nSaved closing ${stamp}.`
  const artifact = await createDocument(page, `held-anchor-draft-${stamp}.md`, savedText)
  const original = await currentBody(page, artifact.id)
  const target = original.blocks[1]!
  const neighbor = original.blocks[2]!
  const targetId = target.id!
  const neighborId = neighbor.id!
  const discussion = await createBlockDiscussion(page, artifact.id, targetId, `Held draft discussion ${stamp}`)

  await page.goto(`/artifacts/${encodeURIComponent(artifact.id)}`)
  const detail = artifactPage(page, artifact.id)
  await expect(detail).toBeVisible({ timeout: ms(20_000) })
  await detail.getByRole('button', { name: 'Edit document', exact: true }).click()
  const editor = detail.locator('[data-document-artifact-editor]')
  await expect(editor).toBeVisible()
  await editor.getByRole('textbox', { name: 'Block 2 paragraph', exact: true }).fill(`Draft-only replacement ${stamp}.`)

  // Keep the editor mounted in the shared draft store while using the actual
  // SPA section and discussion doors; a page.goto would discard the condition
  // this regression is intended to protect.
  const sections = page.locator('nav[aria-label="Sections"]')
  await sections.getByRole('button', { name: 'Discussions', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Discussions', exact: true })).toBeVisible({ timeout: ms(20_000) })
  await page.locator('#main-workspace').getByRole('button', { name: new RegExp(`Held draft discussion ${stamp}`) }).click()
  await expect(page.getByRole('heading', { name: `Held draft discussion ${stamp}`, exact: true })).toBeVisible({ timeout: ms(20_000) })
  const chip = page.locator('button[data-artifact-anchor-state="attached"]')
  await expect(chip).toBeVisible()
  await chip.click()
  await expectArtifactRoute(page, artifact.id)

  const returnedDetail = artifactPage(page, artifact.id)
  const heldNotice = returnedDetail.locator('[data-document-anchor-held]')
  await expect(heldNotice).toHaveText('Save or cancel your draft to reveal the original discussion block in the saved document.')
  const returnedEditor = returnedDetail.locator('[data-document-artifact-editor]')
  await expect(returnedEditor).toBeVisible()
  await expect(returnedEditor.getByRole('textbox', { name: 'Block 2 paragraph', exact: true })).toHaveValue(`Draft-only replacement ${stamp}.`)

  await returnedEditor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(returnedDetail.locator('[data-document-artifact-editor]')).toHaveCount(0)
  await expect(heldNotice).toHaveCount(0)
  const landedTarget = page.locator(`[data-doc-block-id="${targetId}"]`).first()
  await expect(landedTarget).toBeInViewport({ timeout: ms(10_000) })
  await expect(landedTarget).toHaveClass(/ring-co\/40/)
  await expect(page.locator(`[data-doc-block-id="${neighborId}"]`).first()).not.toHaveClass(/ring-co\/40/)
  await expect(returnedDetail.getByText(`Saved discussion target ${stamp}.`, { exact: true })).toBeVisible()
  await expect(returnedDetail.getByText(`Draft-only replacement ${stamp}.`, { exact: true })).toHaveCount(0)
  const afterCancel = await currentBody(page, artifact.id)
  expect(afterCancel.revision).toBe(original.revision)
  expect(afterCancel.blocks.map((block) => block.id)).toEqual(original.blocks.map((block) => block.id))
})

test('an anchor arrival reveals previously folded Content until the user explicitly folds it again', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const stamp = Date.now().toString(36)
  const artifact = await createDocument(page, `folded-anchor-${stamp}.md`, `Folded intro ${stamp}.\n\nFolded anchor target ${stamp}.`)
  const body = await currentBody(page, artifact.id)
  const targetId = body.blocks[1]!.id!
  const discussion = await createBlockDiscussion(page, artifact.id, targetId, `Folded content anchor ${stamp}`)

  await page.goto(`/artifacts/${encodeURIComponent(artifact.id)}`)
  const detail = artifactPage(page, artifact.id)
  await expect(detail).toBeVisible({ timeout: ms(20_000) })
  const content = detail.locator('[data-resource-section="Content"]')
  const contentToggle = content.getByRole('button').first()
  if (await contentToggle.getAttribute('aria-expanded') === 'true') await contentToggle.click()
  await expect(contentToggle).toHaveAttribute('aria-expanded', 'false')

  const sections = page.locator('nav[aria-label="Sections"]')
  await sections.getByRole('button', { name: 'Discussions', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Discussions', exact: true })).toBeVisible({ timeout: ms(20_000) })
  await page.locator('#main-workspace').getByRole('button', { name: new RegExp(`Folded content anchor ${stamp}`) }).click()
  const chip = page.locator('button[data-artifact-anchor-state="attached"]')
  await expect(chip).toBeVisible()
  await chip.click()
  await expectArtifactRoute(page, artifact.id)

  const returnedContent = artifactPage(page, artifact.id).locator('[data-resource-section="Content"]')
  const returnedToggle = returnedContent.getByRole('button').first()
  await expect(returnedToggle, 'anchor arrival leaves Content revealed after the one-shot focus is consumed').toHaveAttribute('aria-expanded', 'true')
  const landedBlock = page.locator(`[data-doc-block-id="${targetId}"]`).first()
  await expect(landedBlock).toBeInViewport({ timeout: ms(10_000) })
  await expect(landedBlock).toHaveClass(/ring-co\/40/)

  await returnedToggle.click()
  await expect(returnedToggle, 'the user can explicitly dismiss the navigation reveal').toHaveAttribute('aria-expanded', 'false')
  await page.reload()
  const reloadedContent = artifactPage(page, artifact.id).locator('[data-resource-section="Content"]')
  await expect(reloadedContent.getByRole('button').first()).toHaveAttribute('aria-expanded', 'false')
})

test('shared readers can follow an identified block; foreign readers see neither body nor discussion; legacy numeric loci stay unavailable', async ({ browser }: { browser: Browser }, testInfo) => {
  test.setTimeout(ms(150_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, GRACE_HEADERS)
  const foreign = await newUser(browser, MAYA_HEADERS)
  try {
    const stamp = Date.now().toString(36)
    const artifact = await createDocument(owner.page, `shared-document-${stamp}.md`, `Public paragraph ${stamp}.\n\nShared discussion target ${stamp}.`)
    const body = await currentBody(owner.page, artifact.id)
    const target = body.blocks[1]!
    const blockId = target.id!
    const discussion = await createBlockDiscussion(owner.page, artifact.id, blockId, `Shared block thread ${stamp}`)
    const grantResponse = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(grantResponse.ok(), await grantResponse.text()).toBeTruthy()

    await reader.page.goto(`/artifacts/${encodeURIComponent(artifact.id)}`)
    const readerDetail = artifactPage(reader.page, artifact.id)
    await expect(readerDetail).toBeVisible({ timeout: ms(20_000) })
    await expect(readerDetail.getByText(`Shared discussion target ${stamp}.`, { exact: true })).toBeVisible()
    await expect(readerDetail.getByRole('button', { name: 'Edit document', exact: true })).toHaveCount(0)
    await expect(readerDetail.getByRole('button', { name: /^Edit block / })).toHaveCount(0)
    await captureViewportMatrix(reader.page, testInfo, 'document-reader-shared', readerDetail)

    const readerChip = await gotoThread(reader.page, discussion)
    await expect(readerChip).toHaveAttribute('data-artifact-anchor-state', 'attached')
    await readerChip.click()
    await expect(reader.page.locator(`[data-doc-block-id="${blockId}"]`).first()).toBeInViewport({ timeout: ms(10_000) })

    await foreign.page.goto(`/artifacts/${encodeURIComponent(artifact.id)}`)
    const hidden = foreign.page.getByText('This artifact isn’t visible from this account (or no longer exists).', { exact: true })
    await expect(hidden).toBeVisible({ timeout: ms(20_000) })
    await expect(artifactPage(foreign.page, artifact.id)).toHaveCount(0)
    const foreignLibraryResponse = await foreign.page.request.get(`${API}/artifact-content`)
    expect(foreignLibraryResponse.ok()).toBeTruthy()
    const foreignLibrary = await foreignLibraryResponse.json() as Record<string, ArtifactContent>
    expect(Object.hasOwn(foreignLibrary, artifact.id), 'foreign body response excludes the exact owner Artifact id').toBe(false)
    await captureViewportMatrix(foreign.page, testInfo, 'document-reader-foreign-empty', hidden)
    const foreignDiscussionResponse = await foreign.page.request.get(`${API}/discussions/${encodeURIComponent(discussion.id)}`)
    expect(foreignDiscussionResponse.status(), 'the unshared foreign viewer cannot read the discussion').toBe(404)
    await foreign.page.goto(`/discussions/${encodeURIComponent(discussion.id)}`)
    await expect(foreign.page.getByText('This discussion isn’t visible from this account (or no longer exists).', { exact: true })).toBeVisible({ timeout: ms(20_000) })

    // A pre-v6 discussion may still carry an ordinal. Simulate that exact legacy
    // wire shape for one real thread and prove the UI names it unavailable even
    // though its old numeric position currently contains a block.
    await owner.page.route(`**${API}/discussions/${encodeURIComponent(discussion.id)}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const value = await response.json() as Discussion
      value.anchor = { ...value.anchor, locus: { kind: 'artifact-block', block: 1 } }
      await route.fulfill({ response, json: value })
    })
    const legacyChip = await gotoThread(owner.page, discussion)
    await expect(legacyChip).toHaveAttribute('data-artifact-anchor-state', 'legacy')
    await expect(legacyChip).toContainText('original block unavailable')
    await legacyChip.click()
    await expectArtifactRoute(owner.page, artifact.id)
    await expect(owner.page.locator(`[data-doc-block-id="${blockId}"]`).first()).not.toHaveClass(/ring-co\/40/)
  } finally {
    await owner.context.close()
    await reader.context.close()
    await foreign.context.close()
  }
})

test('an inline draft holds through a stale revision and Retry edits the same block after reorder', async ({ page }, testInfo) => {
  test.setTimeout(ms(120_000))
  const stamp = Date.now().toString(36)
  const artifact = await createDocument(page, `inline-recovery-${stamp}.md`, `First stable paragraph ${stamp}.\n\nTarget stable paragraph ${stamp}.`)
  const initial = await currentBody(page, artifact.id)
  const target = initial.blocks[1]!
  const other = initial.blocks[0]!
  const targetId = target.id!
  const otherId = other.id!
  const baseRevision = initial.revision ?? 0
  const localText = `Local reviewed wording ${stamp}.`
  const remoteText = `Target moved after another device edit ${stamp}.`
  const requests: Array<{ body: Record<string, unknown>; key: string }> = []
  let attempts = 0

  await page.route(`**${API}/artifacts/${encodeURIComponent(artifact.id)}/content`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    attempts += 1
    const requestBody = route.request().postDataJSON() as Record<string, unknown>
    requests.push({ body: requestBody, key: route.request().headers()['idempotency-key'] ?? '' })
    if (attempts === 1) {
      const concurrent = await page.request.patch(`${API}/artifacts/${encodeURIComponent(artifact.id)}/content`, {
        data: {
          content: {
            type: 'doc', title: initial.title,
            blocks: [
              { ...target, p: remoteText },
              other,
            ],
          },
          expectedRevision: baseRevision,
        },
      })
      expect(concurrent.ok(), await concurrent.text()).toBeTruthy()
    }
    await route.continue()
  })

  await page.goto(`/artifacts/${encodeURIComponent(artifact.id)}`)
  const detail = artifactPage(page, artifact.id)
  await expect(detail).toBeVisible({ timeout: ms(20_000) })
  await detail.getByRole('button', { name: 'Edit block 2', exact: true }).click()
  const editor = detail.locator(`[data-doc-block-id="${targetId}"]`).getByRole('textbox', { name: /^Rewrite block / })
  await editor.fill(localText)
  await detail.getByRole('button', { name: 'Save', exact: true }).click()

  const failed = page.locator('[data-artifact-content-mutation="failed"]')
  await expect(failed).toContainText('changed elsewhere', { timeout: ms(20_000) })
  await expect(editor).toBeDisabled()
  await expect(detail.locator('[data-document-latest-block]')).toContainText(remoteText)
  await expect(detail.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  expect(attempts).toBe(1, 'stale stable target is not automatically retried')
  await captureViewportMatrix(page, testInfo, 'document-inline-held-conflict', failed)

  await failed.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failed).toHaveCount(0, { timeout: ms(20_000) })
  await expect(detail.locator(`[data-doc-block-id="${targetId}"]`)).toContainText(localText)
  await expect(detail.locator(`[data-doc-block-id="${otherId}"]`)).toContainText(`First stable paragraph ${stamp}.`)
  await expect(detail.getByRole('textbox', { name: /^Rewrite block / })).toHaveCount(0)
  expect(attempts).toBe(2)
  expect(requests.map(({ body }) => body)).toEqual([
    { blockId: targetId, text: localText, expectedRevision: baseRevision },
    { blockId: targetId, text: localText, expectedRevision: baseRevision + 1 },
  ])
  expect(requests[0]?.key).not.toBe('')
  expect(requests[1]?.key).toBe(requests[0]?.key)
})

test('a document with no saved body receives the empty-content state rather than invented prose', async ({ page }) => {
  test.setTimeout(ms(45_000))
  const stamp = Date.now().toString(36)
  const artifact = await createDocument(page, `empty-document-${stamp}.md`, 'A temporary body omitted by the read fixture.')
  await page.route(`**${API}/artifact-content`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.goto(`/artifacts/${encodeURIComponent(artifact.id)}`)
  await expect(page.getByText('No saved document content yet.', { exact: true })).toBeVisible({ timeout: ms(20_000) })
  await expect(page.getByText('A temporary body omitted by the read fixture.', { exact: true })).toHaveCount(0)
  await assertWcag22Aa(page, 'empty Document content state')
})
