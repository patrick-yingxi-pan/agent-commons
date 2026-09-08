/** Project visibility, public prose, and directed grants reconcile through the
 * live browser stream without reloads. */
import { test, expect } from '@playwright/test'
import { API, newUser, openSection } from './social-helpers.ts'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

/** Wait for the ambient stream's hello before cross-context mutations; socket-
 * open alone does not establish that the subscription is ready. The app owns
 * identity validation independently of this readiness probe. */
async function installHelloProbe(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const Native = window.EventSource
    class Wrapped extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init)
        this.addEventListener('message', (event) => {
          try {
            if ((JSON.parse(event.data) as { type?: string }).type === 'hello') {
              ;(window as Window & { __agentCommonsHello?: boolean }).__agentCommonsHello = true
            }
          } catch {
            // The application owns malformed-frame handling; the probe only waits for hello.
          }
        })
      }
    }
    window.EventSource = Wrapped
  })
}

async function waitForHello(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => (window as Window & { __agentCommonsHello?: boolean }).__agentCommonsHello === true,
    undefined,
    { timeout: ms(15_000) },
  )
}

async function waitForCollapsedRail(page: import('@playwright/test').Page) {
  await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeVisible()
  // Visibility does not account for the old rail's width transition. Measure
  // its actual clipping ancestor before capturing a newly resized viewport.
  await expect.poll(() => page.locator('button[aria-label="Collapse sidebar"]').evaluate(
    (button) => button.closest('[inert]')?.getBoundingClientRect().width ?? -1,
  )).toBe(0)
}

async function applyRelation(page: import('@playwright/test').Page, op: Record<string, unknown>) {
  const response = await page.request.post(`${API}/relations/ops`, {
    data: { op },
    headers: { 'Idempotency-Key': `project-live-sync-${Date.now()}-${Math.random()}` },
  })
  expect(response.ok()).toBeTruthy()
}

const about = (page: import('@playwright/test').Page, description: string) => {
  const section = page
    .locator('section.group\\/section')
    .filter({ has: page.locator('[data-section-title]', { hasText: /^About$/ }) })
  return section.locator('p', { hasText: description })
}

