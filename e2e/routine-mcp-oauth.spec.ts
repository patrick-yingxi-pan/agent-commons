/** Real signed-in people review separate Routine grants. Catalog and receipt
 * fulfilment are isolated fixtures; native acceptance owns OAuth/network proof. */
import { randomUUID } from 'node:crypto'
import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test'
import type { ScheduleTemplate } from '../contract/index.ts'
import { SESSION_COOKIE, signSession } from '../server/auth.ts'
import { mcpConnectionCreationId } from '../server/mcpConnections.ts'
import { MCP_MODERN_VERSION } from '../server/mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../server/mcpToolAdmission.ts'
import { store } from '../server/store/index.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { proxyMcpApi, startMcpRouterStack } from './mcp-fixture.ts'
import { ms } from './budget.ts'

const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]
const tool = { name: 'inspect_records', inputSchema: {
  type: 'object' as const, properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false,
} }

async function api(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(`/api/v1${path}`, { method,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() as any }
  }, { method, path, body })
}

async function signIn(page: Page, email: string, password: string, userId: string) {
  await page.goto('/scheduled')
  const result = await api(page, 'POST', '/auth/login', { email, password })
  expect(result.status).toBe(200)
  expect(result.body.user.id).toBe(userId)
  await page.reload()
  expect((await api(page, 'GET', '/me')).body.user.id).toBe(userId)
}

async function selectWorkspace(page: Page, userId: string, tenantId: string) {
  await page.context().addCookies([{ name: SESSION_COOKIE,
    value: signSession({ userId, tenantId, iat: Date.now() }), url: new URL(page.url()).origin,
    httpOnly: true, sameSite: 'Lax',
  }])
  await page.reload()
  const identity = (await api(page, 'GET', '/me')).body
  expect(identity.via).toBe('session')
  expect(identity.user.id).toBe(userId)
  expect(identity.tenant.id).toBe(tenantId)
}

function connection(tenantId: string, ownerUserId: string, label: string) {
  const stamp = randomUUID().replace(/-/g, '')
  const id = mcpConnectionCreationId(tenantId, stamp, ownerUserId)
  store.createMcpConnection({ id, label, endpoint: 'https://routine-oauth-fixture.example/mcp',
    authentication: 'device-oauth' }, tenantId, false, ownerUserId)
  store.commitMcpInspection(id, tenantId, 0, { protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] },
  }, Date.now(), `MCP_DESKTOP_${stamp.toUpperCase()}`, undefined, ownerUserId)
  return id
}

async function capture(page: Page, subject: Locator, label: string, lower?: Locator) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(subject).toBeVisible()
    await subject.scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await subject.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    const groups = subject.locator('[data-routine-mcp-actions]')
    const groupCount = await groups.count()
    if (label === 'routine-oauth-peer-private' || label === 'routine-oauth-owner-review') expect(groupCount).toBe(1)
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
      const buttons = groups.nth(groupIndex).locator(':scope > button')
      const count = await buttons.count()
      expect(count).toBeGreaterThan(0)
      for (let index = 1; index < count; index++) {
        const first = await buttons.nth(index - 1).boundingBox()
        const second = await buttons.nth(index).boundingBox()
        expect(first).not.toBeNull()
        expect(second).not.toBeNull()
        expect(Math.max(second!.x - first!.x - first!.width, second!.y - first!.y - first!.height),
          'permission actions remain distinct controls, including after wrapping').toBeGreaterThanOrEqual(7)
      }
    }
    await assertWcag22Aa(page, `${label} ${viewport.width}`)
    await page.screenshot({ path: test.info().outputPath(`${label}-${viewport.width}.png`) })
    if (lower) {
      await lower.scrollIntoViewIfNeeded()
      await expect(lower).toBeInViewport()
      await page.screenshot({ path: test.info().outputPath(`${label}-lower-${viewport.width}.png`) })
    }
  }
}

