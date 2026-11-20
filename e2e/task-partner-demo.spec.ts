import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test'
import { findAvailableLoopbackPort } from '../desktop/runtime.mjs'
import { ms } from './budget.ts'

const domains = { labs: 'orchard-labs.example.com', coop: 'orchard-coop.example.com' }
const taskTitle = 'Return ready for the Orchard review'
const accounts = {
  ada: 'ada@acme.example', grace: 'grace@acme.example',
  maya: 'maya@growthworks.example', noor: 'noor@northlight.example',
}

type Demo = { origin: string; page: (actor?: keyof typeof accounts) => Promise<Page> }
const test = base.extend<{ demo: Demo }>({
  demo: async ({ browser, baseURL, request }, use) => {
    const port = await findAvailableLoopbackPort()
    const origin = 'http://127.0.0.1:' + port
    const dir = mkdtempSync(join(tmpdir(), 'ac-partner-demo-'))
    const env = { ...process.env }
    for (const key of ['TASK_PARTNER_WEB_ORIGIN', 'TASK_PARTNER_BADGE_ORIGIN', 'TASK_PARTNER_SANDBOX_ORIGIN', 'DEPLOYMENT_PROFILE']) {
      delete env[key]
    }
    const child = fork(new URL('../server/index.ts', import.meta.url), [], {
      execArgv: [], silent: true,
      env: { ...env, TASK_PARTNER_DEMO: '1', HOST: '127.0.0.1', PORT: String(port), INITIAL_WORLD: 'demo', NODE_ENV: 'development', BACKEND: 'mock',
        PERSIST_BACKEND: 'json', DATA_FILE: join(dir, 'store.json'), AUTH_SECRET: randomUUID() + randomUUID(),
        AUTH_GATE: 'require', AUTH_COOKIE_SECURE: 'off', MAINTAINERS: 'user-ada',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' },
    })
    const exited = once(child, 'exit')
    const contexts: BrowserContext[] = []
    let errors = ''
    child.stdout?.resume()
    child.stderr?.on('data', (chunk) => { errors = (errors + chunk).slice(-3000) })
    try {
      await expect.poll(async () => {
        if (child.exitCode !== null || child.signalCode) throw new Error('Demo server stopped. ' + errors)
        try {
          const probe = await request.get(origin + '/api/v1/readyz', { timeout: ms(2000) })
          return probe.ok() ? 'ready' : probe.status() + ' ' + (await probe.text()).slice(0, 255)
        } catch (error) {
          return String(error).split('\n')[0] + ' ' + errors
        }
      }, { timeout: ms(30000) }).toBe('ready')
      async function page(actor?: keyof typeof accounts) {
        const context = await browser.newContext({ baseURL: origin })
        contexts.push(context)
        if (!existsSync(new URL('../dist/index.html', import.meta.url))) {
          // Source-only runs obtain UI modules from Vite. All API, consent,
          // partner sites, badges and profile requests use the real demo server.
          await context.route(origin + '/**', async route => {
            const url = new URL(route.request().url())
            if (url.pathname.startsWith('/api/')) return route.continue()
            const ui = await route.fetch({ url: new URL(url.pathname + url.search, baseURL).href })
            return route.fulfill({ response: ui })
          })
        }
        if (actor) {
          const login = await context.request.post('/api/v1/auth/login', {
            data: { email: accounts[actor], password: actor + '-demo-password' },
          })
          expect(login.ok()).toBe(true)
        }
        return context.newPage()
      }
      await use({ origin, page })
    } finally {
      await Promise.all(contexts.map(c => c.close()))
      if (child.exitCode === null && !child.signalCode) child.kill('SIGTERM')
      await exited
      rmSync(dir, { recursive: true, force: true })
    }
  },
})

test('a partner administrator distinguishes similar organizations, reviews her application and follows its public badge', async ({ demo }) => {
  test.setTimeout(ms(120000))
  const maya = await demo.page('maya')
  await maya.goto('/task-partners')
  const directory = maya.getByRole('main')
  const labs = directory.getByRole('listitem').filter({ has: maya.getByRole('link', { name: 'Orchard Works · ' + domains.labs, exact: true }) })
  const coop = directory.getByRole('listitem').filter({ has: maya.getByRole('link', { name: 'Orchard Work · ' + domains.coop, exact: true }) })
  await expect(labs.getByText(/Similar name/)).toBeVisible()
  await expect(coop.getByText(/Similar name/)).toBeVisible()
  await expect(labs.getByText(/Demo organization/)).toBeVisible()
  await labs.getByText('Approved catalog', { exact: true }).click()
  await expect(labs.getByText('orchard-demo · standard')).toBeVisible()
  await coop.getByText('Approved catalog', { exact: true }).click()
  await expect(coop.getByText('review-voucher · voucher')).toBeVisible()
  await expect(coop.getByText(/exact-ready · version 1/)).toBeVisible()
  await directory.getByLabel('Find a partner by').selectOption('domain')
  await directory.getByLabel('Exact verified domain').fill(domains.labs)
  await directory.getByRole('button', { name: 'Search partners' }).click()
  await expect(coop).toHaveCount(0)
  await expect(labs).toBeVisible()
  const canonical = await labs.getByRole('link').getAttribute('href')
  expect(new URL(canonical!).hostname).toBe('partner-profiles.localhost')

  await maya.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Partner applications', exact: true }).click()
  await directory.getByLabel('Environment').selectOption('production')
  await directory.getByRole('button', { name: /Orchard Works.*Active/ }).click()
  await expect(directory.getByRole('heading', { name: 'Website badge' })).toBeVisible()
  await expect(directory.getByRole('textbox', { name: 'Profile link', exact: true })).toHaveValue(canonical!)
  await expect(directory.getByRole('textbox', { name: 'Embed code', exact: true })).toHaveValue(/partner-badges\.localhost/)
  await directory.getByText('Requested catalog', { exact: true }).click()
  await expect(directory.getByText('orchard-demo · standard')).toBeVisible()
  const noor = await demo.page('noor')
  await noor.goto(maya.url())
  await expect(noor.getByRole('main').getByRole('alert')).toBeVisible()
  await expect(noor.getByLabel('Embed code')).toHaveCount(0)

  const visitor = await demo.page()
  await visitor.goto(canonical!)
  await expect(visitor.getByRole('heading', { name: 'Orchard Works', exact: true })).toBeVisible()
  await expect(visitor.getByRole('link', { name: /Orchard Work · orchard-coop/ })).toBeVisible()
  const homepage = new URL(demo.origin)
  homepage.hostname = 'orchard-labs.localhost'
  const website = visitor.getByRole('link', { name: domains.labs, exact: true })
  await expect(website).toHaveAttribute('href', homepage.href)
  await website.click()
  const badge = visitor.frameLocator('iframe').getByRole('link', { name: /View active profile/ })
  await expect(badge).toContainText(domains.labs)
  const popup = visitor.waitForEvent('popup')
  await badge.click()
  await expect(await popup).toHaveURL(canonical!)
})

async function authorize(page: Page, domain: string, fixtureHost: string, account: '19' | '42') {
  const main = page.getByRole('main')
  const review = main.getByRole('button', { name: 'Review partner authorization' })
  await expect(review).toBeVisible()
  const independent = main.getByLabel('Independently known website domain')
  if (await independent.count()) await independent.fill(domain)
  await review.click()
  const continuation = page.waitForEvent('popup')
  await main.getByRole('link', { name: /Continue to partner/ }).click()
  const partner = await continuation
  await expect(partner.getByRole('heading', { name: 'Continue to your task partner' })).toBeVisible()
  await expect(partner.getByText(domain, { exact: true })).toBeVisible()
  await partner.getByRole('button', { name: new RegExp('Continue to ' + fixtureHost.replaceAll('.', '\\.')) }).click()
  await expect(partner).toHaveURL(url => url.hostname === fixtureHost)
  await partner.getByRole('button', { name: 'Use demo account ending in ' + account }).click()
  await expect(partner.getByRole('heading', { name: 'Demo account selected' })).toBeVisible()
  await partner.close()
  await main.getByRole('button', { name: 'Refresh authorization' }).click()
  await expect(main.getByText(new RegExp('Selected account · .*' + account))).toBeVisible()
  await main.getByRole('button', { name: 'Confirm account and terms' }).click()
}

test('a requester reserves the promised vouchers and a second person earns them with attested model work', async ({ demo }) => {
  test.setTimeout(ms(120000))
  const ada = await demo.page('ada')
  const grace = await demo.page('grace')
  const owner = ada.getByRole('main')
  const contributor = grace.getByRole('main')
  await ada.goto('/projects/p-insights/open-work')
  await owner.getByRole('button', { name: new RegExp(taskTitle) }).click()
  await expect(owner.getByRole('button', { name: 'Publish task' })).toBeDisabled()
  const taskUrl = ada.url()
  await grace.goto('/projects/p-insights/open-work')
  await expect(contributor.getByRole('heading', { name: 'Your task drafts', exact: true })).toBeVisible()
  await expect(contributor.getByRole('button', { name: new RegExp(taskTitle) })).toHaveCount(0)
  await authorize(ada, domains.coop, 'orchard-coop.localhost', '19')
  await expect(owner.getByText('Funding · held', { exact: true })).toBeVisible({ timeout: ms(20000) })
  const confirmModel = owner.getByRole('textbox', { name: /Confirm website for Orchard Works/ })
  await confirmModel.fill(domains.labs)
  await owner.getByRole('button', { name: 'Publish task' }).click()
  await expect(owner.getByRole('button', { name: 'Create revised offer' })).toBeVisible()
  await grace.goto(taskUrl)
  await expect(contributor.getByRole('heading', { name: taskTitle, exact: true })).toBeVisible()
  const claim = contributor.getByRole('button', { name: 'Claim task' })
  if (await claim.isVisible()) await claim.click()
  await authorize(grace, domains.labs, 'orchard-labs.localhost', '42')
  await expect(contributor.getByText('Acceptance · passed · Compute proof · attested')).toBeVisible({ timeout: ms(25000) })
  await authorize(grace, domains.coop, 'orchard-coop.localhost', '42')
  await expect(contributor.getByText('Funding · delivered', { exact: true })).toBeVisible({ timeout: ms(25000) })
  await ada.reload()
  await expect(owner.getByText('Funding · delivered', { exact: true })).toBeVisible()
  for (const issuer of ['Reward', 'Acceptance', 'Execution']) {
    await expect(owner.locator('dl > div').filter({ has: ada.getByText(issuer, { exact: true }) }).getByText('Demo organization', { exact: true })).toBeVisible()
  }
  await expect(owner.getByText('Acceptance · passed · Compute proof · attested')).toBeVisible()

  for (const { actor, name, commands } of [
    { actor: 'maya' as const, name: 'Orchard Works', commands: ['Run model'] },
    { actor: 'noor' as const, name: 'Orchard Work', commands: ['Reserve reward', 'Verify result', 'Deliver reward'] },
  ]) {
    const admin = await demo.page(actor)
    await admin.goto('/task-partners')
    const main = admin.getByRole('main')
    await admin.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Partner applications', exact: true }).click()
    await main.getByLabel('Environment').selectOption('production')
    await main.getByRole('button', { name: new RegExp(name + '.*Active') }).click()
    await expect(main.getByRole('heading', { name: 'Task activity' })).toBeVisible()
    for (const command of commands) {
      const issued = main.getByRole('listitem').filter({ has: admin.getByText(command, { exact: true }) })
      await expect(issued).toContainText(new URL(taskUrl).pathname.split('/').at(-1)!)
    }
  }
})
