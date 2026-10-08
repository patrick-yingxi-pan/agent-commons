/** Browser coverage for explicit, immutable Artifact copies attached to chats. */
import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import type { ArtifactContent, ArtifactItem, StructuredArtifactBody } from '../contract/index.ts'
import { artifactContextId, artifactSnapshotText } from '../contract/artifactSnapshot.ts'
import { API, newUser } from './social-helpers.ts'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const

type Artifact = { id: string; name: string; kind: string }
type ArtifactSnapshot = { version: number; snapshotId: string; capturedAt: string; artifactId: string; title: string; artifactKind: string; revision: number; body: unknown }
type SavedAttachment = { id: string; kind: string; label: string; artifactSnapshot?: ArtifactSnapshot; artifactCaptureId?: string }
type SessionRow = { id: string; workspace?: { attachments?: SavedAttachment[] } }

async function createArtifact(page: Page, name: string, body: string) {
  const response = await page.request.post(`${API}/artifacts`, {
    data: { name, kind: 'doc', body },
    headers: { 'Idempotency-Key': `artifact-context-${randomUUID()}` },
  })
  expect(response.ok(), `the source Artifact ${name} is created: ${await response.text()}`).toBe(true)
  const payload = await response.json() as { artifact: Artifact }
  expect(payload.artifact.name).toBe(name)
  return payload.artifact
}

async function createStructuredArtifact(page: Page, name: string, kind: 'sheet' | 'workbook' | 'slides', body: StructuredArtifactBody) {
  const response = await page.request.post(`${API}/artifacts`, {
    data: { name, kind: kind === 'slides' ? 'slide' : 'sheet', body },
    headers: { 'Idempotency-Key': `artifact-context-${randomUUID()}` },
  })
  expect(response.ok(), `the source Artifact ${name} is created: ${await response.text()}`).toBe(true)
  const payload = await response.json() as { artifact: ArtifactItem }
  expect(payload.artifact.name).toBe(name)
  return payload.artifact
}

async function createSession(page: Page) {
  const response = await page.request.post(`${API}/sessions`, { data: {} })
  expect(response.ok(), `a destination conversation is created: ${await response.text()}`).toBe(true)
  return (await response.json() as { id: string }).id
}

async function readSession(page: Page, id: string) {
  const response = await page.request.get(`${API}/sessions/${encodeURIComponent(id)}`)
  expect(response.ok(), `the destination conversation ${id} remains readable`).toBe(true)
  return await response.json() as SessionRow
}

function savedArtifact(row: SessionRow, artifactId: string) {
  return row.workspace?.attachments?.find((attachment) =>
    attachment.kind === 'artifact' && attachment.artifactSnapshot?.artifactId === artifactId)
}

function artifactPanel(page: Page, id: string) {
  return page.locator(`[data-artifact-context-panel][data-artifact-context-id=${JSON.stringify(artifactContextId(id))}]`).filter({ visible: true })
}

async function openArtifactPanel(page: Page, artifact: { id: string; name: string }) {
  const panel = artifactPanel(page, artifact.id)
  const title = artifact.name
  const chip = page.getByTitle('Open in sidebar').filter({ hasText: title }).filter({ visible: true })
  const group = page.getByRole('button', { name: /^Artifacts · \d+$/ })
  await expect(panel.or(chip).or(group).first()).toBeVisible({ timeout: ms(15_000) })
  // Attach already selects its panel. Several copies collapse into the shared
  // counted chip; do not require the single-item chip in that state.
  if (await panel.isVisible()) return panel
  if (await chip.isVisible()) {
    if (!(await chip.getAttribute('class'))?.includes('ring-accent')) await chip.click()
  } else {
    await expect(group, 'multiple saved copies have a counted conversation chip').toBeVisible()
  }
  await expect(panel, 'selecting the copy opens its saved-body panel').toBeVisible({ timeout: ms(15_000) })
  return panel
}

async function openArtifactPicker(page: Page) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
  await dialog.getByRole('button', { name: /^Artifact/ }).click()
  const list = dialog.locator('[data-artifact-context-picker]')
  await expect(list).toBeVisible({ timeout: ms(15_000) })
  return { dialog, list }
}

