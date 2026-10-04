import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { ms } from './budget.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 },
  { width: 768, height: 1024 }, { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

/** Only the read projection supplies a held proposal. The real session stays
 * unchanged, so a display load/failure can never pass by applying consent. */
async function openHeldApproval(page: Page) {
  await page.context().setExtraHTTPHeaders({ 'x-tenant-id': 'tenant-consent-loading', 'x-user-id': 'user-ada' })
  const created = await page.request.post('/api/v1/sessions', { data: {} })
  expect(created.ok()).toBe(true)
  const { id } = await created.json() as { id: string }
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/api/v1/')) writes.push(request.url())
  })
  await page.route(`**/api/v1/sessions/${id}*`, async (route) => {
    const response = await route.fetch()
    expect(response.ok()).toBe(true)
    const session = await response.json()
    await route.fulfill({ response, json: {
      ...session,
      messages: [{ id: 'held-approval', role: 'assistant', content: 'A workspace needs your approval.',
        escalation: { kind: 'workspace', rootChoices: ['~/review'], artifacts: [] } }],
    } })
  })
  await page.goto(`/s/${id}`)
  return { id, writes }
}

async function inspectState(page: Page, testInfo: TestInfo, phase: 'loading' | 'load-error') {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await expect(page.locator(`[data-escalation-${phase}]`)).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await assertWcag22Aa(page, `Approval ${phase} ${viewport.width}x${viewport.height}`)
    await page.screenshot({ path: testInfo.outputPath(`approval-${phase}-${viewport.width}x${viewport.height}.png`) })
  }
}

test('approval display loads locally without blanking the conversation or granting consent', async ({ page }, testInfo) => {
  test.setTimeout(ms(60_000))
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/src/components/EscalationPrompt.tsx*', async (route) => {
    await gate
    await route.continue()
  })
  try {
    const { id, writes } = await openHeldApproval(page)
    await expect(page.getByRole('status').filter({ hasText: 'Loading approval…' })).toBeVisible()
    await expect(page.getByText('A workspace needs your approval.', { exact: true })).toBeVisible()
    await inspectState(page, testInfo, 'loading')
    expect(writes).toEqual([])
    release()
    const prompt = page.getByRole('dialog', { name: 'Cowork in a folder' })
    await expect(prompt).toBeVisible()
    await expect(prompt.getByRole('button', { name: 'Choose folder' })).toBeFocused()
    await prompt.getByRole('button', { name: 'Deny', exact: false }).click()
    await expect(prompt.getByText('Access denied', { exact: true })).toBeVisible()
    await prompt.getByRole('button', { name: 'Grant access' }).click()
    await expect(prompt.getByRole('button', { name: 'Choose folder' })).toBeFocused()
    expect(writes).toEqual([])
    const stored = await (await page.request.get(`/api/v1/sessions/${id}`)).json()
    expect(stored.messages).toEqual([])
  } finally {
    release()
  }
})

test('approval chunk failure preserves the conversation and offers explicit warned reload', async ({ page }, testInfo) => {
  test.setTimeout(ms(60_000))
  let blocked = true
  await page.route('**/src/components/EscalationPrompt.tsx*', async (route) => blocked ? route.abort() : route.continue())
  const { writes } = await openHeldApproval(page)
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Copy any unsent text before reloading.')
  await expect(page.getByText('A workspace needs your approval.', { exact: true })).toBeVisible()
  await inspectState(page, testInfo, 'load-error')
  expect(writes).toEqual([])
  blocked = false
  await alert.getByRole('button', { name: 'Reload to review', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Cowork in a folder' })).toBeVisible()
  expect(writes).toEqual([])
})
