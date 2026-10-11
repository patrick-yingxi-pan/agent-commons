/** Person-owned OAuth Contribution review across a real org and Project grant. */
import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type Page, type Locator } from '@playwright/test'
import { MCP_MODERN_VERSION } from '../server/mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../server/mcpToolAdmission.ts'
import { mcpConnectionCreationId } from '../server/mcpConnections.ts'
import { SESSION_COOKIE, signSession } from '../server/auth.ts'
import { store } from '../server/store/index.ts'
import { assertWcag22Aa } from './accessibility-helpers.ts'
import { settleArtifactPageRail } from './artifact-page-helpers.ts'
import { ms } from './budget.ts'
import { proxyMcpApi, startMcpRouterStack } from './mcp-fixture.ts'

const API = '/api/v1'
const VIEWPORTS = [
  { width: 320, height: 700 }, { width: 375, height: 812 }, { width: 768, height: 1024 },
  { width: 844, height: 390 }, { width: 1280, height: 800 },
]

async function signInSeed(page: Page, email: string, password: string, userId: string) {
  await page.goto('/contexts')
  const login = await page.evaluate(async ({ email, password }) => {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    })
    return { status: response.status, body: await response.json() as { user?: { id?: string } } }
  }, { email, password })
  expect(login.status).toBe(200)
  expect(login.body.user?.id).toBe(userId)
  await page.reload()
  await expect.poll(async () => await page.evaluate(async () => {
    const response = await fetch('/api/v1/me')
    return (await response.json() as { user?: { id?: string } }).user?.id
  })).toBe(userId)
}

/** The shared MCP API proxy intentionally drops the long-lived event stream.
 * Keep the app's real EventSource/message handler, with a narrow fixture hook
 * to deliver the exact ambient event after a real API mutation. */
async function installAmbientEventFixture(page: Page) {
  await page.addInitScript(() => {
    const Native = window.EventSource
    type EventFixtureWindow = Window & {
      __contributionOAuthEventSource?: EventSource
      __emitContributionOAuthEvent?: (event: unknown) => void
    }
    const fixtureWindow = window as EventFixtureWindow
    class EventFixtureSource extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init)
        fixtureWindow.__contributionOAuthEventSource = this
      }
    }
    window.EventSource = EventFixtureSource
    fixtureWindow.__emitContributionOAuthEvent = (event) => {
      const source = fixtureWindow.__contributionOAuthEventSource
      if (!source) throw new Error('The application EventSource has not been created.')
      source.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }))
    }
  })
}

async function setSignedTenant(page: Page, userId: string, tenantId: string) {
  const appUrl = new URL(page.url())
  await page.context().addCookies([{
    name: SESSION_COOKIE, value: signSession({ userId, tenantId, iat: Date.now() }),
    url: `${appUrl.protocol}//${appUrl.host}`, httpOnly: true, sameSite: 'Lax',
  }])
  await page.reload()
  const identity = await page.evaluate(async () => await (await fetch('/api/v1/me')).json() as {
    via?: string; tenant?: { id: string }; user?: { id: string }
  })
  expect(identity.via).toBe('session')
  expect(identity.user?.id).toBe(userId)
  expect(identity.tenant?.id).toBe(tenantId)
}

async function postJson(page: Page, path: string, body?: Record<string, unknown>) {
  return page.evaluate(async ({ path, body }) => {
    const response = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() as Record<string, any> }
  }, { path, body })
}

async function captureSurface(page: Page, subject: Locator, label: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport)
    await settleArtifactPageRail(page)
    await expect(subject).toBeVisible()
    await subject.scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    expect(await subject.evaluate(element => element.scrollWidth <= element.clientWidth), `${label} fits its rendered surface at ${viewport.width}px`).toBe(true)
    await assertWcag22Aa(page, `${label} ${viewport.width}`)
    await page.screenshot({ path: test.info().outputPath(`${label}-${viewport.width}.png`) })
  }
}

async function seedOwnerOAuth(ownerUserId: string, tenantId: string, suffix: string) {
  const connectionId = mcpConnectionCreationId(tenantId, `contribution-oauth-${suffix}`, ownerUserId)
  const label = `Owner private OAuth ${suffix}`
  const tool = { name: 'write_record', inputSchema: {
    type: 'object' as const, properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false,
  } }
  store.createMcpConnection({
    id: connectionId, label, endpoint: 'https://oauth-contribution-fixture.example/mcp', authentication: 'device-oauth',
  }, tenantId, false, ownerUserId)
  store.commitMcpInspection(connectionId, tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [mcpToolSchemaHash(tool)] },
  }, Date.now(), `MCP_DESKTOP_${suffix.replace(/[^A-F0-9]/gi, 'B').toUpperCase().slice(0, 32).padEnd(32, 'B')}`, undefined, ownerUserId)
  return { connectionId, label }
}

