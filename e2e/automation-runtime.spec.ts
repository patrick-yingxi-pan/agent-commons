/** Rendered posture keeps real Dispatch execution separate from legacy
 * simulations and the independent standing-work fixture boundary. */
import { test, expect, type Page } from '@playwright/test'
import { join } from 'node:path'
import { DEFAULT_PROVIDER_ID, type DispatchRun, type OpenSubGoal, type Project } from '../contract/index.ts'
import { SP_DEFAULT_ID } from '../server/data/prompts.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { ms } from './budget.ts'
import { newUser, openSection } from './social-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]
const REVIEW_DIR = join(process.cwd(), '.data', 'automation-runtime-review')

const AVAILABLE_DISPATCH_NOTICE = 'Run a task with your chosen Agent and model. Open its private conversation to follow progress, review proposed actions, or continue the work. External tool calls need your approval.'
const UNAVAILABLE_DISPATCH_NOTICE = 'Dispatch execution is unavailable on this backend. Existing history is still readable.'
const UNKNOWN_DISPATCH_NOTICE = 'Dispatch availability could not be confirmed. No task can be started.'
const STANDING_UNAVAILABLE_NOTICE = 'Standing execution is not available. This setting is saved for coordination only; posted work stays open. It does not grant real unattended execution.'
const WORK_UNAVAILABLE_NOTICE = 'Posting adds this to the Project backlog. Standing execution is unavailable, so new work stays open until a real workflow handles it.'
const WORK_DEVELOPMENT_NOTICE = 'Posting adds this to the Project backlog. A standing contributor may simulate completion; no Agent or external tool runs.'

async function overrideAutomationCapability(page: Page, posture: 'false' | 'missing') {
  await page.route('**/api/v1/capabilities', async (route) => {
    const response = await route.fetch()
    const capabilities = await response.json() as { features: Record<string, unknown> }
    if (posture === 'false') capabilities.features.simulatedAutomation = false
    else delete capabilities.features.simulatedAutomation
    await route.fulfill({ response, body: JSON.stringify(capabilities) })
  })
}

async function overrideDispatchCapability(page: Page, posture: 'available' | 'unavailable' | 'unknown') {
  await page.route('**/api/v1/capabilities', async (route) => {
    const response = await route.fetch()
    const capabilities = await response.json() as { features: Record<string, unknown> }
    if (posture === 'unknown') delete capabilities.features.dispatchExecution
    else capabilities.features.dispatchExecution = posture === 'available'
    await route.fulfill({ response, body: JSON.stringify(capabilities) })
  })
}

async function selectDispatchBinding(page: Page, dialog: import('@playwright/test').Locator) {
  type AgentChoice = { id: string; providerId: string }
  type ProviderChoice = {
    id: string; kind?: string; execution?: string
    models: Array<{ id: string }>
  }
  const [agentsResponse, providersResponse] = await Promise.all([
    page.request.get('/api/v1/agents'), page.request.get('/api/v1/providers'),
  ])
  expect(agentsResponse.ok()).toBe(true)
  expect(providersResponse.ok()).toBe(true)
  const agents = await agentsResponse.json() as AgentChoice[]
  const providers = await providersResponse.json() as ProviderChoice[]
  const provider = providers.find((candidate) => candidate.id === DEFAULT_PROVIDER_ID &&
    candidate.kind !== 'session' && candidate.execution !== 'unconfigured' && candidate.models.length > 0)
  const choice = provider && { provider, agent: agents.find((candidate) => candidate.providerId === provider.id) }
  expect(choice?.agent, 'the API fixture exposes a compatible Agent and configured model connection').toBeTruthy()
  await dialog.getByRole("combobox", { name: "Agent", exact: true }).selectOption(choice!.agent!.id)
  await dialog.getByRole("combobox", { name: "Model connection", exact: true }).selectOption(choice!.provider.id)
  await dialog.getByRole("combobox", { name: "Model", exact: true }).selectOption(choice!.provider.models[0]!.id)
}

async function expectNoHorizontalOverflow(page: Page, width: number) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    `${width}px surface remains horizontally contained`).toBe(true)
}

async function capturePosture(
  page: Page,
  viewport: typeof VIEWPORTS[number],
  name: string,
  posture = page.locator('[data-automation-posture]'),
) {
  await page.setViewportSize(viewport)
  await expect(posture).toBeVisible()
  await expectNoHorizontalOverflow(page, viewport.width)
  await assertWcag22Aa(page, `${name} ${viewport.width}x${viewport.height}`)
  await page.screenshot({ path: join(REVIEW_DIR, `${viewport.width}x${viewport.height}-${name}.png`) })
}