async function attachArtifact(page: Page, title: string, isDraft = false) {
  const { dialog, list } = await openArtifactPicker(page)
  const row = list.getByRole('button', { name: title, exact: true })
  await expect(row, 'the picker offers only a currently readable source').toBeVisible({ timeout: ms(15_000) })
  await row.click()
  const confirm = dialog.locator('[data-artifact-context-confirm]')
  await expect(confirm).toContainText('Everyone with access to the destination conversation can read it.')
  await expect(confirm).toContainText('Revoking access to the source later won’t erase this copy')
  await expect(confirm).toContainText('It won’t update live.')
  if (isDraft) await expect(confirm).toContainText('No copy is saved yet.')
  await confirm.getByRole('button', { name: isDraft ? 'Add to draft' : 'Attach saved copy', exact: true }).click()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function assertSurfaceBounds(page: Page, surface: Locator, label: string, scrollable = false) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    `${label} does not create horizontal page overflow`).toBe(true)
  await expect.poll(() => surface.evaluate((element, canScroll) => {
    const box = element.getBoundingClientRect()
    const controls = [...element.querySelectorAll('button, textarea')].filter((control) => control.getClientRects().length > 0)
    return box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 &&
      box.right <= innerWidth && box.bottom <= innerHeight && controls.every((control) => {
        const item = control.getBoundingClientRect()
        return item.width > 0 && item.height > 0 && item.left >= 0 && item.right <= innerWidth &&
          (canScroll || item.top >= 0 && item.bottom <= innerHeight)
      })
  }, scrollable), `${label} and its controls fit the viewport`).toBe(true)
  if (scrollable) {
    // A saved body's controls may be below the fold, but every one must remain
    // reachable within its scroll container (especially short landscape).
    const controls = surface.locator('button, textarea').filter({ visible: true })
    for (const control of await controls.all()) {
      await control.scrollIntoViewIfNeeded()
      await expect(control).toBeInViewport()
    }
    if (await controls.count()) await controls.first().scrollIntoViewIfNeeded()
  }
}

