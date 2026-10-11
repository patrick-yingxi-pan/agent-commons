import { test, expect, type Browser, type Page } from '@playwright/test'
import type { ToolActivity } from '../contract/index.ts'
import { MCP_MODERN_VERSION } from '../server/mcpProtocol.ts'
import { MCP_SCHEMA_ADMISSION_VERSION, mcpToolSchemaHash } from '../server/mcpToolAdmission.ts'
import { mcpConnectionCreationId } from '../server/mcpConnections.ts'
import { SESSION_COOKIE, signSession } from '../server/auth.ts'
import { store } from '../server/store/index.ts'
import { proxyMcpApi, startMcpRouterStack } from './mcp-fixture.ts'
import { ms } from './budget.ts'

const API = '/api/v1'

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
    return (await response.json() as { via?: string; user?: { id?: string } }).user?.id
  })).toBe(userId)
}

async function setSignedTenant(page: Page, userId: string, tenantId: string) {
  const appUrl = new URL(page.url())
  await page.context().addCookies([{
    name: SESSION_COOKIE,
    value: signSession({ userId, tenantId, iat: Date.now() }),
    url: `${appUrl.protocol}//${appUrl.host}`,
    httpOnly: true,
    sameSite: 'Lax',
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
      method: 'POST',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  }, { path, body })
}

async function seedOwnedOAuthProposal(ownerUserId: string, tenantId: string, suffix: string) {
  const connectionId = mcpConnectionCreationId(tenantId, `consent-ui-${suffix}`, ownerUserId)
  const tool = { name: 'inspect_records', inputSchema: {
    type: 'object' as const, properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false,
  } }
  const schemaHash = mcpToolSchemaHash(tool)
  store.createMcpConnection({
    id: connectionId, label: `Consent fixture ${suffix}`, endpoint: 'https://consent-fixture.example/mcp', authentication: 'device-oauth',
  }, tenantId, false, ownerUserId)
  store.commitMcpInspection(connectionId, tenantId, 0, {
    protocolVersion: MCP_MODERN_VERSION, cleanup: 'not-needed', tools: [tool],
    schemaAdmission: { version: MCP_SCHEMA_ADMISSION_VERSION, hashes: [schemaHash] },
  }, Date.now(), `MCP_DESKTOP_${'C'.repeat(32)}`, undefined, ownerUserId)
  const session = store.createSession(`Owner-relative consent ${suffix}`, tenantId)
  store.attachContext(session.id, { id: connectionId, type: 'mcp', label: `Consent fixture ${suffix}`, scope: '*' }, ownerUserId)
  const activity: ToolActivity = {
    id: `consent-activity-${suffix}`, tool: `mcp__consent_fixture__inspect_records`,
    connector: `Consent fixture ${suffix}`, connectorId: connectionId, kind: 'action', status: 'proposed',
    summary: 'Inspect this exact record', input: { query: 'owner-only-review' },
    mcp: { connectionRevision: 1, toolName: tool.name, schemaHash },
  }
  store.appendMessage(session.id, {
    id: store.mintMessageId('assistant'), role: 'assistant', content: 'Review this exact external call.', toolActivities: [activity],
  }, { actorUserId: ownerUserId })
  return { sessionId: session.id, connectionId, activityId: activity.id, tenantId }
}

test('shared transcript keeps OAuth consent controls with the owning person, not a same-org peer', async ({ page, browser }, testInfo) => {
  test.setTimeout(ms(90_000))
  const stack = await startMcpRouterStack({ deviceOAuthAvailable: true, resolveOAuthCredential: async () => 'unused-consent-ui-token' })
  const disposeOwnerProxy = await proxyMcpApi(page, stack)
  let peerContext: Awaited<ReturnType<Browser['newContext']>> | undefined
  let disposePeerProxy: (() => Promise<void>) | undefined
  let foreignContext: Awaited<ReturnType<Browser['newContext']>> | undefined
  let disposeForeignProxy: (() => Promise<void>) | undefined
  let sessionId = ''
  let connectionId = ''
  let fixtureTenantId = ''
  let ownerUserId = ''
  try {
    await signInSeed(page, 'ada@acme.example', 'ada-demo-password', 'user-ada')
    const ownerIdentity = await page.evaluate(async () => await (await fetch('/api/v1/me')).json() as {
      tenant: { id: string }; user: { id: string }
    })
    ownerUserId = ownerIdentity.user.id
    const suffix = Date.now().toString(36)
    const createdOrg = await postJson(page, `${API}/orgs`, { name: `OAuth owner eligibility ${suffix}` })
    expect(createdOrg.status).toBe(201)
    fixtureTenantId = (createdOrg.body as { id: string }).id
    await setSignedTenant(page, ownerUserId, fixtureTenantId)

    // Create and verify a real, distinct member, then have the actual owner
    // issue the invitation and the member accept it before minting the signed
    // org-scoped cookie used by the rendered peer request.
    const appOrigin = new URL(page.url()).origin
    peerContext = await browser.newContext({ baseURL: appOrigin })
    const peer = await peerContext.newPage()
    disposePeerProxy = await proxyMcpApi(peer, stack)
    await peer.goto('/contexts')
    const peerAccount = {
      name: `OAuth peer ${suffix}`,
      email: `oauth-peer-${suffix}@example.test`,
      password: `oauth-peer-password-${suffix}`,
    }
    const signup = await postJson(peer, `${API}/auth/signup`, peerAccount)
    expect(signup.status).toBe(200)
    const peerIdentity = signup.body as { user: { id: string } }
    const invitationResponse = await postJson(page, `${API}/orgs/${fixtureTenantId}/invites`, { email: peerAccount.email })
    expect(invitationResponse.status).toBe(201)
    const invitation = invitationResponse.body as { id: string }
    const accepted = await postJson(peer, `${API}/me/invites/${invitation.id}/accept`)
    expect(accepted.status).toBe(200)
    await setSignedTenant(peer, peerIdentity.user.id, fixtureTenantId)

    const fixture = await seedOwnedOAuthProposal(ownerIdentity.user.id, fixtureTenantId, suffix)
    sessionId = fixture.sessionId
    connectionId = fixture.connectionId
    expect(fixture.tenantId).toBe(fixtureTenantId)
    const grant = await page.evaluate(async ({ sessionId }) => {
      const response = await fetch('/api/v1/grants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: { kind: 'session', id: sessionId },
          audience: { kind: 'org', orgId: 'tenant-beta' }, tier: 'view',
        }),
      })
      return { status: response.status, body: await response.json() }
    }, { sessionId })
    expect(grant.status).toBe(200, JSON.stringify(grant.body))

    let eligibilityReads = 0
    const eligibilityPath = `/api/v1/sessions/${encodeURIComponent(sessionId)}/tool-activity-eligibility`
    page.on('response', response => {
      const url = new URL(response.url())
      if (response.request().method() === 'GET' && url.pathname === eligibilityPath) eligibilityReads += 1
    })
    await page.goto(`/s/${encodeURIComponent(sessionId)}`)
    const ownerCard = page.locator('[data-mcp-tool-status="proposed"]').filter({ hasText: 'owner-only-review' }).last()
    await expect(ownerCard.getByRole('button', { name: 'Run tool', exact: true })).toBeVisible({ timeout: ms(15_000) })
    await expect(ownerCard.getByRole('button', { name: 'Decline', exact: true })).toBeVisible()
    await expect.poll(() => eligibilityReads).toBeGreaterThan(0)
    const readsBeforeInvalidation = eligibilityReads
    await page.evaluate(async sessionId => {
      const [{ invalidatePrefix }, { keys }] = await Promise.all([
        import('/src/api/cache.ts'), import('/src/api/keys.ts'),
      ])
      invalidatePrefix(keys.toolActivityEligibilityPrefix(sessionId))
    }, sessionId)
    await expect.poll(() => eligibilityReads).toBeGreaterThan(readsBeforeInvalidation)
    await expect(ownerCard.getByRole('button', { name: 'Run tool', exact: true })).toBeVisible()
    await expect(ownerCard.getByRole('button', { name: 'Decline', exact: true })).toBeVisible()

    await peer.goto(`/s/${encodeURIComponent(sessionId)}`)
    const peerCard = peer.locator('[data-mcp-tool-status="proposed"]').filter({ hasText: 'owner-only-review' }).last()
    await expect(peerCard).toContainText('Inspect this exact record', { timeout: ms(15_000) })
    await expect(peerCard.getByRole('button', { name: 'Run tool', exact: true })).toHaveCount(0)
    await expect(peerCard.getByRole('button', { name: 'Decline', exact: true })).toHaveCount(0)
    await expect(peerCard).toContainText('Decision controls are unavailable to this account.')
    await expect(peerCard).not.toContainText(ownerIdentity.user.id)
    await expect(peerCard).not.toContainText(peerIdentity.user.id)

    // Preserve the cross-tenant reader walk: a verified person admitted via
    // the explicit organization grant also sees the transcript but not controls.
    foreignContext = await browser.newContext({ baseURL: appOrigin })
    const foreign = await foreignContext.newPage()
    disposeForeignProxy = await proxyMcpApi(foreign, stack)
    await signInSeed(foreign, 'grace@acme.example', 'grace-demo-password', 'user-grace')
    await foreign.goto(`/s/${encodeURIComponent(sessionId)}`)
    const foreignCard = foreign.locator('[data-mcp-tool-status="proposed"]').filter({ hasText: 'owner-only-review' }).last()
    await expect(foreignCard).toContainText('Inspect this exact record', { timeout: ms(15_000) })
    await expect(foreignCard.getByRole('button', { name: 'Run tool', exact: true })).toHaveCount(0)
    await expect(foreignCard.getByRole('button', { name: 'Decline', exact: true })).toHaveCount(0)
    await expect(foreignCard).toContainText('Decision controls are unavailable to this account.')
    await expect(foreignCard).not.toContainText(ownerIdentity.user.id)
    await page.screenshot({ path: testInfo.outputPath('owner-eligible-controls.png') })
    await peer.screenshot({ path: testInfo.outputPath('same-org-peer-no-controls.png') })
    await foreign.screenshot({ path: testInfo.outputPath('cross-tenant-reader-no-controls.png') })
  } finally {
    try { await disposeForeignProxy?.() } finally {
      try { await disposePeerProxy?.() } finally {
        await foreignContext?.close()
        await peerContext?.close()
        await disposeOwnerProxy()
        if (sessionId) store.removeSession(sessionId)
        if (connectionId) {
          const row = store.privateMcpConnection(connectionId, fixtureTenantId, ownerUserId)
          if (row) store.removeMcpConnection(connectionId, fixtureTenantId, row.revision, ownerUserId)
        }
        await stack.close()
      }
    }
  }
})
