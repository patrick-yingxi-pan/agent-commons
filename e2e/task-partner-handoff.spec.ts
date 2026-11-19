import { fork } from 'node:child_process'
import { once } from 'node:events'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type BrowserContext } from '@playwright/test'
import { findAvailableLoopbackPort } from '../desktop/runtime.mjs'
import { isTaskPartnerContinuation } from '../desktop/taskPartnerContinuation.mjs'
import { ms } from './budget.ts'

test('a separate browser signs in to the desktop sidecar and the task owner confirms the account selected at the verified partner', async ({ browser, baseURL, request }) => {
  test.setTimeout(ms(120_000))
  const port = await findAvailableLoopbackPort()
  const origin = 'http://127.0.0.1:' + port
  const root = mkdtempSync(join(tmpdir(), 'ac-handoff-'))
  const keys = generateKeyPairSync('ed25519')
  const workerToken = 'acp_' + randomUUID().replaceAll('-', '')
  const publicKey = { ...keys.publicKey.export({format:'jwk'}), kid:'browser-fixture' }
  const webOrigin = 'https://commons.example.org'
  const child = fork(new URL('./fixtures/task-partner-handoff.mjs', import.meta.url), ['desktop'], {
    execArgv: [], silent: true,
    ...(process.env.PARTNER_HANDOFF_TEST_EXEC && { execPath: process.env.PARTNER_HANDOFF_TEST_EXEC }),
    env: { ...process.env, ...(process.env.PARTNER_HANDOFF_TEST_EXEC && { ELECTRON_RUN_AS_NODE: '1' }),
      PORT: String(port), AUTH_SECRET: randomUUID() + randomUUID(), CORS_ORIGIN: origin,
      DATABASE_PATH: join(root, 'store.db'), SNAPSHOT_DIR: root, TASK_PARTNER_WEB_ORIGIN: webOrigin,
      TEST_PARTNER_PUBLIC_KEY: JSON.stringify(publicKey), TEST_PARTNER_WORKER: workerToken },
  })
  let errors = ''
  child.stderr!.on('data', chunk => { errors = (errors + chunk).slice(-3000) })
  child.stdout!.resume()
  const exited = once(child, 'exit')
  const initialized = new Promise<void>(resolve => {
    child.on('message', message => {
      if (message && typeof message === 'object' && 'ready' in message && message.ready === true) resolve()
    })
  })
  const app = await browser.newContext(), external = await browser.newContext()
  // Only serve compiled UI assets through the suite's Vite process where a
  // release bundle is unavailable. All API, cookie, authorization and SQLite
  // traffic goes through the desktop launcher and exact loopback origin.
  async function serveUi(context: BrowserContext) {
    if (process.env.PARTNER_HANDOFF_TEST_APP_ROOT) return
    await context.route(origin + '/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/api/')) return route.continue()
      const assets = new URL(url.pathname + url.search, baseURL)
      const response = await route.fetch({ url: assets.href })
      return route.fulfill({ response })
    })
  }
  const email = 'fixture@orchard.example.com', password = 'local-handoff-fixture-46'
  try {
    await Promise.race([initialized, exited.then(() => { throw Error('Desktop sidecar stopped. ' + errors) })])
    await Promise.all([serveUi(app), serveUi(external)])
    const create = async (path: string, body: unknown) => {
      const response = await app.request.post(origin + '/api/v1' + path, {
        data: body, headers: { 'Idempotency-Key': randomUUID() },
      })
      expect(response.ok(), await response.text()).toBeTruthy()
      return response.json()
    }
    await create('/auth/signup', { name: 'Task owner', email, password })
    const { project } = await create('/projects', { name: 'Partner browser', description: 'Model verification' })
    const draft = await create('/projects/' + project.id + '/task-drafts', {
      description: 'Review this result with Orchard', provenance: { partnerId: 'org-handoff-test', model: 'fixture', maxInputTokens: 100, maxOutputTokens: 40 },
    })
    const taskPath = '/projects/' + project.id + '/work/' + draft.taskId
    const page = await app.newPage()
    await page.goto(origin + '/task-partners')
    await expect(page.getByText('Similar website domain. Check the full domain before choosing this partner.')).toBeVisible()
    await expect(page.getByText(/Similar names?/i)).toHaveCount(0)
    await page.goto(origin + taskPath)
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]'))
      .toHaveAttribute('content', /form-action 'self'/)
    await page.getByRole('button', { name: 'Edit task terms' }).click()
    await expect(page.getByRole('option', { name: 'Orchard Models · orchard.example.com · Similar website domain', exact: true })).toHaveCount(1)
    await page.reload()
    const expectedDomain = page.getByRole('textbox', { name: /Confirm website for Orchard Models/ })
    await expect(expectedDomain).toHaveAccessibleDescription(/Similar website domain/)
    await expectedDomain.fill('orchard.example.com')
    await page.getByRole('button', { name: 'Publish task' }).click()
    await expect(page.getByText('Similar website domain', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Review partner authorization' }).click()
    const link = page.getByRole('link', { name: /Continue to partner/ })
    await expect(link).toBeVisible()
    const continuation = new URL((await link.getAttribute('href'))!, origin).href
    expect(isTaskPartnerContinuation(continuation, origin)).toBe(true)
    const handoffId = new URL(continuation).pathname.split('/').at(-1)!
    // In an ordinary signed-in browser the workspace link itself opens the
    // correct authenticated first-party document, under the actual shell CSP.
    const response = app.waitForEvent('response', res => res.url() === continuation)
    const target = page.waitForEvent('popup')
    await link.click()
    const popup = await target
    await expect(popup).toHaveURL(continuation)
    await expect(popup.getByRole('heading', {name:'Continue to your task partner'})).toBeVisible()
    await expect(popup.getByText('Similar website domain. Check the full website address before continuing.')).toBeVisible()
    const headers = (await response).headers()
    expect(headers['content-security-policy']).toMatch(/form-action https:\/\/accounts\.orchard\.example\.com$/)
    expect(headers['cache-control']).toBe('no-store')
    expect(headers['referrer-policy']).toBe('no-referrer')
    await popup.close()
    const system = await external.newPage()
    const delivered: { url: string; method: string; fields: URLSearchParams; headers: Record<string,string> }[] = []
    const endpoint = 'https://accounts.orchard.example.com/authorize'
    await external.route(endpoint, async route => {
      const req = route.request()
      delivered.push({ url: req.url(), method: req.method(), fields: new URLSearchParams(req.postData() ?? ''), headers: await req.allHeaders() })
      return route.fulfill({ contentType: 'text/html', body: '<h1>Select your Orchard account</h1><form action="/selected" method="post"><button>Use account ending in 19</button></form>' })
    })
    // The system browser starts with an independent cookie jar. The ID on
    // that URL alone cannot disclose a code, even at the correct origin.
    const unsigned = await system.goto(continuation)
    expect(unsigned!.status()).toBe(401)
    await expect(system.locator('input[name=startCode]')).toHaveCount(0)
    await system.getByRole('link', { name: 'Sign in to Agent Commons' }).click()
    await system.getByTestId('auth-email').fill(email)
    await system.getByTestId('auth-password').fill(password)
    await system.getByTestId('auth-submit').click()
    await expect(system).toHaveURL(continuation)
    await expect(system.getByRole('heading', {name:'Continue to your task partner'})).toBeVisible()
    await expect(system.getByText('orchard.example.com', {exact:true})).toBeVisible()
    await system.getByRole('button', {name:'Continue to accounts.orchard.example.com'}).click()
    await expect(system.getByRole('heading', {name:'Select your Orchard account'})).toBeVisible()
    expect(delivered).toHaveLength(1)
    const post = delivered[0]!
    expect(post.url).toBe(endpoint)
    expect(post.method).toBe('POST')
    expect([...post.fields.keys()].sort()).toEqual(['handoffId', 'startCode'])
    expect(post.fields.get('handoffId')).toBe(handoffId)
    expect(post.fields.get('startCode')).toMatch(/^code-[a-zA-Z0-9_-]+$/)
    expect(post.headers.referer).toBeUndefined()
    expect(post.headers.cookie).toBeUndefined()
    await expect(page).toHaveURL(origin + taskPath)
    const handoffUrl = origin + '/api/v1/task-partners/production/handoffs/' + handoffId
    const worker = async (suffix: string, body: unknown) => {
      const response = await request.post(handoffUrl + '/' + suffix, { data: body, headers: {
        'Authorization': 'Bearer ' + workerToken, 'Idempotency-Key': randomUUID(),
      } })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    const exchanged = await worker('exchange', { startCode: post.fields.get('startCode') })
    const accountLabel = 'Orchard account ending in 19'
    await external.route('https://accounts.orchard.example.com/selected', async route => {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
      const header = encode({alg:'Ed25519', kid:publicKey.kid, typ:'partner-handoff+jwt'})
      const claims = encode({
        iss: 'org-handoff-test', aud: webOrigin + '/v1/task-partners', environment: 'production',
        iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.parse(exchanged.expiresAt) / 1000), jti: randomUUID(),
        handoffId, taskId: draft.taskId, termsVersion: draft.termsVersion, termsDigest: draft.termsDigest,
        actorRef: exchanged.actorRef, nonce: exchanged.nonce, grant: exchanged.grant, grantRef: randomUUID(), accountLabel,
      })
      const message = header + '.' + claims
      const signedGrant = message + '.' + sign(null, Buffer.from(message), keys.privateKey).toString('base64url')
      await worker('attestations', { signedGrant })
      return route.fulfill({contentType:'text/html',body:'<h1>Return to your task to confirm</h1>'})
    })
    await system.getByRole('button', {name:'Use account ending in 19'}).click()
    await expect(system.getByRole('heading', {name:'Return to your task to confirm'})).toBeVisible()
    await page.getByRole('button', {name:'Refresh authorization'}).click()
    await expect(page.getByText(accountLabel, {exact:false})).toBeVisible()
    await page.getByRole('button', {name:'Confirm account and terms'}).click()
    await expect(page.getByText('Authorization · confirmed', {exact:true})).toBeVisible()
    const confirmed = await app.request.get(handoffUrl)
    expect(await confirmed.json()).toMatchObject({handoffId, taskId:draft.taskId, state:'confirmed', accountLabel})
    const stale = await system.goto(continuation)
    expect(stale!.status()).toBe(409)
    await expect(system.locator('input[name=startCode]')).toHaveCount(0)
  } finally {
    await Promise.all([app.close(), external.close()])
    if (child.exitCode === null && !child.signalCode) child.kill('SIGTERM')
    await exited
    rmSync(root, { recursive: true, force: true })
  }
})
