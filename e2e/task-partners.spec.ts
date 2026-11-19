import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page, name: 'ada' | 'grace' | 'maya' | 'rei') {
  const email = {
    ada: 'ada@acme.example',
    grace: 'grace@acme.example',
    maya: 'maya@growthworks.example',
    rei: 'rei@reislab.example',
  }[name]
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email, password: name + '-demo-password' },
  })
  expect(response.ok()).toBeTruthy()
}

test('an organization administrator can enroll, inspect separate proofs, and reopen the private application', async ({
  page,
  browser,
}) => {
  await signIn(page, 'rei')
  await page.goto('/task-partners')
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { name: 'Task partners', exact: true })).toBeVisible()
  await main.getByRole('button', { name: 'Register partner', exact: true }).click()
  const name = 'Juniper Studio ' + Date.now()
  await main.getByLabel('Public display name').fill(name)
  await main.getByLabel('Organization name', { exact: true }).fill(name)
  await main.getByLabel('Website URL').fill('https://juniper.example.org')
  await main.getByLabel('Operational email').fill('ops@example.org')
  await main.getByLabel('Recovery contact').fill('recovery@example.org')
  await main.getByRole('checkbox', { name: 'Model provider', exact: true }).check()
  await main.getByLabel('Model ID').fill('juniper-model')
  await main.getByLabel('Effort levels').fill('standard')
  await main.getByLabel('Account authorization URL').fill('https://juniper.example.org/authorize')
  const { publicKey } = generateKeyPairSync('ed25519')
  await main
    .getByLabel('Public signing key (JWK)')
    .fill(JSON.stringify({ ...publicKey.export({ format: 'jwk' }), kid: 'juniper-sandbox' }))
  await main.getByRole('button', { name: 'Submit application' }).click()
  await expect(main.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/task-partners\/applications\/sandbox\/[A-Za-z0-9_.:-]+$/)
  await expect(main.getByRole('heading', { name: 'Verify domain ownership' })).toBeVisible()
  await expect(main.getByRole('heading', { name: 'Service signing keys' })).toBeVisible()
  await expect(main.getByRole('heading', { name: 'Production review' })).toHaveCount(0)
  const address = page.url()
  await page.setViewportSize({ width: 320, height: 700 })
  await page.reload()
  await expect(main.getByRole('heading', { name, exact: true })).toBeVisible()
  const geometry = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1)
  const other = await browser.newContext({ baseURL: new URL(address).origin })
  try {
    const outsider = await other.newPage()
    await signIn(outsider, 'maya')
    await outsider.goto(address)
    await expect(outsider.getByRole('main').getByRole('alert')).toBeVisible()
    await expect(outsider.getByRole('main').getByText(name, { exact: true })).toHaveCount(0)
  } finally {
    await other.close()
  }
})

test('a requester publishes volunteer work and can inspect a submitted result on the same task page', async ({
  page,
}) => {
  await signIn(page, 'ada')
  await page.goto('/projects/p-insights/open-work')
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Create task offer' }).click()
  const description = 'Peer feedback ' + Date.now()
  await main.getByLabel('What should the contributor deliver?').fill(description)
  await expect(main.getByRole('checkbox', { name: 'Offer a reserved reward' })).not.toBeChecked()
  await main.getByRole('button', { name: 'Save task draft' }).click()
  await expect(main.getByText(description, { exact: true })).toBeVisible()
  await main.getByRole('button', { name: 'Publish task' }).click()
  await expect(main.getByLabel('Your submission')).toBeVisible()
  await main.getByLabel('Your submission').fill('One specific improvement for the discussion.')
  await main.getByRole('button', { name: 'Submit work' }).click()
  await expect(main.getByText('One specific improvement for the discussion.', { exact: true })).toBeVisible()
  await expect(main.getByText('Acceptance · open · Compute proof · optional')).toBeVisible()
  const comment = 'The revised wording is ready for review.'
  await main.getByLabel('Comment on ' + description).fill(comment)
  await main.getByLabel('Comment on ' + description).press('Enter')
  await expect(main.getByText(comment, { exact: true })).toBeVisible()
  await page.goto('/projects/p-insights/open-work')
  const listed = main.getByRole('button', { name: description, exact: true })
  await expect(listed).toHaveCount(1)
  await listed.click()
  await expect(main.getByText(comment, { exact: true })).toBeVisible()
  await page.reload()
  await expect(main.getByRole('heading', { name: description, exact: true })).toBeVisible()
  await expect(main.getByText('One specific improvement for the discussion.', { exact: true })).toBeVisible()
})

