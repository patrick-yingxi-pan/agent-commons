/** Rendered coverage for discussion copies attached to conversations. The
 *  source remains live and private; each conversation gets an explicit,
 *  immutable snapshot that only Refresh replaces. */
import { randomUUID } from 'node:crypto'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { assertWcag22Aa, settledAttachmentPreview } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { newUser } from './social-helpers.ts'

const API = '/api/v1'
const CONTEXT_WORKFLOW_MODULE = /\/src\/components\/ContextPickerWorkflow\.tsx(?:\?.*)?$/u
const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
] as const

type DiscussionRow = {
  id: string
  posts: Array<{ id: string; author: string; body: string; at: number; replyTo?: string }>
}
type SavedAttachment = {
  id: string
  label: string
  discussionSnapshot?: { discussionId: string; snapshotId: string; postCount: number; text: string; capturedAt: string }
}
type SessionRow = { id: string; workspace?: { attachments?: SavedAttachment[] } }

async function createDiscussion(page: Page) {
  const title = `Snapshot source ${randomUUID()}`
  const projectId = `p-discussion-context-${randomUUID()}`
  const project = await page.request.post(`${API}/relations/ops`, { data: {
    op: { kind: 'create-project', projectId, projectName: title, projectDescription: '' },
  } })
  expect(project.ok(), 'a private, test-owned anchor project is created').toBe(true)
  const response = await page.request.post(`${API}/discussions`, { data: {
    anchor: { ref: { kind: 'project', id: projectId } },
    firstPost: title,
  } })
  expect(response.ok(), 'a uniquely owned source discussion is created').toBe(true)
  const discussion = await response.json() as DiscussionRow
  expect(discussion.posts[0]?.body).toBe(title)
  return { id: discussion.id, title, text: discussionText(discussion) }
}

async function useTenant(page: Page, purpose: string) {
  await page.context().setExtraHTTPHeaders({
    'x-user-id': 'user-ada',
    'x-tenant-id': `tenant-discussion-context-${purpose}-${randomUUID()}`,
  })
}

function discussionText(discussion: DiscussionRow) {
  const indexes = new Map(discussion.posts.map((post, index) => [post.id, index + 1]))
  const lines = discussion.posts.map((post, index) => {
    const parent = post.replyTo ? indexes.get(post.replyTo) : undefined
    return `[${index + 1}] ${post.author} · ${new Date(post.at).toISOString()}${parent ? ` · reply to #${parent}` : ''}\n${post.body}`
  })
  return `# ${discussion.posts[0]?.body ?? ''}\n\n${lines.join('\n\n')}`
}

async function createSession(page: Page) {
  const response = await page.request.post(`${API}/sessions`, { data: {} })
  expect(response.ok(), 'an existing conversation is created for the attach walk').toBe(true)
  return (await response.json() as { id: string }).id
}

async function session(page: Page, sessionId: string) {
  const response = await page.request.get(`${API}/sessions/${encodeURIComponent(sessionId)}`)
  expect(response.ok(), 'the conversation remains readable').toBe(true)
  return await response.json() as SessionRow
}

async function attachDiscussion(page: Page, title: string, options: { isDraft?: boolean; expectPanel?: boolean } = {}) {
  const { isDraft = false, expectPanel = !isDraft } = options
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Discussion/ }).click()
  const list = picker.locator('[data-discussion-context-picker]')
  await expect(list).toBeVisible({ timeout: ms(15_000) })
  const row = list.getByRole('button', { name: title, exact: true })
  await expect(row, 'only a currently readable source is offered').toBeVisible({ timeout: ms(15_000) })
  await row.click()
  const confirmation = picker.locator('[data-discussion-context-confirm]')
  await expect(confirmation).toContainText('Everyone with access to the destination conversation can read it.')
  if (isDraft) await expect(confirmation).toContainText('No copy is saved yet.')
  await confirmation.getByRole('button', { name: isDraft ? 'Add to draft' : 'Attach saved copy', exact: true }).click()
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(picker).toHaveCount(0)
  if (expectPanel) await waitForSelectedDiscussionPanel(page, title)
}

function discussionChip(page: Page, title: string) {
  return page.getByTitle('Open in sidebar').filter({ hasText: title }).filter({ visible: true })
}