async function expectRailDispatchUnavailable(page: Page) {
  const controls = page.locator('[data-composite-rail-controls="dispatch"]')
  await expect(controls).toBeVisible()
  await controls.getByRole('button', { name: 'Controls for Dispatch' }).click()
  const action = page.getByRole('menu', { name: 'Controls for Dispatch' })
    .getByRole('menuitem', { name: 'New dispatch (unavailable)', exact: true })
  await expect(action).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Controls for Dispatch' })).toHaveCount(0)
}

test('Dispatch page and explicit Agent/model form render across the viewport ladder', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await overrideDispatchCapability(page, 'available')
  await page.goto('/dispatch')
  await expect(page.getByRole('heading', { level: 1, name: 'Dispatch' })).toBeVisible()
  const pagePosture = page.locator('[data-dispatch-posture="available"]')
  await expect(pagePosture).toHaveText(AVAILABLE_DISPATCH_NOTICE)
  await expect(page.getByRole('button', { name: 'New dispatch', exact: true })).toBeEnabled()

  for (const viewport of VIEWPORTS) await capturePosture(page, viewport, 'dispatch-available', pagePosture)

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: 'New dispatch', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New dispatch', exact: true })
  await expect(dialog.locator('[data-dispatch-posture="available"]')).toHaveText(AVAILABLE_DISPATCH_NOTICE)
  const scopeNotice = dialog.getByText('Uses the selected Agent’s instructions and permitted workspace tools. No context is attached initially; open the conversation to add it or review actions.', { exact: true })
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await scopeNotice.scrollIntoViewIfNeeded()
    await expect(scopeNotice).toBeVisible()
    await expectNoHorizontalOverflow(page, viewport.width)
    await expect.poll(() => scopeNotice.evaluate((notice) => {
      const panel = notice.closest('[data-bounded-dialog]')!
      return notice.getBoundingClientRect().bottom - panel.lastElementChild!.getBoundingClientRect().top
    }), 'the scope disclosure remains reachable above the fixed footer').toBeLessThanOrEqual(1)
    await assertWcag22Aa(page, `Dispatch scope disclosure ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: join(REVIEW_DIR, `${viewport.width}x${viewport.height}-dispatch-scope.png`) })
  }
  await dialog.getByRole('textbox', { name: 'Task' }).fill('A real Dispatch with an explicit binding')
  await dialog.getByRole('textbox', { name: 'Detail' }).fill('The first turn stays private and continuable.')
  await selectDispatchBinding(page, dialog)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-dispatch-posture="available"]')).toHaveText(AVAILABLE_DISPATCH_NOTICE)
    await expectNoHorizontalOverflow(page, viewport.width)
    await assertWcag22Aa(page, `real Dispatch form ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: join(REVIEW_DIR, `${viewport.width}x${viewport.height}-dispatch-dialog.png`) })
    if (viewport.height === 390) {
      // The bounded body intentionally scrolls above a fixed footer. Prove the
      // explicit binding controls remain keyboard-reachable through the final
      // Model field, not hidden by that footer.
      await dialog.getByRole('textbox', { name: 'Task', exact: true }).focus()
      await page.keyboard.press('Tab')
      const detail = dialog.getByRole('textbox', { name: 'Detail' })
      await expect(detail).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole("combobox", { name: "Agent", exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole("combobox", { name: "Model connection", exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      const model = dialog.getByRole("combobox", { name: "Model", exact: true })
      await expect(model).toBeFocused()
      await model.scrollIntoViewIfNeeded()
      await expect.poll(() => model.evaluate((field) => {
        const panel = field.closest('[data-bounded-dialog]')!
        return field.getBoundingClientRect().bottom - panel.lastElementChild!.getBoundingClientRect().top
      }), 'the scrolled final Model field fits above the fixed footer').toBeLessThanOrEqual(1)
      await page.screenshot({ path: join(REVIEW_DIR, '844x390-dispatch-dialog-scrolled.png') })
    }
  }
})

test('unavailable Dispatch preserves readable history and distinguishes legacy simulations', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const historyResponse = await page.request.get('/api/v1/dispatch')
  expect(historyResponse.ok()).toBe(true)
  const history = await historyResponse.json() as DispatchRun[]
  const simulation = history.find((run) => run.execution === undefined)
  expect(simulation, 'the fixture includes legacy Dispatch history').toBeTruthy()
  expect(simulation!.execution).toBeUndefined()
  const title = simulation!.title
  await overrideDispatchCapability(page, 'unavailable')
  await page.goto('/dispatch')

  const unavailablePosture = page.locator('[data-dispatch-posture="unavailable"]')
  await expect(unavailablePosture).toHaveText(UNAVAILABLE_DISPATCH_NOTICE)
  await expect(page.getByRole('button', { name: 'New dispatch', exact: true })).toBeDisabled()
  const historyRow = page.locator('[data-resource-synopsis-row]')
    .filter({ has: page.getByText(title, { exact: true }) })
  await expect(historyRow).toBeVisible()
  await expect(historyRow).toContainText('Simulation')
  await expectRailDispatchUnavailable(page)
  await expect(page.getByRole('dialog', { name: 'New dispatch' })).toHaveCount(0)
  for (const viewport of VIEWPORTS) await capturePosture(page, viewport, 'dispatch-unavailable', unavailablePosture)
})