async function openBrowse(page: import('@playwright/test').Page) {
  await page.goto('/commons/browse')
  await waitForHello(page)
  await expect(page.getByRole('main').getByRole('heading', { name: 'Commons · Browse the Commons', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Search shared projects', exact: true })).toBeVisible()
}

function projectRow(page: import('@playwright/test').Page, name: string) {
  return page.locator('[data-resource-synopsis-row]').filter({
    has: page.getByRole('button', { name, exact: true }),
  })
}

test('project privacy, public prose, and directed grants stay live across tenants', async ({ browser }, testInfo) => {
  test.setTimeout(ms(120_000))
  const owner = await newUser(browser)
  const grace = await newUser(browser, { 'x-user-id': 'user-grace', 'x-tenant-id': 'tenant-beta' })
  const maya = await newUser(browser, { 'x-user-id': 'user-maya', 'x-tenant-id': 'tenant-growthworks' })
  const mayaThread = await maya.context.newPage()
  const graceThread = await grace.context.newPage()
  for (const user of [owner, grace, maya]) user.page.setDefaultTimeout(ms(15_000))
  for (const user of [owner, grace, maya]) await installHelloProbe(user.page)
  mayaThread.setDefaultTimeout(ms(15_000))
  await installHelloProbe(mayaThread)
  graceThread.setDefaultTimeout(ms(15_000))
  await installHelloProbe(graceThread)

  const stamp = Date.now().toString(36)
  const name = `Live project ${stamp}`
  const initialDescription = `Initial public project description ${stamp}`
  const refreshedDescription = `Refreshed public project description ${stamp}`
  const privateInstructions = `Owner-only instructions must never leak ${stamp}`
  const discussionBody = `Project discussion visible only while authorized ${stamp}`
  let projectId = ''
  let grantId = ''

  try {
    await owner.page.goto('/projects')
    await waitForHello(owner.page)
    await owner.page.getByRole('button', { name: 'New project', exact: true }).click()
    const dialog = owner.page.getByRole('dialog', { name: 'New project' })
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByLabel('Description').fill(initialDescription)
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(owner.page).toHaveURL(/\/projects\/[^/?#]+$/)
    projectId = owner.page.url().split('/').at(-1)!
    const projectPath = `/projects/${projectId}`

    await grace.page.goto(projectPath)
    await waitForHello(grace.page)
    await expect(grace.page.locator('[data-resource-unavailable="missing"]')).toBeVisible()
    await expect(grace.page.getByText('This project isn’t visible from this account (or no longer exists).')).toBeVisible()

    await openBrowse(maya.page)
    await expect(maya.page.getByRole('button', { name, exact: true })).toHaveCount(0)

    await applyRelation(owner.page, {
      kind: 'set-project-instructions',
      projectId,
      projectName: name,
      instructions: privateInstructions,
    })
    await applyRelation(owner.page, { kind: 'share-project', projectId, projectName: name, shared: true })

    // Both already-open projections must heal from the same live change.
    await expect(grace.page.getByRole('heading', { name })).toBeVisible()
    await openSection(grace.page, 'About')
    await expect(about(grace.page, initialDescription)).toBeVisible()
    await expect(maya.page.getByRole('button', { name, exact: true })).toBeVisible()
    await expect(maya.page.getByText(initialDescription, { exact: false })).toBeVisible()

    // A discussion has an independent URL/cache but inherits its Project's
    // visibility; an already-open thread must not outlive that read authority.
    const opened = await owner.page.request.post(`${API}/discussions`, {
      data: { anchor: { ref: { kind: 'project', id: projectId } }, firstPost: discussionBody },
    })
    expect(opened.ok()).toBeTruthy()
    const discussion = await opened.json() as { id: string }
    await mayaThread.goto(`/discussions/${discussion.id}`)
    await waitForHello(mayaThread)
    await expect(mayaThread.getByRole('listitem').getByText(discussionBody, { exact: true })).toBeVisible()

    const granted = await owner.page.request.post(`${API}/grants`, {
      data: { subject: { kind: 'project', id: projectId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' },
    })
    expect(granted.ok()).toBeTruthy()
    grantId = ((await granted.json()) as { id: string }).id

    await applyRelation(owner.page, {
      kind: 'set-project-description',
      projectId,
      projectName: name,
      description: refreshedDescription,
      expectedDescription: initialDescription,
    })
    await expect(about(owner.page, refreshedDescription)).toBeVisible()
    await expect(about(grace.page, refreshedDescription)).toBeVisible()
    await expect(maya.page.getByText(refreshedDescription, { exact: false })).toBeVisible()
    await owner.page.goto(projectPath)
    await waitForHello(owner.page)
    await openSection(owner.page, 'About')
    await openSection(owner.page, 'Sharing')
    await expect(owner.page.getByRole('button', { name: /^Edit description/ })).toHaveCount(1)
    await expect(owner.page.getByTestId('share-toggle')).toHaveCount(1)
    await openSection(owner.page, 'About')
    await expect(grace.page.getByRole('button', { name: /^Edit description/ })).toHaveCount(0)
    await expect(grace.page.getByTestId('share-toggle')).toHaveCount(0)
    await expect(grace.page.locator('body')).not.toContainText(privateInstructions)

    // A public-description clear is a live projection change, distinct from
    // unsharing: the directory card remains, while About temporarily vanishes.
    await applyRelation(owner.page, {
      kind: 'set-project-description',
      projectId,
      projectName: name,
      description: '',
      expectedDescription: refreshedDescription,
    })
    await expect(about(grace.page, refreshedDescription)).toHaveCount(0)
    await expect(grace.page.locator('section.group\\/section').filter({ has: grace.page.locator('[data-section-title]', { hasText: /^About$/ }) })).toHaveCount(0)
    await expect(projectRow(maya.page, name)).toHaveCount(1)
    await expect(projectRow(maya.page, name)).not.toContainText(refreshedDescription)

    await applyRelation(owner.page, {
      kind: 'set-project-description',
      projectId,
      projectName: name,
      description: refreshedDescription,
      expectedDescription: '',
    })
    await expect(about(grace.page, refreshedDescription)).toBeVisible()
    await expect(projectRow(maya.page, name)).toContainText(refreshedDescription)

    // Settled public-state captures: owner/reader lists and details, plus the
    // already-open public directory, at every canonical viewport.
    for (const viewport of VIEWPORTS) {
      await owner.page.setViewportSize(viewport)
      await owner.page.goto('/projects')
      await waitForHello(owner.page)
      const ownerListRow = projectRow(owner.page, name)
      await expect(ownerListRow).toHaveCount(1)
      await expect(ownerListRow).toContainText(refreshedDescription)
      await ownerListRow.scrollIntoViewIfNeeded()
      await owner.page.screenshot({ path: testInfo.outputPath(`project-live-owner-list-${viewport.width}x${viewport.height}.png`) })
      await owner.page.goto(projectPath)
      await waitForHello(owner.page)
      await openSection(owner.page, 'About')
      const ownerAbout = about(owner.page, refreshedDescription)
      await expect(ownerAbout).toBeVisible()
      await ownerAbout.scrollIntoViewIfNeeded()
      await owner.page.screenshot({ path: testInfo.outputPath(`project-live-owner-detail-${viewport.width}x${viewport.height}.png`) })

      await grace.page.setViewportSize(viewport)
      await grace.page.goto('/projects')
      await waitForHello(grace.page)
      const graceListRow = projectRow(grace.page, name)
      await expect(graceListRow).toHaveCount(1)
      await expect(graceListRow).toContainText(refreshedDescription)
      await graceListRow.scrollIntoViewIfNeeded()
      await grace.page.screenshot({ path: testInfo.outputPath(`project-live-grace-list-${viewport.width}x${viewport.height}.png`) })
      await grace.page.goto(projectPath)
      await waitForHello(grace.page)
      await openSection(grace.page, 'About')
      const graceAbout = about(grace.page, refreshedDescription)
      await expect(graceAbout).toBeVisible()
      await graceAbout.scrollIntoViewIfNeeded()
      await grace.page.screenshot({ path: testInfo.outputPath(`project-live-grace-detail-${viewport.width}x${viewport.height}.png`) })

      await maya.page.setViewportSize(viewport)
      await openBrowse(maya.page)
      const mayaDirectoryRow = projectRow(maya.page, name)
      await expect(mayaDirectoryRow).toHaveCount(1)
      await expect(mayaDirectoryRow).toContainText(refreshedDescription)
      await mayaDirectoryRow.scrollIntoViewIfNeeded()
      await maya.page.screenshot({ path: testInfo.outputPath(`project-live-maya-directory-${viewport.width}x${viewport.height}.png`) })

      await mayaThread.setViewportSize(viewport)
      await waitForCollapsedRail(mayaThread)
      await expect(mayaThread.getByRole('listitem').getByText(discussionBody, { exact: true })).toBeVisible()
      await mayaThread.screenshot({ path: testInfo.outputPath(`project-live-maya-discussion-${viewport.width}x${viewport.height}.png`) })
    }

    await owner.page.goto(projectPath)
    await waitForHello(owner.page)
    await openSection(owner.page, 'About')
    await Promise.all([waitForHello(owner.page), waitForHello(grace.page), waitForHello(maya.page)])
    await applyRelation(owner.page, { kind: 'share-project', projectId, projectName: name, shared: false })
    await expect(maya.page.getByRole('button', { name, exact: true })).toHaveCount(0)
    await expect(mayaThread.locator('[data-resource-unavailable="missing"]')).toBeVisible()
    await expect(mayaThread.getByText(discussionBody, { exact: true })).toHaveCount(0)
    for (const viewport of VIEWPORTS) {
      await mayaThread.setViewportSize(viewport)
      await waitForCollapsedRail(mayaThread)
      await expect(mayaThread.locator('[data-resource-unavailable="missing"]')).toBeVisible()
      await mayaThread.screenshot({ path: testInfo.outputPath(`project-live-maya-discussion-missing-${viewport.width}x${viewport.height}.png`) })
    }
    await expect(grace.page.getByRole('heading', { name })).toBeVisible()
    await expect(about(grace.page, refreshedDescription)).toBeVisible()

    await graceThread.goto(`/discussions/${discussion.id}`)
    await waitForHello(graceThread)
    for (const viewport of VIEWPORTS) {
      await graceThread.setViewportSize(viewport)
      await waitForCollapsedRail(graceThread)
      await expect(graceThread.getByRole('listitem').getByText(discussionBody, { exact: true })).toBeVisible()
      await graceThread.screenshot({ path: testInfo.outputPath(`project-live-grace-granted-discussion-${viewport.width}x${viewport.height}.png`) })
    }

    const privateDescription = `Private-after-unshare description ${stamp}`
    await Promise.all([waitForHello(owner.page), waitForHello(grace.page), waitForHello(maya.page)])
    await applyRelation(owner.page, {
      kind: 'set-project-description',
      projectId,
      projectName: name,
      description: privateDescription,
      expectedDescription: refreshedDescription,
    })
    await expect(about(owner.page, privateDescription)).toBeVisible()
    await expect(about(grace.page, privateDescription)).toBeVisible()
    await expect(maya.page.getByRole('button', { name, exact: true })).toHaveCount(0)
    await expect(grace.page.locator('body')).not.toContainText(privateInstructions)

    const revoked = await owner.page.request.delete(`${API}/grants/${grantId}`)
    expect(revoked.ok()).toBeTruthy()
    await expect(grace.page.locator('[data-resource-unavailable="missing"]')).toBeVisible()
    await expect(grace.page.getByText('This project isn’t visible from this account (or no longer exists).')).toBeVisible()
    await expect(graceThread.locator('[data-resource-unavailable="missing"]')).toBeVisible()
    await expect(graceThread.getByText(discussionBody, { exact: true })).toHaveCount(0)
    for (const viewport of VIEWPORTS) {
      await graceThread.setViewportSize(viewport)
      await waitForCollapsedRail(graceThread)
      await graceThread.screenshot({ path: testInfo.outputPath(`project-live-grace-discussion-revoked-${viewport.width}x${viewport.height}.png`) })
    }

    // Re-sharing heals that same withdrawn thread without a reload too.
    await applyRelation(owner.page, { kind: 'share-project', projectId, projectName: name, shared: true })
    await expect(mayaThread.getByRole('listitem').getByText(discussionBody, { exact: true })).toBeVisible()
    await expect(graceThread.getByRole('listitem').getByText(discussionBody, { exact: true })).toBeVisible()
  } finally {
    await Promise.allSettled([owner.context.close(), grace.context.close(), maya.context.close()])
  }
})
