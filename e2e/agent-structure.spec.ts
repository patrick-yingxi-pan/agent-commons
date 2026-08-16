/** Agents is a composite account resource (UI-28). This rendered walk locks the
 * part node tests cannot see: the rail hierarchy and main-page hierarchy agree,
 * and their live agent/prompt/tool leaves actually replace the pane with a
 * canonical main page.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { ms } from './budget.ts'
import { newUser } from './social-helpers.ts'

const HEADERS = 'section.group\\/section > div > button[aria-expanded] [data-section-title]'

async function expand(nav: Locator, label: string) {
  const trigger = nav.getByRole('button', { name: `Expand ${label}`, exact: true })
  if (await trigger.count()) await trigger.click()
}

async function sectionTitles(page: Page) {
  return (await page.locator(HEADERS).allTextContents()).map((text) => text.trim())
}

test('Agents preserves section structure and gives ready agents, prompts, and tools main pages', async ({ browser }) => {
  test.setTimeout(ms(90_000))
  const ada = await newUser(browser)
  const page = ada.page
  const [agents, prompts, toolCatalog] = await Promise.all([
    page.request.get('/api/v1/agents').then((response) => response.json() as Promise<{ id: string; label: string; tenantId?: string }[]>),
    page.request.get('/api/v1/system-prompts').then((response) => response.json() as Promise<{ id: string; label: string; tenantId?: string }[]>),
    page.request.get('/api/v1/agent-tools').then((response) => response.json() as Promise<{ entries: { name: string; description: string }[] }>),
  ])
  expect(agents.length).toBeGreaterThan(0)
  expect(prompts.length).toBeGreaterThan(0)
  expect(toolCatalog.entries.length).toBeGreaterThan(0)
  const builtInAgent = agents.find((agent) => !agent.tenantId)!
  const builtInPrompt = prompts.find((prompt) => !prompt.tenantId)!

  await page.goto('/agents')
  await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible({ timeout: ms(20_000) })
  expect(await sectionTitles(page), 'the root page is the complete structural overview').toEqual([
    'Ready agents',
    'Building blocks',
    'Coordination',
    'Discover',
    'Audit',
  ])

  // UI-36: the index is a synopsis ledger, not the Agent detail page compressed
  // into a bordered card. The DOM handle comes from the shared page template;
  // computed edges are the browser half of the source-level chrome lock.
  const readySynopsis = page.locator('[data-resource-synopsis-row]').filter({ hasText: builtInAgent.label }).first()
  await expect(readySynopsis).toBeVisible()
  const synopsisEdges = await readySynopsis.evaluate((node) => {
    const style = getComputedStyle(node)
    return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
  })
  expect(synopsisEdges.filter((width) => width !== '0px').length, 'at most one divider edge, never a box').toBeLessThanOrEqual(1)
  expect(synopsisEdges[1], 'no right frame').toBe('0px')
  expect(synopsisEdges[3], 'no left frame').toBe('0px')
  await expect(readySynopsis.getByText(/^Authority:/)).toHaveCount(0)

  const nav = page.getByRole('navigation', { name: 'Sections' })
  await expand(nav, 'Agents')
  for (const label of ['Ready agents', 'Building blocks', 'Coordination', 'Discover', 'Audit']) {
    await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible()
  }

  await nav.getByRole('button', { name: 'Ready agents', exact: true }).click()
  await expect(page).toHaveURL(/\/agents\/ready-agents$/)
  await expect(page.getByRole('heading', { name: 'Ready agents', exact: true })).toBeVisible()

  await nav.getByRole('button', { name: 'Building blocks', exact: true }).click()
  await expect(page).toHaveURL(/\/agents\/building-blocks$/)
  await expect(page.getByRole('heading', { name: 'Building blocks', exact: true })).toBeVisible()
  expect(await sectionTitles(page), 'the composite section page preserves its child sections').toEqual(['Prompts', 'Tools'])

  await expand(nav, 'Building blocks')
  for (const label of ['Prompts', 'Tools']) await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible()

  await expand(nav, 'Prompts')
  await page.locator('[data-agent-material="prompts"]').getByRole('button', { name: builtInPrompt.label, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/agents/prompts/${encodeURIComponent(builtInPrompt.id)}$`))
  await expect(page.getByRole('heading', { name: builtInPrompt.label, exact: true })).toBeVisible()
  expect(await sectionTitles(page)).toEqual(['Prompt', 'Compatibility'])
  await expect(page.getByText(/^Built in/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit prompt', exact: true })).toHaveCount(0)

  await expand(nav, 'Building blocks')
  await expand(nav, 'Tools')
  const tool = toolCatalog.entries[0]
  const toolLabel = tool.name.split('_').filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')
  await page.locator('[data-agent-material="tools"]').getByRole('button', { name: toolLabel, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/agents/tools/${encodeURIComponent(tool.name)}$`))
  await expect(page.getByRole('heading', { name: toolLabel, exact: true })).toBeVisible()
  expect(await sectionTitles(page)).toEqual(['Capability', 'Grant'])

  await expand(nav, 'Ready agents')
  await page.locator('[data-agent-section="ready-agents"]').getByRole('button', { name: builtInAgent.label, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/agents/${encodeURIComponent(builtInAgent.id)}$`))
  await expect(page.getByRole('heading', { name: builtInAgent.label, exact: true })).toBeVisible()
  await expect(page.locator(HEADERS).filter({ hasText: /^Definition$/ })).toBeVisible()
  await expect(page.getByText('Built in', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit agent', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Fork agent', exact: true })).toHaveCount(0)
  await expect(page.locator(HEADERS).filter({ hasText: /^Distribution$/ })).toHaveCount(0)

  await ada.context.close()
})