test('acceptance requires an explicit executable rule for rewards and both approvals for a partner', async ({ page }) => {
  await signIn(page, 'ada')
  const eligible = {
    partnerId: 'juniper', displayName: 'Juniper', capabilities: ['custodian', 'verifier'],
    identity: { domainAscii: 'juniper.example', collisionSignals: [] },
    catalog: { rules: [{ ruleId: 'text-check', version: 2, digest: 'a'.repeat(64) }] },
  }
  const verifierOnly = { ...eligible, partnerId: 'willow', displayName: 'Willow', capabilities: ['verifier'] }
  await page.route('**/task-partners/production/catalog*', async (route) => {
    const q = new URL(route.request().url()).searchParams
    if (q.get('partnerId') === eligible.partnerId)
      return route.fulfill({ json: { items: [eligible] } })
    if (q.get('capability') !== 'verifier') return route.continue()
    const nextPage = q.get('cursor') === 'second'
    const match = !q.get('name') || q.get('name') === 'Juniper'
    await route.fulfill({ json: {
      items: !match ? [] : nextPage ? [eligible, verifierOnly] : [verifierOnly],
      nextCursor: match && !nextPage ? 'second' : null,
    } })
  })
  await page.goto('/projects/p-insights/open-work')
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Create task offer' }).click()
  const method = main.getByLabel('How is a submission accepted?')
  const reward = main.getByRole('checkbox', { name: 'Offer a reserved reward' })
  await expect(method).toHaveValue('none')
  await reward.check()
  await expect(method).toHaveValue('')
  expect(await method.evaluate((el: HTMLSelectElement) => el.validity.valueMissing)).toBe(true)
  await expect(method.getByRole('option', { name: 'Open-ended feedback' })).toHaveCount(0)
  await reward.uncheck()
  await expect(method).toHaveValue('none')
  await method.selectOption('partner')
  const verifier = main.getByLabel('Acceptance verifier', { exact: true })
  const rule = main.getByLabel('Executable rule')
  await main.getByLabel('Find an acceptance verifier').fill('Juniper')
  await main.getByRole('button', { name: 'Find partners' }).click()
  await expect(main.getByText('No matching custodian with published acceptance rules on this page.')).toBeVisible()
  await main.getByRole('button', { name: 'More matching partners' }).click()
  await expect(verifier.getByRole('option', { name: /Juniper/ })).toHaveCount(1)
  await expect(verifier.getByRole('option', { name: /Willow/ })).toHaveCount(0)
  await verifier.selectOption(eligible.partnerId)
  await expect(rule.getByRole('option', { name: 'text-check · version 2' })).toHaveCount(1)
  await expect(rule).toHaveValue('')
  await rule.selectOption({ label: 'text-check · version 2' })
  await main.getByRole('button', { name: 'First page' }).click()
  await expect(verifier).toHaveValue(eligible.partnerId)
  await reward.check()
  await expect(method).toHaveValue('partner')
  await expect(rule.locator('option:checked')).toHaveText('text-check · version 2')
  await main.getByLabel('What should the contributor deliver?').fill('Check the submitted text ' + randomUUID())
  const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 16)
  await main.getByLabel('Submission deadline', { exact: true }).fill(date(1))
  await main.getByLabel('Reward custodian', { exact: true }).selectOption('agent-commons')
  await main.getByLabel('Work credits promised').fill('2')
  await main.getByLabel('Reserve reward until').fill(date(3))
  const saved = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/task-drafts'))
  await main.getByRole('button', { name: 'Save task draft' }).click()
  expect((await saved).postDataJSON().acceptance).toEqual({
    kind: 'partner', partnerId: eligible.partnerId, rule: eligible.catalog.rules[0],
  })
  await main.getByRole('button', { name: 'Edit task terms' }).click()
  await expect(verifier).toHaveValue(eligible.partnerId)
  await expect(rule.locator('option:checked')).toHaveText('text-check · version 2')
  eligible.catalog.rules[0].digest = 'b'.repeat(64)
  await page.reload()
  await main.getByRole('button', { name: 'Edit task terms' }).click()
  await expect(main.getByText(/The selected version of text-check is unavailable/)).toBeVisible()
  await expect(rule).toHaveValue('')
  await method.selectOption('sha256-prefix')
  await expect(main.getByLabel('Required leading zero bits')).toBeVisible()
})

