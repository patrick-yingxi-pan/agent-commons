/** The project relation keeps an external MCP connection's opaque id alongside
 * its display label. This browser lock proves both project doors use that
 * source-qualified identity when a saved fixture has the same label. */
import { test, expect, type Page } from '@playwright/test'
import { ms } from './budget.ts'
import { proxyMcpApi, startMcpRouterStack } from './mcp-fixture'

const API = '/api/v1'

async function apiJson(page: Page, path: string, data?: unknown): Promise<{ status: number; json: unknown }> {
  return page.evaluate(async ({ path, data }) => {
    const response = await fetch(path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: data === undefined ? undefined : { 'content-type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    return { status: response.status, json: await response.json() as unknown }
  }, { path, data })
}

test('project chip and rail preserve the opaque external MCP identity beside a same-label fixture', async ({ page }) => {
  test.setTimeout(ms(60_000))
  const stack = await startMcpRouterStack()
  const stamp = Date.now().toString(36)
  const label = 'filesystem'
  const projectId = `p-mcp-identity-${stamp}`
  const projectName = `MCP identity ${stamp}`

  try {
    await proxyMcpApi(page, stack)
    // Establish the app origin before the route-owned setup fetches use their
    // normal relative API paths; a fresh Playwright page is about:blank.
    await page.goto('/')

    const created = await apiJson(page, `${API}/mcp-connections`, {
      creationId: `mcp-identity-${stamp}`,
      label,
      endpoint: 'https://example.invalid/mcp',
      authentication: 'none',
    })
    expect(created.status, 'the test-owned external row is created through the real route').toBe(200)
    const connection = created.json as { connection?: { id?: string; label?: string } }
    const connectionId = connection.connection?.id
    expect(connectionId).toMatch(/^mcp-connection-[a-f0-9]{32}$/)
    expect(connection.connection?.label).toBe(label)

    const saved = await apiJson(page, `${API}/saved-contexts`)
    expect(saved.status).toBe(200)
    const savedContexts = saved.json as { contexts?: Array<{ id: string; label: string }> }
    expect(savedContexts.contexts?.some(context => context.id === 'filesystem' && context.label === label)).toBe(true)
    expect(savedContexts.contexts?.some(context => context.id === connectionId && context.label === label)).toBe(true)

    const project = await apiJson(page, `${API}/relations/ops`, {
      op: { kind: 'create-project', projectId, projectName, projectDescription: '' },
    })
    expect(project.status, 'the project is created through the relation route').toBe(200)

    const scoped = await apiJson(page, `${API}/relations/ops`, {
      op: {
        kind: 'scope-context',
        projectId,
        projectName,
        context: {
          kind: 'connector',
          label,
          meta: 'MCP server',
          source: { kind: 'mcp', id: connectionId },
        },
      },
    })
    expect(scoped.status, 'source-qualified scope is admitted for the owning tenant').toBe(200)

    await page.goto(`/projects/${projectId}`)
    await expect(page.getByRole('heading', { name: projectName, exact: true })).toBeVisible({ timeout: ms(20_000) })

    const contextSection = page.locator('section.group\\/section').filter({
      has: page.locator('[data-section-title]', { hasText: /^Context$/ }),
    })
    await expect(contextSection).toHaveCount(1)
    const contextHeader = contextSection.locator('> div > button[aria-expanded]')
    if (await contextHeader.getAttribute('aria-expanded') === 'false') await contextHeader.click()
    const chip = contextSection.getByRole('button', { name: label, exact: true })
    await expect(chip, 'the scoped external context is a real chip door').toBeVisible()
    await expect(chip).toHaveAttribute('title', `Open ${label} in Contexts`)
    await chip.click()
    await expect(page).toHaveURL(new RegExp(`/contexts/${connectionId}$`))

    await page.goto(`/projects/${projectId}`)
    await expect(page.getByRole('heading', { name: projectName, exact: true })).toBeVisible({ timeout: ms(20_000) })
    const rail = page.locator('nav[aria-label="Sections"]')
    const projectSectionKey = `section/projects/item/${encodeURIComponent(projectId)}/section/context`
    const projectSection = rail.locator(`[data-rail-node-key="${projectSectionKey}"]`)
    await expect(projectSection, 'the project rail carries the Context branch').toBeVisible()
    const expand = projectSection.locator('button[aria-label^="Expand "]')
    if (await expand.count() > 0) await expand.click()
    const contextItemKey = `${projectSectionKey}/item/${encodeURIComponent(`context:${connectionId}`)}`
    const contextItem = rail.locator(`[data-rail-node-key="${contextItemKey}"]`)
    await expect(contextItem, 'the rail child is keyed by the opaque source id').toBeVisible()
    await contextItem.locator('[data-rail-entry]').click()
    await expect(page).toHaveURL(new RegExp(`/contexts/${connectionId}$`))
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
  } finally {
    await stack.close()
  }
})