async function waitForSelectedDiscussionPanel(page: Page, title: string) {
  const chip = discussionChip(page, title)
  await expect(chip, 'the discussion chip is visible').toBeVisible({ timeout: ms(15_000) })
  await expect(chip, 'the selected chip carries the open-panel intent').toHaveClass(/ring-1 ring-accent/)
  const eagerShellOrBody = page.locator('[data-discussion-panel-load], [data-discussion-context-panel]').filter({ visible: true })
  await expect(eagerShellOrBody, 'focus mounts the eager discussion-panel shell before its deferred body').toHaveCount(1, { timeout: ms(15_000) })
  const panel = page.locator('[data-discussion-context-panel]').filter({ visible: true })
  await expect(panel, 'the saved discussion body finishes loading without toggling its selected chip').toBeVisible({ timeout: ms(15_000) })
  return panel
}

async function openDiscussionPanel(page: Page, title: string) {
  const chip = discussionChip(page, title)
  await expect(chip, 'the discussion copy has a visible conversation chip').toBeVisible({ timeout: ms(15_000) })
  if (!(await chip.getAttribute('class'))?.includes('ring-accent')) await chip.click()
  return waitForSelectedDiscussionPanel(page, title)
}

async function assertViewportCell(page: Page, testInfo: TestInfo, state: 'picker' | 'confirm' | 'panel' | 'reader-panel', viewport: typeof VIEWPORTS[number]) {
  const size = `${viewport.width}x${viewport.height}`
  await page.setViewportSize(viewport)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), {
    message: `${state} has no horizontal overflow at ${size}`,
  }).toBe(true)

  if (state === 'picker' || state === 'confirm') {
    const dialog = page.getByRole('dialog', { name: 'Add context', exact: true })
    const surface = state === 'picker'
      ? dialog.locator('[data-discussion-context-picker]')
      : dialog.locator('[data-discussion-context-confirm]')
    await expect(surface).toBeVisible()
    if (state === 'confirm') await expect(surface).toContainText('Attach a saved copy?')
    await expect.poll(() => dialog.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const controls = [...element.querySelectorAll('button')]
      return box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 &&
        box.right <= innerWidth && box.bottom <= innerHeight && controls.length > 0 &&
        controls.every((control) => {
          const item = control.getBoundingClientRect()
          return item.width > 0 && item.height > 0 && item.left >= box.left && item.right <= box.right &&
            item.top >= box.top && item.bottom <= box.bottom
        })
    }), `the ${state} surface and every control fit the ${size} viewport`).toBe(true)
    await assertWcag22Aa(page, `Discussion ${state} ${size}`)
    await page.screenshot({ path: testInfo.outputPath(`discussion-${state}-${size}.png`), fullPage: true })
    return
  }

  const panel = page.locator('[data-discussion-context-panel]').filter({ visible: true })
  await expect(panel).toBeVisible()
  const savedText = panel.getByRole('textbox', { name: 'Saved discussion copy', exact: true })
  await expect(savedText).toBeVisible()
  await expect(savedText).toHaveAttribute('readonly', '')
  await expect.poll(() => panel.evaluate((element, readerOnly) => {
    const body = element.getBoundingClientRect()
    const controls = [...element.querySelectorAll('button, textarea')]
    const refresh = readerOnly ? undefined : [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Refresh copy'))
    const refreshBox = refresh?.getBoundingClientRect()
    return body.width > 0 && body.height > 0 && body.left >= 0 && body.top >= 0 &&
      body.right <= innerWidth && body.bottom <= innerHeight && controls.every((control) => {
        const item = control.getBoundingClientRect()
        return item.width > 0 && item.height > 0 && item.left >= 0 && item.right <= innerWidth &&
          item.top >= 0 && item.bottom <= innerHeight
      }) && (readerOnly || !!refreshBox && refreshBox.width > 0 && refreshBox.height > 0 &&
      refreshBox.left >= 0 && refreshBox.right <= innerWidth && refreshBox.top >= 0 && refreshBox.bottom <= innerHeight)
  }, state === 'reader-panel'), `the saved copy and read-only controls${state === 'reader-panel' ? '' : ' and Refresh control'} fit the ${size} viewport`).toBe(true)
  if (state === 'reader-panel') await expect(page.getByRole('button', { name: 'Refresh copy', exact: false })).toHaveCount(0)
  await assertWcag22Aa(page, `Discussion ${state} ${size}`)
  await page.screenshot({ path: testInfo.outputPath(`discussion-${state}-${size}.png`), fullPage: true })
}