test('a held site reward pays the contributor who submits a verifiable result', async ({ page, browser }) => {
  await signIn(page, 'ada')
  const reference = randomUUID()
  const projects = await page.request.post('/api/v1/projects', {
    data: { name: 'Funded task ' + reference, description: 'Shared project for a nonce task.' },
  })
  expect(projects.ok()).toBeTruthy()
  const { project } = await projects.json()
  const shared = await page.request.post('/api/v1/relations/ops', {
    data: { op: { kind: 'share-project', projectId: project.id, projectName: project.name, shared: true } },
  })
  expect(shared.ok()).toBeTruthy()
  const issuance = await page.request.post('/api/v1/task-partners/credit-grants', {
    headers: { 'Idempotency-Key': reference },
    data: {
      userId: 'user-ada',
      tenantId: 'tenant-acme',
      quantity: '3',
      reference,
      reason: 'Test reward for a shared project',
    },
  })
  expect(issuance.status(), await issuance.text()).toBe(201)
  await page.goto('/projects/' + project.id + '/open-work')
  const owner = page.getByRole('main')
  await owner.getByRole('button', { name: 'Create task offer' }).click()
  await owner.getByLabel('What should the contributor deliver?').fill('Find a nonce for ' + reference)
  await owner.getByRole('checkbox', { name: 'Offer a reserved reward' }).check()
  const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 16)
  await owner.getByLabel('Submission deadline', { exact: true }).fill(date(2))
  await owner.getByRole('combobox', { name: 'Reward custodian', exact: true }).selectOption('agent-commons')
  await owner.getByLabel('Work credits promised').fill('3')
  await owner.getByLabel('Reserve reward until').fill(date(4))
  await owner.getByLabel('How is a submission accepted?').selectOption('sha256-prefix')
  await owner.getByLabel('Text prefix').fill(reference)
  await owner.getByLabel('Required leading zero bits').fill('4')
  await owner.getByRole('button', { name: 'Save task draft' }).click()
  await expect(owner.getByRole('button', { name: 'Publish task' })).toBeDisabled()
  await owner.getByRole('button', { name: 'Reserve 3 credits' }).click()
  await owner.getByRole('button', { name: 'Publish task' }).click()
  await expect(owner.getByLabel('Your submission')).toBeVisible()
  const address = page.url()
  const context = await browser.newContext({ baseURL: new URL(address).origin })
  try {
    const contributor = await context.newPage()
    await signIn(contributor, 'grace')
    const readBalance = async () =>
      BigInt((await (await contributor.request.get('/api/v1/task-partners/balance')).json()).available)
    const before = await readBalance()
    await contributor.goto(address)
    const work = contributor.getByRole('main')
    await expect(work.getByRole('button', { name: 'Create revised offer' })).toHaveCount(0)
    let nonce = 0
    while (
      createHash('sha256')
        .update(reference + nonce)
        .digest()[0] >= 16
    )
      nonce++
    await work.getByLabel('Your submission').fill(String(nonce))
    await work.getByRole('button', { name: 'Submit work' }).click()
    await expect(work.getByText('Funding · delivered')).toBeVisible()
    const download = contributor.waitForEvent('download')
    await work.getByRole('button', { name: 'Download submission' }).click()
    expect((await download).suggestedFilename()).toMatch(/^submission-.+[.]bin$/)
    expect(await readBalance()).toBe(before + 3n)
  } finally {
    await context.close()
  }
})