async function reviewChoice(panel: Locator, label: string, query: string) {
  const card = panel.locator('article').filter({ hasText: label })
  await card.getByRole('checkbox').check()
  await card.getByLabel('Fixed values for inspect_records', { exact: true }).fill(JSON.stringify({ query }))
  await panel.getByLabel('Maximum calls per run').fill('2')
  await panel.getByRole('button', { name: 'Review approval', exact: true }).click()
  const review = panel.locator('[aria-label="Approval review"]')
  await expect(review).toContainText('approving person’s external account')
  await expect(review).toContainText('continued workspace membership')
  await expect(review).toContainText(query)
  return review
}

test('Routine OAuth review, private history and peer replacement stay person-scoped across five viewports', async ({ page, browser }) => {
  test.setTimeout(ms(150_000))
  let credentialReads = 0
  const stack = await startMcpRouterStack({ deviceOAuthAvailable: true,
    resolveOAuthCredential: async () => { credentialReads++; throw new Error('Review must not request credentials') },
  })
  const contexts: BrowserContext[] = []
  const disposers = [await proxyMcpApi(page, stack)]
  let taskId = ''
  try {
    await signIn(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    const suffix = randomUUID().slice(0, 8)
    const org = await api(page, 'POST', '/orgs', { name: `Routine OAuth ${suffix}` })
    expect(org.status).toBe(201)
    const tenantId = org.body.id as string
    await selectWorkspace(page, 'user-ada', tenantId)
    const newPage = async () => {
      const context = await browser.newContext({ baseURL: new URL(page.url()).origin })
      contexts.push(context)
      const result = await context.newPage()
      disposers.push(await proxyMcpApi(result, stack))
      return result
    }
    const peer = await newPage()
    await peer.goto('/scheduled')
    const email = `routine-peer-${suffix}@example.test`
    const signup = await api(peer, 'POST', '/auth/signup', { name: 'Routine peer', email, password: `routine-peer-${suffix}-password` })
    expect(signup.status).toBe(200)
    const peerId = signup.body.user.id as string
    const invite = await api(page, 'POST', `/orgs/${tenantId}/invites`, { email })
    expect(invite.status).toBe(201)
    expect((await api(peer, 'POST', `/me/invites/${invite.body.id}/accept`)).status).toBe(200)
    await selectWorkspace(peer, peerId, tenantId)
    const ownerLabel = `Ada private account ${suffix}`
    const peerLabel = `Peer private account ${suffix}`
    const ownerConnection = connection(tenantId, 'user-ada', ownerLabel)
    connection(tenantId, peerId, peerLabel)
    const templates = (await api(page, 'GET', '/schedule-templates')).body as ScheduleTemplate[]
    const name = `Reviewed Routine ${suffix}`
    const created = await api(page, 'POST', '/schedules', { seed: { ...templates[0]!.seed,
      name, enabled: false, prompt: 'Inspect records using the separately approved account.', runs: [], steps: [],
      delivery: { tool: { id: 'assistant', label: 'Assistant', tone: 'claude' }, target: 'Run conversation' },
    } })
    expect(created.status).toBe(200)
    taskId = created.body.id
    const path = `/scheduled/${taskId}/external-mcp`
    const grant = await api(page, 'POST', '/grants', { subject: { kind: 'schedule', id: taskId },
      audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view' })
    expect(grant.status).toBe(200)
    await page.goto(path)
    const panel = page.getByRole('region', { name: 'External MCP', exact: true })
    await expect(panel.getByText('No unattended MCP tools', { exact: true })).toBeVisible()
    await expect(panel).not.toContainText(peerLabel)
    const query = `owner-private-query-${suffix}`
    const reviewed = await reviewChoice(panel, ownerLabel, query)
    await capture(page, reviewed, 'routine-oauth-owner-review', reviewed.getByRole('button', { name: 'Approve these tools', exact: true }))
    expect(credentialReads).toBe(0)
    await reviewed.getByRole('button', { name: 'Approve these tools', exact: true }).click()
    await expect(panel.getByText('Approval active', { exact: true })).toBeVisible()

    // Render a real private ledger through the host's injected one-shot seam.
    // This is receipt projection evidence, not public-service execution proof.
    const run = store.runSchedule(taskId)!
    const receipt = await store.executeRoutineMcpCall(taskId, run.id, {
      connectionId: ownerConnection, connectionRevision: 1, toolName: tool.name,
      schemaHash: mcpToolSchemaHash(tool), arguments: { query },
    }, `browser-receipt-${suffix}`, undefined, async (_store, _tenant, _call, current, actor) => {
      expect(actor).toBe('user-ada')
      expect(current()).toBe(true)
      return { status: 'done', summary: 'Fixture records inspected.', result: { resultType: 'complete', content: [{ type: 'text', text: `owner-private-result-${suffix}` }], isError: false } }
    })
    expect(receipt.status).toBe('done')
    store.failScheduleRun(taskId, run.id, 'execution_error', 'The browser receipt fixture has ended.')
    await panel.getByRole('button', { name: 'Refresh review', exact: true }).click()
    const result = panel.getByRole('region', { name: 'Result for inspect_records', exact: true })
    await expect(result).toContainText(`owner-private-result-${suffix}`)
    await capture(page, panel, 'routine-oauth-owner-history', result)

    await peer.goto(path)
    const peerPanel = peer.getByRole('region', { name: 'External MCP', exact: true })
    await expect(peerPanel.getByText('Approved by another member', { exact: true })).toBeVisible()
    await expect(peerPanel).toContainText('A replacement never changes a run already queued.')
    await expect(peerPanel).not.toContainText(ownerLabel)
    await expect(peerPanel).not.toContainText(query)
    await expect(peerPanel.getByRole('heading', { name: 'Private run receipts', exact: true })).toHaveCount(0)
    const peerReview = await api(peer, 'GET', `/schedules/${taskId}/mcp-permission`)
    expect(peerReview.body.policy.approval).toBeNull()
    expect(peerReview.body.runs).toEqual([])
    expect(JSON.stringify(peerReview.body)).not.toContain(ownerConnection)
    await capture(peer, peerPanel, 'routine-oauth-peer-private', peerPanel.getByRole('button', { name: 'Revoke approval', exact: true }))
    await peerPanel.getByRole('button', { name: 'Revoke approval', exact: true }).click()
    await expect(peerPanel.getByText('No unattended MCP tools', { exact: true })).toBeVisible()
    const replacement = await reviewChoice(peerPanel, peerLabel, `peer-query-${suffix}`)
    await replacement.getByRole('button', { name: 'Approve these tools', exact: true }).click()
    await expect(peerPanel.getByText('Approval active', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Refresh review', exact: true }).click()
    await expect(panel.getByText('Approved by another member', { exact: true })).toBeVisible()
    await expect(panel).not.toContainText(peerLabel)
    await expect(result).toContainText(`owner-private-result-${suffix}`)
    await capture(page, panel, 'routine-oauth-replaced-owner-history', result)

    const grace = await newPage()
    await signIn(grace, 'grace@acme.example', 'grace-demo-password', 'user-grace')
    await grace.goto(`/scheduled/${taskId}`)
    const sharedHeading = grace.getByRole('heading', { name, exact: true })
    await expect(sharedHeading).toBeVisible()
    await expect(sharedHeading).toHaveAttribute('title', name)
    await expect(grace.getByRole('button', { name: 'External MCP', exact: true })).toHaveCount(0)
    expect((await api(grace, 'GET', `/schedules/${taskId}/mcp-permission`)).status).toBe(404)
    await capture(grace, grace.getByRole('main').first(), 'routine-oauth-shared-reader')
    const maya = await newPage()
    await signIn(maya, 'maya@growthworks.example', 'maya-demo-password', 'user-maya')
    await maya.goto(path)
    expect((await api(maya, 'GET', `/schedules/${taskId}/mcp-permission`)).status).toBe(404)
    await expect(maya.getByRole('region', { name: 'External MCP', exact: true })).toHaveCount(0)
    await expect(maya.getByRole('heading', { name, exact: true })).toHaveCount(0)
    await capture(maya, maya.getByRole('main').first(), 'routine-oauth-foreign')
    expect(credentialReads).toBe(0, 'review, approval and history never retrieve OAuth credentials')
  } finally {
    await Promise.all(disposers.map(dispose => dispose()))
    await Promise.all(contexts.map(context => context.close()))
    if (taskId) store.removeSchedule(taskId)
    await stack.close()
  }
})
