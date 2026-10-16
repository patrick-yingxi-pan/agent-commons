/** Agent detail pages open the ordinary unsent conversation draft. */
import { randomUUID } from 'node:crypto'
import { test, expect, type Locator, type Page } from '@playwright/test'
import type { Agent, ArtifactItem } from '../contract/index.ts'
import { newUser, gotoSection, API } from './social-helpers.ts'
import { assertWcag22Aa, settledNarrowRail } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { clearAutoPanel, splitPane } from './pane-actions.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const

async function makePrivateAgent(page: Page, label: string) {
  const [providersResponse, promptsResponse] = await Promise.all([
    page.request.get(`${API}/providers`), page.request.get(`${API}/system-prompts`),
  ])
  expect(providersResponse.ok()).toBe(true)
  expect(promptsResponse.ok()).toBe(true)
  const providers = await providersResponse.json() as { id: string; isDefault?: boolean }[]
  const prompts = await promptsResponse.json() as { id: string; isDefault?: boolean }[]
  const providerId = (providers.find(row => row.isDefault) ?? providers[0])!.id
  const systemPromptId = (prompts.find(row => row.isDefault) ?? prompts[0])!.id
  const response = await page.request.post(`${API}/agents`, {
    data: { label, providerId, systemPromptId, tools: [], instructions: 'A private test Agent.' },
    headers: { 'Idempotency-Key': `agent-conversation-${randomUUID()}` },
  })
  expect(response.ok(), `private Agent fixture: ${await response.text()}`).toBe(true)
  return await response.json() as Agent
}

async function makeArtifact(page: Page, name: string) {
  const response = await page.request.post(`${API}/artifacts`, {
    data: { name, kind: 'doc', body: `Unsent context ${randomUUID()}` },
    headers: { 'Idempotency-Key': `agent-conversation-artifact-${randomUUID()}` },
  })
  expect(response.ok(), `draft context fixture: ${await response.text()}`).toBe(true)
  return ((await response.json()) as { artifact: ArtifactItem }).artifact
}

async function assertContained(page: Page, target: Locator, viewport: { width: number; height: number }, label: string) {
  await expect.poll(async () => {
    const box = await target.boundingBox()
    return !!box && box.width > 0 && box.height > 0 && box.x >= 6 && box.y >= 6 &&
      box.x + box.width <= viewport.width - 6 && box.y + box.height <= viewport.height - 6 &&
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  }, { message: `${label} fits ${viewport.width}×${viewport.height} without page overflow` }).toBe(true)
}

