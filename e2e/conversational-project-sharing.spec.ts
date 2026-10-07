/** Consent-driven project sharing proposed in a conversation. */
import { test, expect, type Page } from '@playwright/test'
import type { RelationGraph, Session } from '../contract/index.ts'
import { API, createProject, newUser } from './social-helpers.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

async function createSession(page: Page, stamp: string) {
  const response = await page.request.post(`${API}/sessions`, {
    data: { firstMessage: `Project sharing consent ${stamp}`, persistFirstMessage: true },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return await response.json() as Session
}

async function propose(page: Page, sessionId: string, text: string, key: string) {
  const response = await page.request.post(`${API}/sessions/${sessionId}/messages`, {
    data: { text },
    headers: { 'Idempotency-Key': key },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  await response.body()
}

function proposal(page: Page, name: string) {
  return page.locator('[data-relation-action-key]').filter({ hasText: name })
}

async function projectState(page: Page, name: string) {
  const graph = await (await page.request.get(`${API}/relations`)).json() as RelationGraph
  const project = graph.extraProjects.find((item) => item.name === name)
  expect(project, `test-owned project ${name} exists`).toBeTruthy()
  return project!
}

test('conversation consent shares and unshares only an owner project', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const stamp = Date.now().toString(36)
  const name = `Cross-team launch planning and research handoff ${stamp}`

  try {
    await owner.page.goto('/')
    await createProject(owner.page, name)
    const project = await projectState(owner.page, name)
    const session = await createSession(owner.page, stamp)

    // Declining the proposal is an explicit no-op; a later proposal can still
    // be considered independently in the same owner conversation.
    await propose(owner.page, session.id, `Share the project "${name}".`, `share-decline-${stamp}`)
    await owner.page.goto(`/s/${session.id}`)
    let card = proposal(owner.page, name)
    await expect(card.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible({ timeout: ms(20_000) })
    await card.getByRole('button', { name: 'Not now', exact: true }).click()
    await expect(card).toContainText('Not now — nothing changed')
    expect((await projectState(owner.page, name)).shared === true).toBe(false)

    await propose(owner.page, session.id, `Share the project "${name}".`, `share-confirm-${stamp}`)
    await owner.page.reload()
    card = proposal(owner.page, name).last()
    await expect(card.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(card).toContainText('Others can discover this Project and contribute their own agents; private conversations and context stay private.')
    expect((await projectState(owner.page, name)).shared === true).toBe(false)

    // The pending owner consent stays reachable, contained, and accessible at
    // all five canonical viewport sizes.
    for (const viewport of VIEWPORTS) {
      await owner.page.setViewportSize(viewport)
      await settleArtifactPageRail(owner.page)
      await card.scrollIntoViewIfNeeded()
      await expect(card.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
      await card.getByRole('button', { name: 'Confirm', exact: true }).click({ trial: true })
      await expect.poll(() => owner.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await assertWcag22Aa(owner.page, `Project share consent at ${viewport.width}x${viewport.height}`)
      await owner.page.screenshot({ path: testInfo.outputPath(`project-share-consent-${viewport.width}x${viewport.height}.png`) })
    }

    await card.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(card).toContainText('Shared')
    await expect.poll(async () => (await projectState(owner.page, name)).shared).toBe(true)

    // The verdict belongs to conversation history and survives both a reload
    // and opening the canonical conversation address directly.
    await owner.page.reload()
    await expect(proposal(owner.page, name).last()).toContainText('Shared')
    await owner.page.goto(`/s/${session.id}`)
    const recorded = proposal(owner.page, name).last()
    await expect(recorded.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0)
    await expect(recorded.getByRole('button', { name: 'Not now', exact: true })).toHaveCount(0)
    await expect(recorded).toContainText('Shared')
    await expect(proposal(owner.page, name).first()).toHaveAttribute('data-relation-action-verdict', 'skipped')
    await expect(proposal(owner.page, name).first()).toContainText('Not now — nothing changed')

    // The shared project is discoverable to its reader, while the owner’s
    // session and consent controls remain tenant private.
    await reader.page.goto(`/projects/${project.id}`)
    await expect(reader.page.getByRole('heading', { name })).toBeVisible({ timeout: ms(20_000) })
    await expect(reader.page.getByTestId('share-toggle')).toHaveCount(0)
    const readerSession = await reader.page.request.get(`${API}/sessions/${session.id}`)
    expect(readerSession.status(), 'a reader cannot load the owner consent conversation').toBe(404)

    const foreignSession = await foreign.page.request.get(`${API}/sessions/${session.id}`)
    expect(foreignSession.status(), 'a foreign tenant cannot load the owner consent conversation').toBe(404)

    // Private reversal is another explicit proposal and consent decision.
    await propose(owner.page, session.id, `Unshare the project "${name}".`, `unshare-confirm-${stamp}`)
    await owner.page.goto(`/s/${session.id}`)
    const privateCard = proposal(owner.page, name).last()
    await expect(privateCard.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible({ timeout: ms(20_000) })
    await expect(privateCard).toContainText('Public discovery and cross-account contributions stop; existing audience grants and their permissions stay unchanged.')
    const grant = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'session', id: session.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(grant.ok(), await grant.text()).toBeTruthy()
    await reader.page.goto(`/s/${session.id}`)
    await expect(reader.page.getByRole('heading', { name: session.title, exact: true })).toBeVisible()
    const readerCard = proposal(reader.page, name).last()
    await expect(proposal(reader.page, name).first()).toHaveAttribute('data-relation-action-verdict', 'skipped')
    await expect(proposal(reader.page, name).first()).toContainText('Not now — nothing changed')
    await expect(readerCard).toHaveAttribute('data-relation-action-owner', 'false')
    await expect(readerCard).toContainText('Only the conversation owner can approve or decline this change.')
    for (const viewport of VIEWPORTS) {
      await reader.page.setViewportSize(viewport)
      await settleArtifactPageRail(reader.page)
      await readerCard.scrollIntoViewIfNeeded()
      await expect(readerCard.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0)
      await expect(readerCard.getByRole('button', { name: 'Not now', exact: true })).toHaveCount(0)
      await expect.poll(() => reader.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await assertWcag22Aa(reader.page, `Project private consent reader at ${viewport.width}x${viewport.height}`)
      await reader.page.screenshot({ path: testInfo.outputPath(`project-share-reader-${viewport.width}x${viewport.height}.png`) })
    }
    await privateCard.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(privateCard).toContainText('Stopped public sharing')
    await expect.poll(async () => (await projectState(owner.page, name)).shared).toBe(false)
    await reader.page.goto(`/projects/${project.id}`)
    await expect(reader.page.locator('[data-resource-unavailable="missing"]')).toBeVisible()
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})