test('Contribution OAuth owner reviews one exact call while org peers and Project readers stay read-only', async ({ page, browser }, testInfo) => {
  test.setTimeout(ms(150_000))
  let resolverCalls = 0
  const stack = await startMcpRouterStack({ deviceOAuthAvailable: true, resolveOAuthCredential: async () => {
    resolverCalls++
    return 'unused-owner-review-token'
  } })
  const disposeOwnerProxy = await proxyMcpApi(page, stack)
  let peerContext: Awaited<ReturnType<Browser['newContext']>> | undefined
  let disposePeerProxy: (() => Promise<void>) | undefined
  let graceContext: Awaited<ReturnType<Browser['newContext']>> | undefined
  let disposeGraceProxy: (() => Promise<void>) | undefined
  let mayaContext: Awaited<ReturnType<Browser['newContext']>> | undefined
  let disposeMayaProxy: (() => Promise<void>) | undefined
  let tenantId = ''
  let ownerUserId = ''
  let connectionId = ''
  try {
    await installAmbientEventFixture(page)
    await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    const ownerIdentity = await page.evaluate(async () => await (await fetch('/api/v1/me')).json() as {
      tenant: { id: string }; user: { id: string }
    })
    ownerUserId = ownerIdentity.user.id
    const suffix = randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()
    const orgResponse = await postJson(page, `${API}/orgs`, { name: `Contribution OAuth ${suffix}` })
    expect(orgResponse.status).toBe(201, JSON.stringify(orgResponse.body))
    tenantId = orgResponse.body.id as string
    await setSignedTenant(page, ownerUserId, tenantId)

    const appOrigin = new URL(page.url()).origin
    peerContext = await browser.newContext({ baseURL: appOrigin })
    const peer = await peerContext.newPage()
    disposePeerProxy = await proxyMcpApi(peer, stack)
    await peer.goto('/contexts')
    const peerAccount = { name: `OAuth peer ${suffix}`, email: `oauth-peer-${suffix}@example.test`, password: `oauth-peer-${suffix}-password` }
    const signup = await postJson(peer, `${API}/auth/signup`, peerAccount)
    expect(signup.status).toBe(200, JSON.stringify(signup.body))
    const peerUserId = signup.body.user.id as string
    const invite = await postJson(page, `${API}/orgs/${tenantId}/invites`, { email: peerAccount.email })
    expect(invite.status).toBe(201, JSON.stringify(invite.body))
    const accepted = await postJson(peer, `${API}/me/invites/${invite.body.id}/accept`)
    expect(accepted.status).toBe(200)
    await setSignedTenant(peer, peerUserId, tenantId)

    const connection = await seedOwnerOAuth(ownerUserId, tenantId, suffix)
    connectionId = connection.connectionId
    const projectResult = await postJson(page, `${API}/projects`, {
      name: `OAuth reviewed contribution ${suffix}`, description: 'One exact action is reviewed before a separate confirmation.',
    })
    expect(projectResult.status).toBe(201, JSON.stringify(projectResult.body))
    const projectId = projectResult.body.project.id as string
    const contributionResult = await postJson(page, `${API}/projects/${projectId}/contributions`, {
      title: 'Write one reviewed record', summary: 'The selected OAuth connection remains private to its owner.',
    })
    expect(contributionResult.status).toBe(200, JSON.stringify(contributionResult.body))
    const contributionId = contributionResult.body.id as string
    const contributionPath = `/projects/${projectId}/changes/${contributionId}`
    const query = `owner-reviewed-${suffix}`

    const grant = await postJson(page, `${API}/grants`, {
      subject: { kind: 'project', id: projectId }, audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view',
    })
    expect(grant.status).toBe(200, JSON.stringify(grant.body))

    await page.goto(contributionPath)
    await page.getByRole('button', { name: 'Declare effects', exact: true }).click()
    await page.getByLabel('Effect type 1', { exact: true }).selectOption('mcp.mutate')
    await expect(page.getByLabel('MCP tool 1', { exact: true })).toBeVisible()
    await page.getByLabel('MCP tool 1', { exact: true }).selectOption({ label: `${connection.label} · write_record` })
    await page.getByLabel('MCP arguments 1', { exact: true }).fill(JSON.stringify({ query }))
    await page.getByLabel('Max acts 1', { exact: true }).fill('2')
    await page.getByRole('button', { name: 'Propose v1', exact: true }).click()
    const envelope = page.locator('[data-contribution-envelope-version="1"]')
    await expect(envelope).toContainText(query)
    await expect(envelope.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toHaveCount(0)
    await envelope.getByRole('button', { name: 'Approve', exact: true }).click()
    const reviewButton = page.getByRole('button', { name: 'Review & run', exact: true })
    await expect(reviewButton).toBeVisible()
    expect(resolverCalls).toBe(0)
    await reviewButton.click()
    const confirmation = page.getByRole('group', { name: 'Confirm one MCP effect run', exact: true })
    await expect(confirmation).toContainText('Review this exact external call')
    await expect(page.getByLabel('Approved arguments for write_record', { exact: true })).toContainText(query)
    await expect(confirmation).toContainText('credentials stay private')
    await expect(confirmation.getByRole('button', { name: 'Confirm and run once', exact: true })).toBeVisible()
    expect(resolverCalls).toBe(0, 'opening and reviewing the per-call confirmation does not ask for credentials or dispatch')
    await captureSurface(page, confirmation, 'oauth-owner-confirmation')
    expect(resolverCalls).toBe(0, 'viewport review never dispatches the OAuth tool')

    await peer.goto(contributionPath)
    const peerEnvelope = peer.locator('[data-contribution-envelope-version="1"]')
    await expect(peerEnvelope).toContainText(query)
    await expect(peer.getByRole('button', { name: 'Review & run', exact: true })).toHaveCount(0)
    await expect(peer.getByRole('button', { name: 'Confirm and run once', exact: true })).toHaveCount(0)
    await captureSurface(peer, peerEnvelope, 'oauth-same-org-peer-envelope')

    graceContext = await browser.newContext({ baseURL: appOrigin })
    const grace = await graceContext.newPage()
    disposeGraceProxy = await proxyMcpApi(grace, stack)
    await signInSeed(grace, 'grace@acme.example', 'grace-demo-password', 'user-grace')
    await grace.goto(contributionPath)
    const graceEnvelope = grace.locator('[data-contribution-envelope-version="1"]')
    await expect(graceEnvelope).toContainText(query)
    await expect(grace.getByRole('button', { name: 'Review & run', exact: true })).toHaveCount(0)
    await expect(grace.getByRole('button', { name: 'Confirm and run once', exact: true })).toHaveCount(0)
    await grace.screenshot({ path: testInfo.outputPath('oauth-cross-tenant-grace-read-only.png') })

    mayaContext = await browser.newContext({ baseURL: appOrigin })
    const maya = await mayaContext.newPage()
    disposeMayaProxy = await proxyMcpApi(maya, stack)
    await signInSeed(maya, 'maya@growthworks.example', 'maya-demo-password', 'user-maya')
    await maya.goto(contributionPath)
    const unavailable = maya.locator('[data-resource-unavailable="missing"]')
    await expect(unavailable).toBeVisible()
    await expect(unavailable).toContainText('This project isn’t visible from this account')
    await expect(maya.locator('[data-contribution-envelope-version]')).toHaveCount(0)
    await expect(maya.getByRole('main')).not.toContainText(query)
    await maya.screenshot({ path: testInfo.outputPath('oauth-foreign-maya-hidden.png') })
    expect(resolverCalls).toBe(0)

    // Keep the binding usable throughout the peer/reader checks above: a
    // disconnected connection cannot prove person-relative Run isolation.
    await expect(confirmation).toBeVisible()
    const disconnected = await postJson(page, `${API}/mcp-connections/${connectionId}/disconnect`, { expectedRevision: 1 })
    expect(disconnected.status).toBe(200, JSON.stringify(disconnected.body))
    await page.evaluate((event) => {
      const emit = (window as Window & { __emitContributionOAuthEvent?: (value: unknown) => void }).__emitContributionOAuthEvent
      if (!emit) throw new Error('The ambient event fixture is unavailable.')
      emit(event)
    }, { type: 'connector.status', id: connectionId, status: 'needs-auth', tenantId, ownerUserId })
    await expect(page).toHaveURL(contributionPath)
    await expect(page.getByRole('button', { name: 'Review & run', exact: true })).toHaveCount(0)
    await expect(confirmation).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Confirm and run once', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Approved arguments for write_record', { exact: true })).toContainText(query)
    expect(resolverCalls).toBe(0, 'a live disconnect only removes Run authority; it never resolves a credential')
    await captureSurface(page, envelope, 'oauth-owner-disconnected-envelope')
  } finally {
    try { await disposeMayaProxy?.() } finally {
      try { await disposeGraceProxy?.() } finally {
        try { await disposePeerProxy?.() } finally {
          await mayaContext?.close()
          await graceContext?.close()
          await peerContext?.close()
          await disposeOwnerProxy()
          if (connectionId && tenantId) {
            const connection = store.privateMcpConnection(connectionId, tenantId, ownerUserId)
            if (connection) store.removeMcpConnection(connectionId, tenantId, connection.revision, ownerUserId)
          }
          await stack.close()
        }
      }
    }
  }
})