test('a draft captures a confirmed readable Artifact as a complete copy on its first send', async ({ page }, testInfo) => {
  test.setTimeout(ms(180_000))
  page.setDefaultTimeout(ms(15_000))
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-artifact-context-draft-${randomUUID()}` })
  const stamp = randomUUID()
  const title = `Draft source ${stamp}.md`
  const body = `First paragraph ${stamp}.\n\nSecond paragraph ${stamp}.`
  const artifact = await createArtifact(page, title, body)
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'New session', exact: true }).click()
  const composer = page.getByPlaceholder('Reply to Claude…')
  await expect(composer).toBeVisible()
  let sessionWrites = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/sessions`) sessionWrites++
  })

  const { dialog, list } = await openArtifactPicker(page)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await assertSurfaceBounds(page, list, `Artifact picker at ${viewport.width}x${viewport.height}`)
    await assertWcag22Aa(page, `Artifact picker ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`artifact-context-picker-${viewport.width}x${viewport.height}.png`) })
  }
  await list.getByRole('button', { name: title, exact: true }).click()
  const confirm = dialog.locator('[data-artifact-context-confirm]')
  await expect(confirm).toContainText('This draft will capture the copy on its first send')
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await assertSurfaceBounds(page, confirm, `Artifact confirmation at ${viewport.width}x${viewport.height}`)
    await assertWcag22Aa(page, `Artifact confirmation ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`artifact-context-confirm-${viewport.width}x${viewport.height}.png`) })
  }
  await confirm.getByRole('button', { name: 'Add to draft', exact: true }).click()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  expect(sessionWrites, 'confirming a draft target does not materialize a conversation').toBe(0)

  const queuedPanel = await openArtifactPanel(page, artifact)
  await expect(queuedPanel).toContainText('Artifact copy queued for this draft')
  await expect(queuedPanel.getByRole('region', { name: 'Saved Artifact content', exact: true })).toHaveCount(0)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await assertSurfaceBounds(page, queuedPanel, `queued Artifact draft at ${viewport.width}x${viewport.height}`, true)
    await assertWcag22Aa(page, `Queued Artifact draft ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`artifact-context-draft-${viewport.width}x${viewport.height}.png`) })
  }

  await composer.fill(`Use the saved Artifact as context ${stamp}`)
  const created = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === `${API}/sessions`,
    { timeout: ms(25_000) },
  )
  await composer.press('Enter')
  const createdResponse = await created
  expect(createdResponse.ok(), 'the first send creates the destination conversation').toBe(true)
  const sessionId = (await createdResponse.json() as { id: string }).id
  await expect.poll(async () => savedArtifact(await readSession(page, sessionId), artifact.id)?.artifactSnapshot?.revision ?? null,
    { message: 'the server captures the exact readable source revision on first send', timeout: ms(25_000) }).toBe(0)
  const attachment = savedArtifact(await readSession(page, sessionId), artifact.id)
  expect(attachment?.artifactSnapshot).toMatchObject({ artifactId: artifact.id, title, artifactKind: 'doc', revision: 0 })
  expect(JSON.stringify(attachment?.artifactSnapshot?.body)).toContain(stamp)
  expect(attachment?.artifactCaptureId).toBeUndefined()
  expect(sessionWrites).toBe(1)
  const savedPanel = await openArtifactPanel(page, artifact)
  await expect(savedPanel).toContainText(`First paragraph ${stamp}.`)
  await expect(savedPanel).toContainText(`Second paragraph ${stamp}.`)
  await expect(savedPanel).not.toContainText('queued for this draft')
})

test('saved structured and Figure copies render their canonical bodies and exact reference data', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser, { 'x-user-id': 'user-ada', 'x-tenant-id': 'tenant-acme' })
  try {
    const { page } = owner
    const stamp = randomUUID()
    const sources = [
      {
        name: `Context sheet ${stamp}.sheet`, format: 'sheet' as const,
        body: { type: 'sheet' as const, columns: ['Metric', 'Value'], rows: [[`Sheet metric ${stamp}`, '00042'], ['Costs', '00017']], note: `Sheet note ${stamp}` },
      },
      {
        name: `Context workbook ${stamp}.xlsx`, format: 'workbook' as const,
        body: { type: 'workbook' as const, sheets: [
          { id: 'overview', name: 'Overview', columns: ['Metric', 'Value'], rows: [[`Workbook overview ${stamp}`, '00081']] },
          { id: 'forecast', name: 'Forecast', columns: ['Metric', 'Value'], rows: [[`Workbook forecast ${stamp}`, '00019']] },
        ] },
      },
      {
        name: `Context slides ${stamp}.slides`, format: 'slides' as const,
        body: { type: 'slides' as const, slides: [
          { title: `Slide one ${stamp}`, bullets: [`First bullet ${stamp}`, 'Preserved detail'] },
          { title: `Slide two ${stamp}`, bullets: [`Second bullet ${stamp}`] },
        ] },
      },
    ]
    const created = [] as Array<{ artifact: ArtifactItem; format: 'sheet' | 'workbook' | 'slides' | 'figure' }>
    for (const source of sources) {
      created.push({ artifact: await createStructuredArtifact(page, source.name, source.format, source.body), format: source.format })
    }

    const artifactsResponse = await page.request.get(`${API}/artifacts`)
    expect(artifactsResponse.ok(), `the owner’s Artifact list is readable: ${await artifactsResponse.text()}`).toBe(true)
    const artifacts = await artifactsResponse.json() as ArtifactItem[]
    const contentResponse = await page.request.get(`${API}/artifact-content`)
    expect(contentResponse.ok(), `the owner’s Artifact bodies are readable: ${await contentResponse.text()}`).toBe(true)
    const content = await contentResponse.json() as Record<string, ArtifactContent>
    const figure = artifacts.find((artifact) => artifact.kind === 'image' && content[artifact.id]?.type === 'figure')
    expect(figure, 'the seeded web account has a readable canonical Figure source').toBeTruthy()
    created.push({ artifact: figure!, format: 'figure' })

    const sessionId = await createSession(page)
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    for (const { artifact, format } of created) {
      const original = content[artifact.id]
      expect(original, `the exact source body for ${artifact.name} is available`).toBeTruthy()
      const { revision: _revision, ...canonicalBody } = original!
      await attachArtifact(page, artifact.name)
      const panel = await openArtifactPanel(page, artifact)
      const region = panel.getByRole('region', { name: 'Saved Artifact content', exact: true })
      await expect(region).toBeVisible()
      const stored = savedArtifact(await readSession(page, sessionId), artifact.id)
      expect(stored?.artifactSnapshot, `${artifact.name} saves an immutable copy`).toBeTruthy()
      const snapshot = stored!.artifactSnapshot!
      expect(snapshot).toMatchObject({ artifactId: artifact.id, title: artifact.name, revision: original!.revision ?? 0 })
      expect(snapshot.body, `${artifact.name} keeps every canonical body field`).toEqual(canonicalBody)

      if (format === 'figure') {
        expect(snapshot.artifactKind).toBe('image')
        if (original?.type !== 'figure') throw new Error('seeded image fixture must have a Figure body')
        await expect(region).toContainText(original.caption)
        if (original.headline) await expect(region).toContainText(original.headline)
      } else if (format === 'sheet') {
        expect(snapshot.artifactKind).toBe('sheet')
        await expect(region.locator('[data-structured-artifact-body="sheet"]')).toBeVisible()
        if (original?.type !== 'sheet') throw new Error('created sheet fixture must have a Sheet body')
        for (const row of original.rows) for (const cell of row) await expect(region).toContainText(cell)
        if (original.note) await expect(region).toContainText(original.note)
      } else if (format === 'workbook') {
        expect(snapshot.artifactKind).toBe('sheet')
        await expect(region.locator('[data-structured-artifact-body="workbook"]')).toBeVisible()
        if (original?.type !== 'workbook') throw new Error('created workbook fixture must have a Workbook body')
        const tabs = region.getByRole('tablist', { name: 'Worksheets', exact: true })
        await expect(tabs.getByRole('tab')).toHaveText(original.sheets.map((sheet) => sheet.name))
        for (const sheet of original.sheets) {
          await tabs.getByRole('tab', { name: sheet.name, exact: true }).click()
          for (const row of sheet.rows) for (const cell of row) await expect(region).toContainText(cell)
        }
      } else {
        expect(snapshot.artifactKind).toBe('slide')
        await expect(region.locator('[data-structured-artifact-body="slides"]')).toBeVisible()
        if (original?.type !== 'slides') throw new Error('created slides fixture must have a Slides body')
        for (const slide of original.slides) {
          await expect(region).toContainText(slide.title)
          for (const bullet of slide.bullets) await expect(region).toContainText(bullet)
        }
      }

      await panel.locator('details > summary').getByText('Exact reference text and data', { exact: true }).click()
      const exactReference = panel.getByRole('textbox', { name: 'Saved Artifact reference data', exact: true })
      await expect(exactReference).toBeVisible()
      await expect(exactReference).toHaveAttribute('readonly', '')
      await expect(exactReference).toHaveValue(artifactSnapshotText(snapshot))
      await panel.locator('details > summary').getByText('Exact reference text and data', { exact: true }).click()
      if (format === 'workbook') {
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize(viewport)
          await assertSurfaceBounds(page, panel, `Saved workbook at ${viewport.width}x${viewport.height}`, true)
          await assertWcag22Aa(page, `Saved workbook ${viewport.width}x${viewport.height}`)
          await page.screenshot({ path: testInfo.outputPath(`artifact-context-workbook-${viewport.width}x${viewport.height}.png`) })
        }
      }
    }
  } finally {
    await owner.context.close()
  }
})

test('saved Artifact copies stay private to the destination, refresh only by request, and survive source revocation', async ({ browser }: { browser: Browser }, testInfo) => {
  test.setTimeout(ms(180_000))
  const sourceTenant = `tenant-artifact-source-${randomUUID()}`
  // Grants require a known organization; source IDs remain unique to this walk.
  const destinationTenant = 'tenant-acme'
  const sourceOwner = await newUser(browser, { 'x-user-id': 'user-ada', 'x-tenant-id': sourceTenant })
  const destinationOwner = await newUser(browser, { 'x-user-id': 'user-ada', 'x-tenant-id': destinationTenant })
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  try {
    const stamp = randomUUID()
    const title = `Shared source ${stamp}.md`
    const oldText = `Original saved paragraph ${stamp}. ${'saved reference detail '.repeat(70)}`.trimEnd()
    const newText = `Explicitly refreshed paragraph ${stamp}. ${'refreshed reference detail '.repeat(70)}`.trimEnd()
    const source = await createArtifact(sourceOwner.page, title, `Opening ${stamp}.\n\n${oldText}`)
    const sourceGrantResponse = await sourceOwner.page.request.post(`${API}/grants`, { data: {
      subject: { kind: 'artifact', id: source.id }, audience: { kind: 'org', orgId: destinationTenant }, tier: 'view',
    } })
    expect(sourceGrantResponse.ok(), `the destination owner receives source read access: ${await sourceGrantResponse.text()}`).toBe(true)
    const sourceGrant = await sourceGrantResponse.json() as { id: string }
    const sessionId = await createSession(destinationOwner.page)
    await destinationOwner.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    await attachArtifact(destinationOwner.page, title)
    let stored = savedArtifact(await readSession(destinationOwner.page, sessionId), source.id)
    expect(stored?.artifactSnapshot).toMatchObject({ artifactId: source.id, title, artifactKind: 'doc', revision: 0 })
    expect(JSON.stringify(stored?.artifactSnapshot?.body)).toContain(oldText)
    const ownerPanel = await openArtifactPanel(destinationOwner.page, source)
    await expect(ownerPanel.getByRole('region', { name: 'Saved Artifact content', exact: true })).toBeVisible()
    await expect(ownerPanel).toContainText(oldText)

    const edit = await sourceOwner.page.request.patch(`${API}/artifacts/${source.id}/content`, {
      data: { block: 1, text: newText, expectedRevision: 0 },
    })
    expect(edit.ok(), `the source owner edits the current Artifact: ${await edit.text()}`).toBe(true)
    await expect(ownerPanel).toContainText(oldText)
    await expect(ownerPanel).not.toContainText(newText)
    stored = savedArtifact(await readSession(destinationOwner.page, sessionId), source.id)
    expect(JSON.stringify(stored?.artifactSnapshot?.body)).toContain(oldText)
    expect(JSON.stringify(stored?.artifactSnapshot?.body)).not.toContain(newText)

    const refreshRequests: Array<{ expectedSnapshotId: string; requestId: string }> = []
    let loseFirstRefreshAcknowledgement = true
    await destinationOwner.page.route(`**/api/v1/sessions/${sessionId}/attachments/*/refresh`, async (route) => {
      refreshRequests.push(route.request().postDataJSON() as { expectedSnapshotId: string; requestId: string })
      if (loseFirstRefreshAcknowledgement) {
        loseFirstRefreshAcknowledgement = false
        const committed = await route.fetch()
        expect(committed.ok(), 'the first explicit Refresh commits before its acknowledgement is lost').toBe(true)
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'unavailable', message: 'The refresh response was lost after commit.' } }),
        })
        return
      }
      await route.continue()
    })
    await destinationOwner.page.getByRole('button', { name: 'Refresh copy', exact: true }).click()
    const ownerContextPane = destinationOwner.page.locator('[data-context-pane]').filter({ has: ownerPanel })
    const lostAck = ownerContextPane.getByRole('alert').filter({ hasText: 'Couldn’t confirm the context update.' })
    await expect(lostAck).toContainText('response was lost after commit')
    const retry = lostAck.getByRole('button', { name: 'Retry', exact: true })
    await expect(retry).toBeVisible()
    await retry.click()
    await expect(ownerPanel).toContainText(newText, { timeout: ms(20_000) })
    await expect(lostAck).toHaveCount(0)
    expect(refreshRequests).toHaveLength(2)
    expect(refreshRequests[1]?.requestId).toBe(refreshRequests[0]?.requestId,
      'Retry replays the already-captured exact source copy instead of silently starting a different capture')
    await destinationOwner.page.unroute(`**/api/v1/sessions/${sessionId}/attachments/*/refresh`)
    stored = savedArtifact(await readSession(destinationOwner.page, sessionId), source.id)
    expect(stored?.artifactSnapshot).toMatchObject({ revision: 1, artifactId: source.id })
    expect(JSON.stringify(stored?.artifactSnapshot?.body)).toContain(newText)

    const sessionGrantResponse = await destinationOwner.page.request.post(`${API}/grants`, { data: {
      subject: { kind: 'session', id: sessionId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view',
    } })
    expect(sessionGrantResponse.ok(), `the conversation grants access to its saved copy: ${await sessionGrantResponse.text()}`).toBe(true)
    const readerSourceLookup = await reader.page.request.get(`${API}/artifact-content`)
    expect(readerSourceLookup.ok(), 'the reader current-body projection remains available').toBe(true)
    expect(Object.hasOwn(await readerSourceLookup.json() as object, source.id),
      'the reader cannot resolve the source body outside the destination snapshot').toBe(false)
    await reader.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const readerPanel = await openArtifactPanel(reader.page, source)
    await expect(readerPanel).toContainText(newText)
    await expect(readerPanel.getByRole('region', { name: 'Saved Artifact content', exact: true })).toBeVisible()
    await expect(reader.page.getByRole('button', { name: 'Refresh copy', exact: true })).toHaveCount(0)
    await expect(reader.page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)

    const foreignSession = await foreign.page.request.get(`${API}/sessions/${encodeURIComponent(sessionId)}`)
    expect(foreignSession.status(), 'a foreign tenant cannot resolve the destination or its attached copy').toBe(404)
    await foreign.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    await expect(foreign.page.getByText(newText, { exact: true })).toHaveCount(0)

    const revoked = await sourceOwner.page.request.delete(`${API}/grants/${sourceGrant.id}`)
    expect(revoked.ok(), `source access is revoked after a complete copy exists: ${await revoked.text()}`).toBe(true)
    await expect(ownerPanel).toContainText(newText)
    await expect(readerPanel).toContainText(newText)
    const beforeRefusal = await readSession(destinationOwner.page, sessionId)
    const snapshotBeforeRefusal = savedArtifact(beforeRefusal, source.id)?.artifactSnapshot
    await destinationOwner.page.getByRole('button', { name: 'Refresh copy', exact: true }).click()
    const refused = ownerContextPane.getByRole('alert').filter({ hasText: /source|read|available|couldn’t|could not/i })
    await expect(refused, 'refresh rechecks the revoked source and refuses without erasing the copy').toBeVisible({ timeout: ms(20_000) })
    expect(savedArtifact(await readSession(destinationOwner.page, sessionId), source.id)?.artifactSnapshot).toEqual(snapshotBeforeRefusal)
    await expect(readerPanel).toContainText(newText)

    await destinationOwner.page.setViewportSize({ width: 375, height: 812 })
    const exactReference = ownerPanel.getByRole('textbox', { name: 'Saved Artifact reference data', exact: true })
    await expect(exactReference).toBeHidden()
    await ownerPanel.locator('details > summary').getByText('Exact reference text and data', { exact: true }).click()
    await expect(exactReference).toBeVisible()
    await expect(exactReference).toHaveAttribute('readonly', '')
    expect(await exactReference.inputValue()).toContain(newText)
    await exactReference.focus()
    await exactReference.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await expect.poll(() => exactReference.evaluate((element) =>
      element.scrollTop + element.clientHeight >= element.scrollHeight - 2),
    'keyboard navigation can reach the end of the complete saved reference').toBe(true)
    await expect(exactReference).toBeInViewport()
    await ownerPanel.locator('details > summary').getByText('Exact reference text and data', { exact: true }).click()

    for (const [actor, page, panel] of [['owner', destinationOwner.page, ownerPanel], ['reader', reader.page, readerPanel]] as const) {
      for (const viewport of VIEWPORTS) {
        const size = `${viewport.width}x${viewport.height}`
        await page.setViewportSize(viewport)
        await assertSurfaceBounds(page, panel, `Artifact copy ${actor} at ${size}`, true)
        if (actor === 'owner') {
          const refresh = page.getByRole('button', { name: 'Refresh copy', exact: true })
          const source = page.getByRole('button', { name: 'View source Artifact', exact: true })
          await expect(refresh).toBeVisible()
          await expect(refresh).toBeInViewport()
          await expect(source).toBeVisible()
          await expect(source).toBeInViewport()
        }
        else await expect(page.getByRole('button', { name: 'Refresh copy', exact: true })).toHaveCount(0)
        await assertWcag22Aa(page, `Artifact saved copy ${actor} ${size}`)
        await page.screenshot({ path: testInfo.outputPath(`artifact-context-${actor}-${size}.png`) })
      }
    }

    await foreign.page.goto('/')
    for (const viewport of VIEWPORTS) {
      const size = `${viewport.width}x${viewport.height}`
      await foreign.page.setViewportSize(viewport)
      const { dialog, list } = await openArtifactPicker(foreign.page)
      await expect(list).not.toContainText(title)
      await assertSurfaceBounds(foreign.page, list, `foreign Artifact picker at ${size}`)
      await assertWcag22Aa(foreign.page, `Foreign Artifact picker ${size}`)
      await foreign.page.screenshot({ path: testInfo.outputPath(`artifact-context-foreign-${size}.png`) })
      await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    }
  } finally {
    await Promise.allSettled([sourceOwner.context.close(), destinationOwner.context.close(), reader.context.close(), foreign.context.close()])
  }
})