test('a blocked deferred Add context workflow fails locally and Done preserves the draft', async ({ page }) => {
  test.setTimeout(ms(45_000))
  await page.context().setExtraHTTPHeaders({ 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-picker-chunk-${randomUUID()}` })
  let intercepted = false
  await page.route(CONTEXT_WORKFLOW_MODULE, async (route) => {
    intercepted = true
    await route.abort('failed')
  })
  let sessionWrites = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/sessions`) sessionWrites++
  })

  await page.goto('/')
  const composer = page.getByPlaceholder('Reply to Claude…')
  await composer.fill('Keep this draft while the optional picker fails.')
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Files/ }).click()
  const failed = picker.getByRole('alert').filter({ hasText: 'Couldn’t load context options. Nothing was added.' })
  await expect(failed).toBeVisible({ timeout: ms(15_000) })
  await expect(failed.getByRole('button', { name: 'Done', exact: true })).toBeVisible()
  expect(intercepted, 'choosing a category requested the deferred picker module').toBe(true)
  expect(sessionWrites, 'a failed picker module cannot materialize a session').toBe(0)
  await assertWcag22Aa(page, 'Deferred Add context workflow failure')
  await failed.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(composer).toHaveValue('Keep this draft while the optional picker fails.')
  expect(sessionWrites).toBe(0)
})

