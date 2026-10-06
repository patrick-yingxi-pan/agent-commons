/** Ordinary packaged-process acceptance: only the Messages peer is a fixture.
 * No mock keychain, injected store, native bridge, or production credential is used.
 * Setup crosses the shipped HTTP API; review and landing cross rendered controls.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { REVIEW_SMOKE_MODEL, startContributionReviewSmokeEndpoint } from './contributionReviewSmokeFixture.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TIMEOUT_MS = 30_000
const PRIVATE_CANARY = 'NOT_FOR_REVIEW_private_project_and_discussion_context'

async function request(page, path, body, key) {
  return page.evaluate(async ({ path, body, key }) => {
    const response = await fetch(`/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(`Packaged review precondition ${path}: HTTP ${response.status}`)
    return response.json()
  }, { path, body, key })
}

function storedState(profile, contributionId, tenantId) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = database.prepare('SELECT json FROM entities WHERE slice = ? AND entity_id = ?')
      .get('contributions', contributionId)
    const meter = database.prepare('SELECT json FROM map_entries WHERE slice = ? AND key = ?')
      .get('usageMeters', tenantId)
    return { contribution: row ? JSON.parse(row.json) : undefined, usage: meter ? JSON.parse(meter.json) : undefined }
  } finally {
    database.close()
  }
}

function assertSpend(state, completedCalls) {
  assert.equal(state.usage?.fiveHour.consumed ?? 0, completedCalls * (137 + 29))
  assert.equal(state.usage?.weekly.consumed ?? 0, completedCalls * (137 + 29))
}

/** launch/close are the ordinary executable host used by the existing smoke,
 * not Playwright's main-process launcher with mock-keychain switches. */