test('a built-in Agent detail opens an inherited blank draft and keeps a pane-local Back door', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const user = await newUser(browser, {
    'x-user-id': `user-agent-launch-built-in-${randomUUID().slice(0, 8)}`,
    'x-tenant-id': `tenant-agent-launch-built-in-${randomUUID().slice(0, 8)}`,
  })
  let sessionPosts = 0
  user.page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/sessions`) sessionPosts += 1
  })
  try {
    const agentsResponse = await user.page.request.get(`${API}/agents`)
    expect(agentsResponse.ok()).toBe(true)
    const agents = await agentsResponse.json() as Agent[]
    const builtin = agents.find(agent => !agent.tenantId)
    expect(builtin, 'the workspace has its seeded built-in Agent').toBeTruthy()
    // Open the canonical Agent page in a second pane, then verify Back returns
    // only that pane to its origin while the first pane remains untouched.
    await user.page.goto('/')
    await user.page.setViewportSize({ width: 1280, height: 800 })
    const expandSidebar = user.page.getByRole('button', { name: 'Expand sidebar', exact: true })
    if (await expandSidebar.isVisible()) await expandSidebar.click()
    await user.page.getByRole('textbox', { name: 'Message', exact: true }).click()
    await splitPane(user.page, 'right')
    const paneA = user.page.locator('[data-main-pane="a"]')
    const paneB = user.page.locator('[data-main-pane="b"]')
    await expect(paneA.locator('[data-conversation-pane="draft"]')).toBeVisible()
    await expect(paneB.locator('[data-conversation-pane="draft"]')).toBeVisible()
    await gotoSection(user.page, 'Agents')
    const sections = user.page.getByRole('navigation', { name: 'Sections' })
    const expandAgents = sections.getByRole('button', { name: 'Expand Agents', exact: true })
    if (await expandAgents.count()) await expandAgents.click()
    await sections.getByRole('button', { name: 'Ready agents', exact: true }).click()
    await paneB.getByRole('button', { name: builtin!.label, exact: true }).click()
    await expect(user.page).toHaveURL(new RegExp(`/agents/${encodeURIComponent(builtin!.id)}$`))
    await expect(paneB.getByRole('heading', { name: builtin!.label, exact: true })).toBeVisible()
    const start = paneB.getByRole('button', { name: 'New conversation', exact: true })
    await expect(start).toBeVisible()
    await start.click()
    await expect(paneB.locator('[data-conversation-pane="draft"]')).toBeVisible()
    await expect(user.page.getByRole('button', { name: `Back to ${builtin!.label}`, exact: true })).toBeVisible()
    const paneBPickerTrigger = paneB.getByRole('button', { name: 'Model and effort', exact: true }).last()
    await paneBPickerTrigger.click()
    await expect(paneB.getByRole('dialog', { name: 'Model and effort', exact: true })
      .getByRole('combobox', { name: 'Conversation Agent', exact: true })).toHaveValue(builtin!.id)
    await user.page.keyboard.press('Escape')
    expect(sessionPosts).toBe(0)
    await expect(paneA.locator('[data-conversation-pane="draft"]')).toBeVisible()
    await expect(paneB.locator('[data-conversation-pane="draft"]')).toBeVisible()
    await paneB.getByRole('button', { name: `Back to ${builtin!.label}`, exact: true }).click()
    await expect(user.page).toHaveURL(new RegExp(`/agents/${encodeURIComponent(builtin!.id)}$`))
    await expect(paneB.getByRole('button', { name: 'New conversation', exact: true })).toBeVisible()
    await expect(paneA.locator('[data-conversation-pane="draft"]')).toBeVisible()
  } finally {
    await user.context.close()
  }
})

test('a private Agent launch reviews replacing shared unsent text, context, and selection', async ({ browser }, info) => {
  test.setTimeout(ms(150_000))
  const stamp = randomUUID().slice(0, 8)
  const user = await newUser(browser, {
    'x-user-id': `user-agent-launch-private-${stamp}`,
    'x-tenant-id': `tenant-agent-launch-private-${stamp}`,
  })
  let sessionPosts = 0
  user.page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/sessions`) sessionPosts += 1
  })
  try {
    const agent = await makePrivateAgent(user.page, `Private launch ${stamp}`)
    const artifact = await makeArtifact(user.page, `Unsent launch context ${stamp}`)
    const builtinResponse = await user.page.request.get(`${API}/agents`)
    expect(builtinResponse.ok()).toBe(true)
    const builtin = (await builtinResponse.json() as Agent[]).find(row => !row.tenantId)!

    await user.page.goto('/')
    await user.page.getByRole('textbox', { name: 'Message', exact: true }).fill(`Keep this unsent request ${stamp}`)
    await user.page.getByRole('button', { name: 'Add context', exact: true }).click()
    const contextDialog = user.page.getByRole('dialog', { name: 'Add context', exact: true })
    await contextDialog.getByRole('button', { name: /^Artifact/ }).click()
    const row = contextDialog.locator('[data-artifact-context-picker]').getByRole('button', { name: artifact.name, exact: true })
    await expect(row).toBeVisible()
    await row.click()
    const confirmation = contextDialog.locator('[data-artifact-context-confirm]')
    await confirmation.getByRole('button', { name: 'Add to draft', exact: true }).click()
    await contextDialog.getByRole('button', { name: 'Done', exact: true }).click()

    const pickerTrigger = user.page.getByRole('button', { name: 'Model and effort', exact: true }).last()
    await pickerTrigger.click()
    const picker = user.page.getByRole('dialog', { name: 'Model and effort', exact: true })
    await picker.getByRole('combobox', { name: 'Conversation Agent', exact: true }).selectOption(builtin.id)
    await user.page.keyboard.press('Escape')
    const paneA = user.page.locator('[data-main-pane="a"]')
    await expect(paneA.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(`Keep this unsent request ${stamp}`)
    const contextChip = paneA.getByTitle('Open in sidebar').filter({ hasText: artifact.name }).filter({ visible: true })
    await expect(contextChip).toBeVisible()

    // Keep the saved-but-unsubmitted draft in pane A while pane B opens the
    // Agent detail. Artifact review can temporarily create its own context pane;
    // settle that before explicitly creating the second main pane.
    await clearAutoPanel(user.page)
    await user.page.setViewportSize({ width: 1280, height: 800 })
    const expandSidebar = user.page.getByRole('button', { name: 'Expand sidebar', exact: true })
    if (await expandSidebar.isVisible()) await expandSidebar.click()
    await user.page.getByRole('textbox', { name: 'Message', exact: true }).click()
    await splitPane(user.page, 'right')
    const paneB = user.page.locator('[data-main-pane="b"]')
    await expect(paneB.locator('[data-conversation-pane="draft"]')).toBeVisible()

    // Navigate the real rail hierarchy in pane B without remounting pane A's draft.
    await gotoSection(user.page, 'Agents')
    await expect(user.page).toHaveURL(/\/agents$/)
    const nav = user.page.getByRole('navigation', { name: 'Sections' })
    const expand = nav.getByRole('button', { name: 'Expand Agents', exact: true })
    if (await expand.count()) await expand.click()
    await nav.getByRole('button', { name: 'Ready agents', exact: true }).click()
    await expect(user.page).toHaveURL(/\/agents\/ready-agents$/)
    await paneB.getByRole('button', { name: agent.label, exact: true }).click()
    await expect(user.page).toHaveURL(new RegExp(`/agents/${encodeURIComponent(agent.id)}$`))
    await expect(paneB.getByRole('button', { name: 'New conversation', exact: true })).toBeVisible()

    // Review the page and confirmation at every supported width/height. In the
    // short landscape case, dialog content may scroll internally but the frame
    // and its confirmation controls must remain within the viewport.
    for (const viewport of VIEWPORTS) {
      await user.page.setViewportSize(viewport)
      await settledNarrowRail(user.page)
      await paneB.dispatchEvent('pointerdown')
      await expect(paneB).toHaveAttribute('data-focused', 'true')
      const start = paneB.getByRole('button', { name: 'New conversation', exact: true })
      await start.scrollIntoViewIfNeeded()
      await assertContained(user.page, start, viewport, 'Agent detail launch action')
      const publicDoors = paneB.locator('[data-public-face-door]')
      expect(await publicDoors.count()).toBeGreaterThanOrEqual(2)
      for (const door of await publicDoors.all()) {
        const box = await door.boundingBox()
        expect(box?.height).toBeGreaterThanOrEqual(24)
        expect(box?.width).toBeGreaterThanOrEqual(24)
      }
      await user.page.screenshot({ path: info.outputPath(`agent-detail-${viewport.width}x${viewport.height}.png`) })
      if (viewport.width === 320) await assertWcag22Aa(user.page, 'Agent detail launch page at 320px')
      if (viewport.width === 1280) await assertWcag22Aa(user.page, 'Agent detail launch page at 1280px')

      await start.click()
      const replace = user.page.getByRole('dialog', { name: 'Replace current draft?', exact: true })
      await expect(replace).toContainText('including its message and attached context')
      const confirmSurface = replace.locator('[data-bounded-dialog="confirm"]')
      await assertContained(user.page, confirmSurface, viewport, 'Replace-current-draft confirmation surface')
      for (const label of ['Cancel', 'Replace draft']) {
        const control = confirmSurface.getByRole('button', { name: label, exact: true })
        await control.scrollIntoViewIfNeeded()
        await expect(control).toBeInViewport()
      }
      await user.page.screenshot({ path: info.outputPath(`agent-replace-confirm-${viewport.width}x${viewport.height}.png`) })
      if (viewport.width === 320) await assertWcag22Aa(user.page, 'draft replacement confirmation at 320px')
      if (viewport.width === 1280) await assertWcag22Aa(user.page, 'draft replacement confirmation at 1280px')
      await user.page.keyboard.press('Escape')
      await expect(replace).toHaveCount(0)
    }

    // Explicit cancellation and Escape are both inert; Replace is the only
    // path that discards the shared draft and changes its inherited Agent.
    await user.page.setViewportSize({ width: 1280, height: 800 })
    await paneB.dispatchEvent('pointerdown')
    await expect(paneB).toHaveAttribute('data-focused', 'true')
    await expect(paneA.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(`Keep this unsent request ${stamp}`)
    await expect(paneA.getByTitle('Open in sidebar').filter({ hasText: artifact.name }).filter({ visible: true })).toBeVisible()
    const start = paneB.getByRole('button', { name: 'New conversation', exact: true })
    await start.click()
    let replace = user.page.getByRole('dialog', { name: 'Replace current draft?', exact: true })
    await replace.locator('[data-bounded-dialog="confirm"]').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(replace).toHaveCount(0)
    await expect(paneA.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(`Keep this unsent request ${stamp}`)
    await expect(paneA.getByTitle('Open in sidebar').filter({ hasText: artifact.name }).filter({ visible: true })).toBeVisible()
    await start.click()
    replace = user.page.getByRole('dialog', { name: 'Replace current draft?', exact: true })
    await user.page.keyboard.press('Escape')
    await expect(replace).toHaveCount(0)
    await expect(paneA.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(`Keep this unsent request ${stamp}`)
    await expect(paneA.getByTitle('Open in sidebar').filter({ hasText: artifact.name }).filter({ visible: true })).toBeVisible()

    await start.click()
    replace = user.page.getByRole('dialog', { name: 'Replace current draft?', exact: true })
    await replace.locator('[data-bounded-dialog="confirm"]').getByRole('button', { name: 'Replace draft', exact: true }).click()
    await expect(replace).toHaveCount(0)
    await expect(paneB.locator('[data-conversation-pane="draft"]')).toBeVisible()
    await expect(paneA.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('')
    await expect(paneA.getByTitle('Open in sidebar').filter({ hasText: artifact.name }).filter({ visible: true })).toHaveCount(0)
    await expect(paneB.getByRole('button', { name: `Back to ${agent.label}`, exact: true })).toBeVisible()
    const paneBPickerTrigger = paneB.getByRole('button', { name: 'Model and effort', exact: true }).last()
    await paneBPickerTrigger.click()
    await expect(paneB.getByRole('dialog', { name: 'Model and effort', exact: true })
      .getByRole('combobox', { name: 'Conversation Agent', exact: true })).toHaveValue(agent.id)
    await user.page.keyboard.press('Escape')
    expect(sessionPosts).toBe(0)
    await paneB.getByRole('button', { name: `Back to ${agent.label}`, exact: true }).click()
    await expect(user.page).toHaveURL(new RegExp(`/agents/${encodeURIComponent(agent.id)}$`))
    await expect(paneB.getByRole('button', { name: 'New conversation', exact: true })).toBeVisible()
    await expect(paneA.locator('[data-conversation-pane="draft"]')).toBeVisible()
  } finally {
    await user.context.close()
  }
})

test('a published foreign Agent can be forked but cannot start a conversation before the fork', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const stamp = randomUUID().slice(0, 8)
  const owner = await newUser(browser, {
    'x-user-id': `user-agent-launch-publisher-${stamp}`,
    'x-tenant-id': `tenant-agent-launch-publisher-${stamp}`,
  })
  const visitor = await newUser(browser, {
    'x-user-id': `user-agent-launch-visitor-${stamp}`,
    'x-tenant-id': `tenant-agent-launch-visitor-${stamp}`,
  })
  let sessionPosts = 0
  visitor.page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `${API}/sessions`) sessionPosts += 1
  })
  try {
    const source = await makePrivateAgent(owner.page, `Published source ${stamp}`)
    const publishedResponse = await owner.page.request.patch(`${API}/agents/${encodeURIComponent(source.id)}`, {
      data: { published: true, expectedRevision: source.revision },
    })
    expect(publishedResponse.ok(), `publish source: ${await publishedResponse.text()}`).toBe(true)
    await visitor.page.goto(`/agents/${encodeURIComponent(source.id)}`)
    await expect(visitor.page.getByRole('heading', { name: source.label, exact: true })).toBeVisible()
    await expect(visitor.page.getByRole('button', { name: 'Fork agent', exact: true })).toBeVisible()
    await expect(visitor.page.getByRole('button', { name: 'New conversation', exact: true })).toHaveCount(0)
    expect(sessionPosts).toBe(0)
  } finally {
    await Promise.all([owner.context.close(), visitor.context.close()])
  }
})