test('a draft captures a confirmed readable discussion on its first send', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await useTenant(page, 'draft-usage')
  const source = await createDiscussion(page)
  let sessionCreates = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/sessions`) sessionCreates++
  })

  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'New session', exact: true }).click()
  const composer = page.getByPlaceholder('Reply to Claude…')
  await expect(composer).toBeVisible()
  await attachDiscussion(page, source.title, { isDraft: true })
  expect(sessionCreates, 'confirming a discussion target does not persist a session or copy').toBe(0)
  const draftPanel = await openDiscussionPanel(page, source.title)
  await expect(draftPanel).toContainText('Discussion copy queued for this draft')
  await expect(draftPanel.getByRole('textbox', { name: 'Saved discussion copy' })).toHaveCount(0)

  await composer.fill(`Use the source after confirmation ${randomUUID()}`)
  await composer.press('Enter')
  await expect.poll(() => sessionCreates, { message: 'the first send is what materializes the draft', timeout: ms(20_000) }).toBe(1)
  await expect(page).toHaveURL(/\/s\/[^/?#]+$/, { timeout: ms(20_000) })
  const sessionId = decodeURIComponent(new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)!)
  await expect.poll(async () => {
    const row = await session(page, sessionId)
    const snapshot = row.workspace?.attachments?.find((item) => item.discussionSnapshot)?.discussionSnapshot
    return snapshot?.text ?? null
  }, { message: 'first send captures the source into the new conversation', timeout: ms(20_000) }).toBe(source.text)
  const materialized = await session(page, sessionId)
  const saved = materialized.workspace?.attachments?.find((item) => item.discussionSnapshot)?.discussionSnapshot
  expect(saved).toMatchObject({ discussionId: source.id, postCount: 1, text: source.text })
  expect(saved?.snapshotId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  const capturedDraftPanel = await waitForSelectedDiscussionPanel(page, source.title)
  await expect(capturedDraftPanel.getByRole('textbox', { name: 'Saved discussion copy', exact: true })).toHaveValue(source.text)
  await expect(capturedDraftPanel).not.toContainText('Discussion copy queued for this draft')
})

test('a refused first-send capture stays removable and Retry reuses its materialized session', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await useTenant(page, 'draft-capture-refusal')
  const source = await createDiscussion(page)
  let contextWrites = 0
  let sessionCreates = 0
  const messagePaths: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname === `${API}/sessions`) sessionCreates++
    if (request.method() === 'POST' && url.pathname.endsWith('/messages')) messagePaths.push(url.pathname)
  })
  await page.route('**/api/v1/sessions/*/context-state', async (route) => {
    contextWrites++
    if (contextWrites > 1) {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'forbidden', message: 'The source discussion is no longer readable.' } }),
    })
  })

  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'New session', exact: true }).click()
  const composer = page.getByPlaceholder('Reply to Claude…')
  await attachDiscussion(page, source.title, { isDraft: true })
  const queuedRemove = page.getByRole('button', { name: `Remove ${source.title} from the conversation`, exact: true })
  await expect(queuedRemove, 'the confirmed source stays removable before send').toBeVisible()
  await composer.fill(`Capture must be refused before this sends ${randomUUID()}`)
  const created = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === `${API}/sessions`,
    { timeout: ms(20_000) },
  )
  await composer.press('Enter')
  const createdResponse = await created
  expect(createdResponse.ok(), 'the draft creates its one recovery session').toBe(true)
  const sessionId = (await createdResponse.json() as { id: string }).id
  const failed = page.getByRole('alert').filter({ hasText: 'Couldn’t confirm the queued context before sending.' })
  await expect(failed).toBeVisible({ timeout: ms(20_000) })
  await expect(queuedRemove).toBeVisible()
  expect(contextWrites, 'first send asks the server to capture before sending').toBe(1)
  expect(sessionCreates, 'only one materialized session exists after refusal').toBe(1)
  expect(messagePaths, 'refused capture never posts the first turn, including to the synthetic draft id').toEqual([])

  await queuedRemove.click()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(queuedRemove).toHaveCount(0)
  const retry = failed.getByRole('button', { name: 'Retry', exact: true })
  await expect(retry).toBeVisible()
  const resumedMessage = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).pathname === `${API}/sessions/${sessionId}/messages`,
    { timeout: ms(20_000) },
  )
  await retry.click()
  await resumedMessage
  await expect(failed).toHaveCount(0)
  expect(contextWrites, 'Retry persists the removal as an empty context before sending').toBe(2)
  expect(sessionCreates, 'Retry reuses the already-created session').toBe(1)
  expect(messagePaths, 'the recovered turn is sent only through the real session').toEqual([`${API}/sessions/${sessionId}/messages`])
  const saved = await session(page, sessionId)
  expect(saved.workspace?.attachments?.some((item) => item.discussionSnapshot?.discussionId === source.id)).toBe(false)
})

test('a lost first-send capture acknowledgement flushes removal before Retry sends', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await useTenant(page, 'draft-capture-lost-ack')
  const source = await createDiscussion(page)
  let contextWrites = 0
  let sessionCreates = 0
  let sessionId: string | undefined
  const preMessageWorkspaceAttachments: SavedAttachment[][] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname === `${API}/sessions`) sessionCreates++
  })
  await page.route('**/api/v1/sessions/*/context-state', async (route) => {
    contextWrites++
    if (contextWrites === 1) {
      const committed = await route.fetch()
      expect(committed.ok(), 'the first-send capture commits before its acknowledgement is lost').toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'unavailable', message: 'The acknowledgement was lost.' } }),
      })
      return
    }
    await route.continue()
  })
  await page.route('**/api/v1/sessions/*/messages', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    const id = sessionId
    expect(id, 'the first turn targets its already-materialized session').toBeTruthy()
    const response = await page.request.get(`${API}/sessions/${encodeURIComponent(id!)}`)
    expect(response.ok(), 'the server session is readable before the first-turn POST').toBe(true)
    const current = await response.json() as SessionRow
    preMessageWorkspaceAttachments.push(current.workspace?.attachments ?? [])
    await route.continue()
  })

  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: 'New session', exact: true }).click()
  const composer = page.getByPlaceholder('Reply to Claude…')
  await attachDiscussion(page, source.title, { isDraft: true })
  const queuedRemove = page.getByRole('button', { name: `Remove ${source.title} from the conversation`, exact: true })
  await expect(queuedRemove, 'the confirmed source stays removable before send').toBeVisible()
  await composer.fill(`Lost acknowledgement must not restore this removed copy ${randomUUID()}`)
  const created = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === `${API}/sessions`,
    { timeout: ms(20_000) },
  )
  await composer.press('Enter')
  const createdResponse = await created
  expect(createdResponse.ok(), 'the draft creates its one recovery session').toBe(true)
  sessionId = (await createdResponse.json() as { id: string }).id
  const failed = page.getByRole('alert').filter({ hasText: 'Couldn’t confirm the queued context before sending.' })
  await expect(failed).toBeVisible({ timeout: ms(20_000) })
  await expect(queuedRemove).toBeVisible()
  const afterLostAck = await session(page, sessionId)
  expect(afterLostAck.workspace?.attachments?.some((item) => item.discussionSnapshot?.discussionId === source.id),
    'the simulated lost acknowledgement follows a committed discussion copy').toBe(true)
  expect(contextWrites, 'the first send attempted one context capture').toBe(1)
  expect(preMessageWorkspaceAttachments, 'a refused acknowledgement prevents the first-turn POST').toEqual([])

  await queuedRemove.click()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(queuedRemove).toHaveCount(0)
  const retry = failed.getByRole('button', { name: 'Retry', exact: true })
  await expect(retry).toBeVisible()
  const resumedMessage = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).pathname === `${API}/sessions/${sessionId}/messages`,
    { timeout: ms(20_000) },
  )
  await retry.click()
  await resumedMessage
  await expect(failed).toHaveCount(0)
  expect(contextWrites, 'Retry writes the current empty workspace before posting the turn').toBe(2)
  expect(sessionCreates, 'Retry reuses the already-created session').toBe(1)
  expect(preMessageWorkspaceAttachments, 'the server copy is gone before any message POST is allowed through').toEqual([[]])
  const saved = await session(page, sessionId)
  expect(saved.workspace?.attachments).toEqual([])
})

test('failed attach can use saved state; a committed Refresh with a lost response heals on Retry', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await useTenant(page, 'recovery')
  const source = await createDiscussion(page)
  const sessionId = await createSession(page)
  let attachAttempts = 0
  await page.route(`**/api/v1/sessions/${sessionId}/context-state`, async (route) => {
    attachAttempts++
    if (attachAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'Temporary discussion-copy outage' } }),
      })
      return
    }
    await route.continue()
  })

  await page.setViewportSize(VIEWPORTS[4])
  await page.goto(`/s/${encodeURIComponent(sessionId)}`)
  await attachDiscussion(page, source.title, { expectPanel: false })
  const failedAttach = page.getByRole('alert').filter({ hasText: 'Couldn’t confirm the context update.' })
  await expect(failedAttach).toContainText('Temporary discussion-copy outage')
  await expect(failedAttach.getByRole('button', { name: 'Use saved state', exact: true })).toBeVisible()
  const beforeRecovery = await session(page, sessionId)
  expect(beforeRecovery.workspace?.attachments?.some((item) => item.discussionSnapshot?.discussionId === source.id)).toBe(false)
  await failedAttach.getByRole('button', { name: 'Use saved state', exact: true }).click()
  await expect(failedAttach).toHaveCount(0)
  const afterRecovery = await session(page, sessionId)
  expect(afterRecovery.workspace?.attachments?.some((item) => item.discussionSnapshot?.discussionId === source.id)).toBe(false)
  expect(attachAttempts).toBe(1)

  await attachDiscussion(page, source.title)
  await expect.poll(async () => {
    const row = await session(page, sessionId)
    return row.workspace?.attachments?.find((item) => item.discussionSnapshot?.discussionId === source.id)?.discussionSnapshot?.text
  }, { message: 'a fresh explicit attach saves the readable copy after dismissal' }).toBe(source.text)
  const panel = await openDiscussionPanel(page, source.title)
  const savedText = panel.getByRole('textbox', { name: 'Saved discussion copy', exact: true })
  await expect(savedText).toHaveValue(source.text)

  const newPost = `Committed before lost acknowledgement ${randomUUID()}`
  const posted = await page.request.post(`${API}/discussions/${encodeURIComponent(source.id)}/posts`, { data: { body: newPost } })
  expect(posted.ok()).toBe(true)
  const refreshedSource = await page.request.get(`${API}/discussions/${encodeURIComponent(source.id)}`)
  expect(refreshedSource.ok()).toBe(true)
  const expectedText = discussionText(await refreshedSource.json() as DiscussionRow)
  const refreshBodies: Array<{ expectedSnapshotId: string; requestId: string }> = []
  let lostFirstResponse = true
  await page.route(`**/api/v1/sessions/${sessionId}/attachments/*/refresh`, async (route) => {
    refreshBodies.push(route.request().postDataJSON() as { expectedSnapshotId: string; requestId: string })
    if (lostFirstResponse) {
      lostFirstResponse = false
      const committed = await route.fetch()
      expect(committed.ok(), 'the first refresh reaches and commits at the server').toBe(true)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'The response was lost after commit.' } }),
      })
      return
    }
    await route.continue()
  })
  await page.getByRole('button', { name: 'Refresh copy', exact: false }).click()
  const failedRefresh = page.locator('[data-context-panel-status]').getByRole('alert').filter({ hasText: 'Couldn’t confirm the context update.' })
  await expect(failedRefresh).toContainText('response was lost after commit')
  await expect(failedRefresh.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await failedRefresh.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(failedRefresh).toHaveCount(0)
  expect(refreshBodies).toHaveLength(2)
  expect(refreshBodies[1]?.requestId).toBe(refreshBodies[0]?.requestId)
  const healedPanel = page.locator('[data-discussion-context-panel]').filter({ visible: true })
  await expect(healedPanel.getByRole('textbox', { name: 'Saved discussion copy', exact: true })).toHaveValue(expectedText)
  const durable = await session(page, sessionId)
  expect(durable.workspace?.attachments?.find((item) => item.discussionSnapshot?.discussionId === source.id)?.discussionSnapshot?.text).toBe(expectedText)
})

test('an existing conversation refreshes only by request and shares only its saved copy', async ({ page, browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  await useTenant(page, 'saved-copy')
  const source = await createDiscussion(page)
  const sessionId = await createSession(page)
  await page.setViewportSize(VIEWPORTS[4])
  await page.goto(`/s/${encodeURIComponent(sessionId)}`)
  await attachDiscussion(page, source.title)
  let persisted = await session(page, sessionId)
  let attachment = persisted.workspace?.attachments?.find((item) => item.discussionSnapshot)
  expect(attachment?.discussionSnapshot).toMatchObject({ discussionId: source.id, postCount: 1, text: source.text })
  const panel = await openDiscussionPanel(page, source.title)
  const savedText = panel.getByRole('textbox', { name: 'Saved discussion copy', exact: true })
  await expect(savedText).toHaveValue(source.text)

  const editedSource = `Source edited after capture ${randomUUID()}`
  const post = await page.request.post(`${API}/discussions/${encodeURIComponent(source.id)}/posts`, { data: { body: editedSource } })
  expect(post.ok(), 'the owner edits the source discussion').toBe(true)
  await expect.poll(async () => {
    const response = await page.request.get(`${API}/discussions/${encodeURIComponent(source.id)}`)
    if (!response.ok()) return false
    const current = await response.json() as DiscussionRow
    return current.posts.some((item) => item.body === editedSource)
  }, { message: 'the source edit is visible independently of the saved copy' }).toBe(true)
  await expect(savedText).toHaveValue(source.text)
  await expect(savedText).not.toHaveValue(new RegExp(editedSource))
  await expect.poll(async () => {
    const row = await session(page, sessionId)
    return row.workspace?.attachments?.find((item) => item.discussionSnapshot)?.discussionSnapshot?.text
  }).toBe(source.text)

  const refresh = page.getByRole('button', { name: 'Refresh copy', exact: false })
  await expect(refresh).toBeVisible()
  const refreshed = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes(`/sessions/${sessionId}/attachments/`) && response.url().endsWith('/refresh'),
    { timeout: ms(20_000) },
  )
  await refresh.click()
  expect((await refreshed).ok(), 'explicit Refresh saves the newly-readable source').toBe(true)
  const refreshedSource = await page.request.get(`${API}/discussions/${encodeURIComponent(source.id)}`)
  expect(refreshedSource.ok()).toBe(true)
  const expectedRefreshedText = discussionText(await refreshedSource.json() as DiscussionRow)
  await expect(savedText).toHaveValue(expectedRefreshedText)
  await expect.poll(async () => {
    const row = await session(page, sessionId)
    return row.workspace?.attachments?.find((item) => item.discussionSnapshot)?.discussionSnapshot?.text
  }, { message: 'Refresh commits the new complete transcript' }).toBe(expectedRefreshedText)

  // Cover both picker and saved panel at all canonical review dimensions. The
  // list stays sourced from readable discussions, a second unattached source
  // exercises the confirmation face, and the panel stays a bounded read-only
  // view of the selected immutable copy.
  const reviewSource = await createDiscussion(page)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settledAttachmentPreview(page, '[data-discussion-context-panel]')
    const overlay = page.locator('[data-overlay-dock]').filter({ visible: true })
    const overlayPanel = overlay.locator('[data-discussion-context-panel]').filter({ visible: true })
    if (await overlayPanel.count()) {
      const close = overlay.getByRole('button', { name: 'Close', exact: true })
      await expect(close, 'close the selected overlay panel before opening the composer picker').toBeVisible()
      await close.click()
      await expect(overlayPanel).toHaveCount(0)
    }
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
    await picker.getByRole('button', { name: /^Discussion/ }).click()
    await expect(picker.locator('[data-discussion-context-picker]')).toBeVisible()
    await assertViewportCell(page, testInfo, 'picker', viewport)
    await picker.locator('[data-discussion-context-picker]').getByRole('button', { name: reviewSource.title, exact: true }).click()
    await expect(picker.locator('[data-discussion-context-confirm]')).toBeVisible()
    await assertViewportCell(page, testInfo, 'confirm', viewport)
    await picker.locator('[data-discussion-context-confirm]').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(picker.locator('[data-discussion-context-picker]')).toBeVisible()
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(picker).toHaveCount(0)
    const selectedChip = discussionChip(page, source.title)
    if (!(await selectedChip.getAttribute('class'))?.includes('ring-accent')) await selectedChip.click()
    await waitForSelectedDiscussionPanel(page, source.title)
    await assertViewportCell(page, testInfo, 'panel', viewport)
  }

  await page.reload()
  const restoredPanel = await openDiscussionPanel(page, source.title)
  await expect(restoredPanel.getByRole('textbox', { name: 'Saved discussion copy', exact: true })).toHaveValue(expectedRefreshedText)
  persisted = await session(page, sessionId)
  attachment = persisted.workspace?.attachments?.find((item) => item.discussionSnapshot)
  expect(attachment?.discussionSnapshot?.text).toBe(expectedRefreshedText)

  const grant = await page.request.post(`${API}/grants`, { data: {
    subject: { kind: 'session', id: sessionId },
    audience: { kind: 'org', orgId: 'tenant-beta' },
    tier: 'view',
  } })
  expect(grant.ok(), 'the owner grants the conversation a read-only audience').toBe(true)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  try {
    const hiddenSource = await reader.page.request.get(`${API}/discussions/${encodeURIComponent(source.id)}`)
    expect(hiddenSource.status(), 'the shared reader cannot resolve the private source discussion').toBe(404)
    const sourceReads: string[] = []
    reader.page.on('request', (request) => {
      if (request.method() === 'GET' && new URL(request.url()).pathname === `${API}/discussions/${source.id}`) sourceReads.push(request.url())
    })
    await reader.page.setViewportSize(VIEWPORTS[4])
    await reader.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const readerPanel = await openDiscussionPanel(reader.page, source.title)
    await expect(readerPanel.getByRole('textbox', { name: 'Saved discussion copy', exact: true })).toHaveValue(expectedRefreshedText)
    await expect(reader.page.getByRole('button', { name: 'Refresh copy', exact: false })).toHaveCount(0)
    await expect(reader.page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)
    expect(sourceReads, 'opening a shared copy never resolves the source discussion').toHaveLength(0)
    for (const viewport of VIEWPORTS) {
      await reader.page.setViewportSize(viewport)
      await settledAttachmentPreview(reader.page, '[data-discussion-context-panel]')
      const readerChip = discussionChip(reader.page, source.title)
      if (!(await readerChip.getAttribute('class'))?.includes('ring-accent')) await readerChip.click()
      await waitForSelectedDiscussionPanel(reader.page, source.title)
      await assertViewportCell(reader.page, testInfo, 'reader-panel', viewport)
    }
  } finally {
    await reader.context.close()
  }

  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  try {
    const hidden = foreign.page.waitForResponse((response) =>
      response.url().includes(`/api/v1/sessions/${sessionId}`) && response.request().method() === 'GET',
      { timeout: ms(15_000) },
    )
    await foreign.page.goto(`/s/${encodeURIComponent(sessionId)}`)
    expect((await hidden).status(), 'an unrelated reader receives an existence-hiding 404').toBe(404)
    await expect(foreign.page.getByText(source.title, { exact: false })).toHaveCount(0)
  } finally {
    await foreign.context.close()
  }
})