export async function smokePackagedContributionReview({ executable, launch, close }) {
  const profile = await mkdtemp(join(tmpdir(), 'agent-commons-review-smoke-'))
  const evidenceDirectory = join(ROOT, '.data', 'desktop-review-smoke')
  let fixture
  let run
  let stage = 'startup'
  try {
    await mkdir(evidenceDirectory, { recursive: true })
    fixture = await startContributionReviewSmokeEndpoint()
    run = await launch(executable, profile)
    let { page, origin } = run
    const identity = await request(page, '/auth/signup', {
      name: 'Packaged Review Owner', email: 'packaged-review@example.test', password: 'isolated-review-fixture-password',
    })
    await page.reload()
    const provider = await request(page, '/providers', {
      label: 'Packaged local review endpoint', modelFamily: 'claude', effortLevels: ['Low'],
      models: [{ id: REVIEW_SMOKE_MODEL, label: 'Packaged review fixture' }],
      config: { baseURL: fixture.origin, model: REVIEW_SMOKE_MODEL },
    }, 'packaged-review-provider')
    const prompt = await request(page, '/system-prompts', {
      label: 'Packaged review instructions', body: 'Review only the supplied changeset.', targetFamily: 'claude',
    }, 'packaged-review-prompt')
    const agent = await request(page, '/agents', {
      label: 'Packaged review Agent', providerId: provider.id, systemPromptId: prompt.id,
      tools: [], instructions: 'Find concrete issues and return the required JSON.',
    }, 'packaged-review-agent')
    const { project } = await request(page, '/projects', { name: 'Packaged review workflow', description: PRIVATE_CANARY })
    const contribution = await request(page, `/projects/${project.id}/contributions`, {
      title: 'Review a packaged release note', summary: PRIVATE_CANARY,
    }, 'packaged-review-contribution')
    const path = `/projects/${project.id}/contributions/${contribution.id}`
    const frozen = await request(page, `${path}/changeset`, {
      entries: [{ kind: 'note', target: 'Release note', before: 'Old note.', after: 'A frozen release note for local review.' }],
    })
    const version = frozen.changeset.at(-1)
    const route = `/projects/${project.id}/changes/${contribution.id}`
    const current = async () => (await request(page, `/projects/${project.id}/contributions`))
      .find(candidate => candidate.id === contribution.id)
    const saved = () => storedState(profile, contribution.id, identity.tenant.id)
    const captured = []
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1${path}/review`) {
        captured.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'] })
      }
    })

    stage = 'findings'
    await page.goto(`${origin}${route}`)
    let panel = page.getByRole('region', { name: 'Model reviews', exact: true })
    await panel.getByRole('combobox', { name: 'Reviewing Agent' }).selectOption(agent.id)
    await expect(panel).toContainText('Project owner’s budget is charged')
    assert.equal(fixture.requests.length, 0, 'opening and selecting a reviewer never dispatches')
    await panel.getByRole('button', { name: 'Run review · uses budget', exact: true }).click()
    await expect(panel.locator('[data-review-status="findings"]')).toBeVisible({ timeout: TIMEOUT_MS })
    assert.equal(fixture.requests.length, 1)
    const input = fixture.requests[0]
    assert.equal(input.tools, undefined, 'the packaged review request has no tools')
    assert.equal(input.messages.length, 1)
    assert.equal(input.messages[0].role, 'user')
    assert.deepEqual(JSON.parse(input.messages[0].content), {
      version: version.version,
      entries: version.entries.map(({ id, kind, target, before, after }) => ({ id, kind, target, before, after })),
    }, 'the actual packaged wire contains only the frozen changeset')
    assert.doesNotMatch(JSON.stringify(input), new RegExp(PRIVATE_CANARY))
    assert.equal((await current()).status, 'open', 'findings never land automatically')
    assertSpend(saved(), 1)
    await page.screenshot({ path: join(evidenceDirectory, 'findings.png') })

    stage = 'passed'
    fixture.setMode('passed')
    await panel.getByRole('button', { name: 'Run review · uses budget', exact: true }).click()
    await expect(panel.locator('[data-review-status="passed"]')).toBeVisible({ timeout: TIMEOUT_MS })
    const completed = await current()
    assert.equal(completed.status, 'open', 'a passing model verdict still needs a separate human Land action')
    assert.equal(completed.reviewedVersion, version.version)
    assertSpend(saved(), 2)

    stage = 'pending-before-quit'
    fixture.setMode('hold')
    await panel.getByRole('button', { name: 'Run review · uses budget', exact: true }).click()
    await expect.poll(() => fixture.requests.length).toBe(3)
    await expect.poll(() => saved().contribution.reviewAttempts.at(-1).status).toBe('pending')
    assert.equal(captured.length, 3)
    const interruptedRequest = captured.at(-1)
    assert.ok(interruptedRequest.key, 'the actual rendered request carries one replay identity')
    const beforeQuit = saved()
    const pending = beforeQuit.contribution.reviewAttempts.at(-1)
    assertSpend(beforeQuit, 2)
    const oldOrigin = origin
    await close(run)
    run = undefined
    await assert.rejects(fetch(`${oldOrigin}/api/v1/me`, { signal: AbortSignal.timeout(1_000) }),
      'the old packaged service is gone before independent relaunch')
    assert.equal(saved().contribution.reviewAttempts.at(-1).status, 'pending',
      'the real interrupted request left a durable pending receipt, not a test-injected snapshot')

    stage = 'relaunch-uncertain'
    fixture.setMode('passed')
    run = await launch(executable, profile)
    ;({ page, origin } = run)
    const reopenedIdentity = await request(page, '/me')
    assert.equal(reopenedIdentity.user.id, identity.user.id, 'ordinary OS-backed sign-in survives relaunch')
    await page.goto(`${origin}${route}`)
    panel = page.getByRole('region', { name: 'Model reviews', exact: true })
    await expect(panel.locator('[data-review-status="uncertain"]')).toBeVisible({ timeout: TIMEOUT_MS })
    const recovered = await current()
    assert.deepEqual(recovered.reviews.slice(0, 2), completed.reviews, 'prior results survive exactly')
    assert.equal(recovered.reviews.at(-1).id, pending.id)
    assert.equal(recovered.reviewedVersion, undefined, 'uncertainty supersedes the earlier passing verdict')
    assert.equal(recovered.status, 'open')
    assert.equal(saved().contribution.reviewAttempts.at(-1).status, 'uncertain', 'startup recovery itself is durable')
    assert.deepEqual(saved().usage, beforeQuit.usage, 'restart does not invent spend or reset meter windows')
    const replay = await request(page, `${path}/review`, interruptedRequest.body, interruptedRequest.key)
    assert.deepEqual(replay.reviews, recovered.reviews, 'same-key Retry returns durable history after restart')
    assert.equal(fixture.requests.length, 3, 'mount, restart and exact Retry cannot dispatch again')
    await page.screenshot({ path: join(evidenceDirectory, 'recovered-uncertain.png') })

    stage = 'explicit-rerun-and-land'
    await panel.getByRole('combobox', { name: 'Reviewing Agent' }).selectOption(agent.id)
    await panel.getByRole('button', { name: 'Run another review · uses budget again', exact: true }).click()
    await expect(panel.locator('[data-review-status="passed"]')).toHaveCount(2, { timeout: TIMEOUT_MS })
    assert.equal(fixture.requests.length, 4, 'only a new explicit act dispatches the fourth review')
    assert.equal((await current()).status, 'open')
    assertSpend(saved(), 3)
    await page.getByRole('button', { name: 'Land', exact: true }).click()
    await expect.poll(async () => (await current()).status).toBe('landed')
    const final = saved()
    assert.deepEqual(final.contribution.reviewAttempts.map(attempt => attempt.status), ['findings', 'passed', 'uncertain', 'passed'])
    const backup = await page.evaluate(() => window.agentCommonsDesktop.data.createBackup())
    assert.match(backup.fileName, /^backup-[A-Za-z0-9.-]+\.json$/)
    const portable = JSON.parse(await readFile(join(profile, 'snapshots', backup.fileName), 'utf8'))
    assert.deepEqual(portable.contributions.find(candidate => candidate.id === contribution.id).reviewAttempts,
      final.contribution.reviewAttempts, 'the real managed backup preserves every exact private receipt')
    await page.screenshot({ path: join(evidenceDirectory, 'landed.png') })
    const asarPath = join(dirname(executable), process.platform === 'darwin' ? '../Resources/app.asar' : 'resources/app.asar')
    const evidence = {
      checkedAt: new Date().toISOString(), executable,
      asarSha256: createHash('sha256').update(await readFile(asarPath)).digest('hex'),
      requestCount: fixture.requests.length, completedCalls: 3,
      statuses: final.contribution.reviewAttempts.map(attempt => attempt.status),
      contributionStatus: final.contribution.status,
      usage: final.usage,
      scope: 'Ordinary unsigned host-architecture package; local Messages fixture only. Not paid-provider, signed/notarized or Intel acceptance.',
    }
    await writeFile(join(evidenceDirectory, 'receipt.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
    console.log('[desktop-review-smoke] rendered owner review · frozen no-tools wire · exact spend · real pending interruption · durable uncertain relaunch · no replay · explicit rerun · separate Land · portable backup')
  } catch (error) {
    if (run) await run.page.screenshot({ path: join(evidenceDirectory, 'failure.png') }).catch(() => {})
    throw new Error(`Packaged contribution review failed at ${stage}: ${error.message}`, { cause: error })
  } finally {
    try {
      await close(run)
    } finally {
      try { await fixture?.close() }
      finally { await rm(profile, { recursive: true, force: true }) }
    }
  }
}