test('a missing Dispatch capability is unknown and cannot open New Dispatch', async ({ page }) => {
  await overrideDispatchCapability(page, 'unknown')
  await page.goto('/dispatch')
  await expect(page.locator('[data-dispatch-posture="unknown"]')).toHaveText(UNKNOWN_DISPATCH_NOTICE)
  await expect(page.getByRole('button', { name: 'New dispatch', exact: true })).toBeDisabled()
  await expectRailDispatchUnavailable(page)
  await expect(page.getByRole('dialog', { name: 'New dispatch' })).toHaveCount(0)
})

test('a failed capabilities response keeps Dispatch behind the fail-closed bootstrap', async ({ page }) => {
  await page.route('**/api/v1/capabilities', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'capabilities unavailable' }),
  }))
  await page.goto('/dispatch')
  const bootstrap = page.getByTestId('app-bootstrap')
  await expect(bootstrap).toHaveAttribute('data-bootstrap-state', 'error')
  await expect(bootstrap.getByRole('alert')).toContainText('Couldn’t open Agent Commons')
  await expect(page.getByRole('button', { name: 'New dispatch', exact: true })).toHaveCount(0)
})

test('Project Open work and contributor editing disclose simulation limits across account roles', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const reader = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const foreign = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  for (const user of [owner, reader, foreign]) user.page.setDefaultTimeout(ms(15_000))

  const stamp = Date.now().toString(36)
  const projectName = `Automation posture ${stamp}`
  const workLabel = `Keep this item open ${stamp}`
  const agentLabel = `Posture contributor ${stamp}`
  try {
    const created = await owner.page.request.post('/api/v1/projects', {
      data: { name: projectName, description: 'A test-owned Project for automation posture.' },
    })
    expect(created.ok()).toBe(true)
    const project = (await created.json() as { project: Project }).project

    // Acquire the ordinary guardian namespace, then close public discovery.
    // Unsharing retains coordination; only the explicit Grace grant below
    // remains. A public Project would correctly be readable by Maya too.
    for (const shared of [true, false]) {
      const response = await owner.page.request.post('/api/v1/relations/ops', {
        data: { op: { kind: 'share-project', projectId: project.id, projectName: project.name, shared } },
      })
      expect(response.ok()).toBe(true)
    }
    const grant = await owner.page.request.post('/api/v1/grants', {
      data: {
        subject: { kind: 'project', id: project.id },
        audience: { kind: 'org', orgId: 'tenant-beta' },
        tier: 'view',
      },
    })
    expect(grant.ok()).toBe(true)

    const agentResponse = await owner.page.request.post('/api/v1/agents', {
      data: { label: agentLabel, providerId: DEFAULT_PROVIDER_ID, systemPromptId: SP_DEFAULT_ID },
    })
    expect(agentResponse.ok()).toBe(true)
    const agent = await agentResponse.json() as { id: string }
    const commissioned = await owner.page.request.post('/api/v1/commissions', {
      data: { agentId: agent.id, projectId: project.id, role: 'writer', standing: false },
    })
    expect(commissioned.ok()).toBe(true)
    expect((await commissioned.json() as { standing?: boolean }).standing ?? false).toBe(false)

    const posted = await owner.page.request.post(`/api/v1/projects/${encodeURIComponent(project.id)}/open-subgoals`, {
      data: { subGoal: workLabel, type: 'charge', target: 'budget:demo', note: 'No standing volunteer is enabled.' },
    })
    expect(posted.ok()).toBe(true)
    expect((await posted.json() as OpenSubGoal).status).toBe('open')

    // This is a presentation-only release posture override. The server work item
    // remains open because the test-owned commission is explicitly non-standing.
    await overrideAutomationCapability(owner.page, 'false')
    const projectPath = `/projects/${encodeURIComponent(project.id)}`
    await owner.page.goto(projectPath)
    await expect(owner.page.getByRole('heading', { name: projectName, exact: true })).toBeVisible()
    await openSection(owner.page, 'Open work')
    const ownerOpenWork = owner.page.locator('section.group\\/section')
      .filter({ has: owner.page.locator('[data-section-title]', { hasText: /^Open work$/ }) })
    const unavailableWorkNotice = ownerOpenWork.locator('[data-automation-posture="unavailable"]')
    await expect(unavailableWorkNotice).toHaveText(WORK_UNAVAILABLE_NOTICE)
    await expect(ownerOpenWork.getByText(workLabel, { exact: true })).toBeVisible()
    for (const viewport of VIEWPORTS) {
      await capturePosture(owner.page, viewport, `project-open-work-unavailable-${viewport.width}`, unavailableWorkNotice)
    }

    await openSection(owner.page, 'Contributors')
    const contributorLabel = owner.page.getByText(agentLabel, { exact: true })
    await expect(contributorLabel).toBeVisible()
    const contributorRow = contributorLabel.locator('xpath=../../..')
    await contributorRow.getByRole('button', { name: 'Edit', exact: true }).click()
    const editor = owner.page.getByRole('dialog', { name: 'Edit contributor' })
    const standingNotice = editor.locator('[data-automation-posture="unavailable"]')
    await expect(standingNotice).toHaveText(STANDING_UNAVAILABLE_NOTICE)
    await expect(editor.getByText('Standing', { exact: true })).toBeVisible()
    for (const viewport of VIEWPORTS) {
      await capturePosture(owner.page, viewport, `commission-editor-unavailable-${viewport.width}`, standingNotice)
      if (viewport.height === 390) {
        await standingNotice.scrollIntoViewIfNeeded()
        expect(await standingNotice.evaluate((notice) => {
          const panel = notice.closest('[data-bounded-dialog]')!
          const rect = notice.getBoundingClientRect()
          return rect.bottom <= panel.lastElementChild!.getBoundingClientRect().top
            && rect.top >= panel.firstElementChild!.getBoundingClientRect().bottom
        })).toBe(true)
        await owner.page.screenshot({ path: join(REVIEW_DIR, '844x390-commission-editor-scrolled.png') })
      }
    }
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(editor).toHaveCount(0)

    // Grace sees the same open backlog under the development fixture posture,
    // but cannot edit Ada's contributor configuration.
    await reader.page.goto(projectPath)
    await expect(reader.page.getByRole('heading', { name: projectName, exact: true })).toBeVisible()
    await openSection(reader.page, 'Open work')
    const readerOpenWork = reader.page.locator('section.group\\/section')
      .filter({ has: reader.page.locator('[data-section-title]', { hasText: /^Open work$/ }) })
    const developmentWorkNotice = readerOpenWork.locator('[data-automation-posture="fixture"]')
    await expect(developmentWorkNotice).toHaveText(WORK_DEVELOPMENT_NOTICE)
    await expect(readerOpenWork.getByText(workLabel, { exact: true })).toBeVisible()
    for (const viewport of VIEWPORTS) {
      await capturePosture(reader.page, viewport, `project-open-work-reader-${viewport.width}`, developmentWorkNotice)
    }

    await openSection(reader.page, 'Contributors')
    const readerContributors = reader.page.locator('section.group\\/section')
      .filter({ has: reader.page.locator('[data-section-title]', { hasText: /^Contributors$/ }) })
    // The Project grant does not expose the owner's private Agent definition.
    await expect(reader.page.getByText(agentLabel, { exact: true })).toHaveCount(0)
    await expect(readerContributors.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
    await expect(reader.page.getByRole('dialog', { name: 'Edit contributor' })).toHaveCount(0)

    await foreign.page.goto(projectPath)
    await expect(foreign.page.locator('[data-resource-unavailable="missing"]')).toBeVisible()
    await expect(foreign.page.getByText('This project isn’t visible from this account (or no longer exists).')).toBeVisible()
    await expect(foreign.page.getByRole('heading', { name: projectName, exact: true })).toHaveCount(0)
    await expect(foreign.page.getByText(workLabel, { exact: true })).toHaveCount(0)
    await expect(foreign.page.locator('[data-automation-posture]')).toHaveCount(0)
    await foreign.page.screenshot({ path: testInfo.outputPath('foreign-project-unavailable.png') })
  } finally {
    await Promise.allSettled([owner.context.close(), reader.context.close(), foreign.context.close()])
  }
})
