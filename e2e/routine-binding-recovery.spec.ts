/** Deleted Routine Agents retain their exact identity until explicit repair.
 * Creation, deletion, binding updates and execution use the normal routes. */
import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { DEFAULT_PROVIDER_ID, type Agent, type ScheduledTask, type ScheduleTemplate } from '../contract/index.ts'
import { SP_DEFAULT_ID } from '../server/data/prompts.ts'
import { newUser, openSection } from './social-helpers.ts'
import { assertWcag22Aa, settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'
import { ms } from './budget.ts'

const API = '/api/v1'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 1280, height: 800 },
] as const

async function routine(page: Page, id: string): Promise<ScheduledTask> {
  const response = await page.request.get(`${API}/schedules`)
  expect(response.ok(), await response.text()).toBe(true)
  const row = (await response.json() as ScheduledTask[]).find(candidate => candidate.id === id)
  expect(row, 'the test-owned Routine remains in its owner registry').toBeDefined()
  return row!
}

test('missing Routine Agent is explicit on mount and while editing, with owner-only repair across five viewports', async ({ browser }, info) => {
  test.setTimeout(ms(120_000))
  const stamp = randomUUID().slice(0, 10)
  const owner = await newUser(browser, { 'x-user-id': 'user-ada', 'x-tenant-id': `tenant-routine-agent-recovery-${stamp}` })
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const { page } = owner
  let releaseUpdate: (() => void) | undefined
  try {
    const createdAgent = await page.request.post(`${API}/agents`, {
      data: { label: `Removed Routine Agent ${stamp}`, providerId: DEFAULT_PROVIDER_ID, systemPromptId: SP_DEFAULT_ID, tools: [] },
    })
    expect(createdAgent.ok(), await createdAgent.text()).toBe(true)
    const agent = await createdAgent.json() as Agent
    const templates = await page.request.get(`${API}/schedule-templates`)
    expect(templates.ok()).toBe(true)
    const template = (await templates.json() as ScheduleTemplate[]).find(row => row.name === 'Blank recipe')
    expect(template, 'the fixture uses the ordinary tool-free blank Routine').toBeDefined()
    const createdRoutine = await page.request.post(`${API}/schedules`, {
      data: { seed: { ...template!.seed, name: `Routine Agent recovery ${stamp}`, enabled: false, runs: [], agentId: agent.id, providerId: DEFAULT_PROVIDER_ID } },
    })
    expect(createdRoutine.ok(), await createdRoutine.text()).toBe(true)
    const target = await createdRoutine.json() as ScheduledTask
    expect(target).toMatchObject({ agentId: agent.id, enabled: false, runs: [] })
    const grant = await page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'schedule', id: target.id }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(grant.ok(), await grant.text()).toBe(true)

    await page.goto(`/scheduled/${target.id}`)
    await openSection(page, 'Agent & model')
    const trigger = page.getByTitle('Change Agent, model & effort', { exact: true })
    await expect(trigger).toContainText(agent.label)
    await trigger.click()
    const picker = page.getByRole('dialog', { name: 'Model and effort', exact: true })
    const select = picker.getByLabel('Routine agent', { exact: true })
    await expect(select).toHaveValue(agent.id)

    // Deletion while the editor is already mounted exercises live eligibility,
    // not only useState's initialization after navigation.
    const removed = await page.request.delete(`${API}/agents/${agent.id}`, {
      headers: { 'Idempotency-Key': randomUUID() }, data: { expectedRevision: agent.revision ?? 0 },
    })
    expect(removed.ok(), await removed.text()).toBe(true)
    await expect(trigger).toContainText('Unavailable Agent')
    await expect(select).toHaveValue(agent.id)
    await expect(select.locator('option:checked')).toHaveText('Unavailable Agent')
    await expect(picker.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
    expect((await routine(page, target.id)).agentId).toBe(agent.id)
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.reload()
    await openSection(page, 'Agent & model')
    await expect(trigger).toHaveAttribute('data-routine-agent', agent.id)
    await expect(trigger).toHaveAttribute('data-routine-agent-state', 'unavailable')
    await expect(trigger).not.toContainText('Default agent')
    await trigger.click()
    await expect(select).toHaveValue(agent.id)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await settledNarrowRail(page)
      await select.scrollIntoViewIfNeeded()
      await expect(select).toBeInViewport()
      await expect(select.locator('option:checked')).toHaveText('Unavailable Agent')
      await expect(picker.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
      await settledOpaquePaint(picker)
      await expect.poll(async () => {
        const box = await picker.boundingBox()
        return !!box && box.x >= 7 && box.y >= 7 && box.x + box.width <= viewport.width - 7
          && box.y + box.height <= viewport.height - 7
          && await picker.evaluate(element => element.scrollWidth <= element.clientWidth)
      }).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await assertWcag22Aa(page, `missing Routine Agent ${viewport.width}x${viewport.height}`)
      await page.screenshot({ path: info.outputPath(`missing-agent-${viewport.width}x${viewport.height}.png`) })
    }

    // Explicit choice alone enables Apply; the complete binding remains held
    // under the existing acknowledgement ceremony until the route completes.
    await select.selectOption('agent-default')
    await expect(picker.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled()
    expect((await routine(page, target.id)).agentId).toBe(agent.id)
    let updateStarted!: () => void
    const started = new Promise<void>(resolve => { updateStarted = resolve })
    const held = new Promise<void>(resolve => { releaseUpdate = resolve })
    await page.route(`**${API}/schedules/${target.id}`, async route => {
      if (route.request().method() !== 'PATCH') return route.continue()
      expect(route.request().postDataJSON()).toMatchObject({ agentId: 'agent-default', providerId: DEFAULT_PROVIDER_ID })
      updateStarted()
      await held
      await route.continue()
    })
    await picker.getByRole('button', { name: 'Apply', exact: true }).click()
    await started
    await expect(select).toBeDisabled()
    await expect(select).toHaveValue('agent-default')
    await expect(picker.getByRole('button', { name: 'Applying…', exact: true })).toBeDisabled()
    releaseUpdate!()
    await expect(picker).toHaveCount(0)
    await expect(trigger).toHaveAttribute('data-routine-agent-state', 'available')
    await expect(trigger).toContainText('Default agent')
    expect((await routine(page, target.id)).agentId).toBe('agent-default')
    await page.getByRole('button', { name: 'Run now', exact: true }).click()
    await expect.poll(async () => (await routine(page, target.id)).runs[0]?.status, { timeout: ms(20_000) }).toBe('ok')
    expect((await routine(page, target.id)).runs[0]?.execution?.agentId).toBe('agent-default')

    await reader.page.goto(`/scheduled/${target.id}`)
    await expect(reader.page.getByRole('heading', { name: target.name, exact: true })).toBeVisible()
    await foreign.page.goto(`/scheduled/${target.id}`)
    await expect(foreign.page.locator('[data-resource-unavailable="missing"]')).toBeVisible()
    for (const viewport of VIEWPORTS) {
      for (const [actor, label] of [[reader, 'shared-reader'], [foreign, 'foreign']] as const) {
        await actor.page.setViewportSize(viewport)
        await settledNarrowRail(actor.page)
        await expect(actor.page.getByTitle('Change Agent, model & effort', { exact: true })).toHaveCount(0)
        await expect(actor.page.getByRole('button', { name: 'Run now', exact: true })).toHaveCount(0)
        await expect(actor.page.getByLabel('Routine agent', { exact: true })).toHaveCount(0)
        expect(await actor.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        await assertWcag22Aa(actor.page, `${label} Routine recovery ${viewport.width}x${viewport.height}`)
        await actor.page.screenshot({ path: info.outputPath(`${label}-${viewport.width}x${viewport.height}.png`) })
      }
    }
    await reader.page.goto(`/scheduled/${target.id}/model`)
    await expect(reader.page.getByText('This routine section is private to its owner.', { exact: true })).toBeVisible()
    expect((await foreign.page.request.patch(`${API}/schedules/${target.id}`, { data: { agentId: 'agent-default' } })).status()).toBe(404)
  } finally {
    releaseUpdate?.()
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})
