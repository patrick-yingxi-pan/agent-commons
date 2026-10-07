/** Packaged owner-only Artifact history workflow: rendered explicit saved-version
 * search, exact revision address, comparison/consent, sharing walls and real
 * SQLite + ordinary process relaunch. No provider, model, or main-process seam.
 */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { prepareArtifactSearchSmoke, verifyArtifactSearchSmoke, verifyStaleArtifactSearchSmoke, readSqliteSearchBodies } from './artifactSearchSmoke.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TIMEOUT_MS = 30_000
const PASSWORD = 'isolated-artifact-history-fixture-password'

async function request(page, path, body, method = body === undefined ? 'GET' : 'POST', expectedStatus) {
  const headers = { 'content-type': 'application/json' }
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) headers['idempotency-key'] = randomUUID()
  return page.evaluate(async ({ path, body, method, expectedStatus, headers }) => {
    const response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (expectedStatus === undefined ? !response.ok : response.status !== expectedStatus) {
      throw new Error(`Artifact history smoke ${method} ${path}: HTTP ${response.status}, expected ${expectedStatus ?? 'success'}`)
    }
    return response.json()
  }, { path, body, method, expectedStatus, headers })
}

async function createDocument(page, name, body) {
  const created = await request(page, '/artifacts', { name, kind: 'doc', body })
  assert.equal(created.artifact.name, name)
  assert.equal(created.artifact.kind, 'doc')
  return created.artifact
}

async function editDocument(page, id, text) {
  return request(page, `/artifacts/${encodeURIComponent(id)}/content`, {
    block: 0, text, expectedRevision: 0,
  }, 'PATCH')
}

async function readHistory(page, id) {
  return request(page, `/artifacts/${encodeURIComponent(id)}/history`)
}

async function readVersion(page, id, revision) {
  return request(page, `/artifacts/${encodeURIComponent(id)}/history/${revision}`)
}

function readSqliteHistory(profile, artifactId) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = database.prepare('SELECT json FROM map_entries WHERE slice = ? AND key = ?')
      .get('artifactHistory', artifactId)
    assert.ok(row, 'the packaged SQLite database has the exact retained Artifact history row')
    return JSON.parse(row.json)
  } finally { database.close() }
}

async function openSearch(page, origin, query) {
  await page.goto(`${origin}/`)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const input = page.getByRole('textbox', { name: 'Search everything' })
  await expect(input).toBeVisible({ timeout: TIMEOUT_MS })
  if (query !== undefined) await input.fill(query)
  return input
}

function historyPage(page, id) {
  return page.locator(`[data-artifact-page="${id}"]`)
}

export async function smokePackagedArtifactHistory({ executable, launch, close }) {
  const profile = await mkdtemp(join(tmpdir(), 'agent-commons-artifact-history-smoke-'))
  const evidenceRoot = join(ROOT, '.data', 'desktop-artifact-history-smoke')
  let evidenceDirectory
  let run
  let stage = 'startup'
  try {
    await mkdir(evidenceRoot, { recursive: true })
    evidenceDirectory = await mkdtemp(join(evidenceRoot, 'run-'))
    run = await launch(executable, profile)
    let { page, origin } = run
    await page.setViewportSize({ width: 1280, height: 800 })

    const stamp = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
    const query = `retainedneedle${stamp}`
    const baseline = `Owner-authored historical text ${query}. This exact saved paragraph must remain available.`
    const edited = `Current body only ${stamp}.`
    const artifactName = `Packaged history ${stamp}.md`
    const owner = await request(page, '/auth/signup', {
      name: 'Packaged History Owner', email: `artifact-history-owner-${stamp}@example.test`, password: PASSWORD,
    })
    const artifact = await createDocument(page, artifactName, baseline)
    await editDocument(page, artifact.id, edited)
    const historyPath = `/artifacts/${encodeURIComponent(artifact.id)}/history/0`
    const historySearchMatchPath = `${historyPath}/match/doc.block.0.p`
    const restorePath = `/api/v1/artifacts/${encodeURIComponent(artifact.id)}/history/0/restore`
    const originalVersion = await readVersion(page, artifact.id, 0)
    const editedVersion = await readVersion(page, artifact.id, 1)
    assert.equal(JSON.stringify(originalVersion.version.body).includes(baseline), true)
    assert.equal(JSON.stringify(editedVersion.version.body).includes(edited), true)

    stage = 'current-body-search-reveal'
    const searchFixtures = await prepareArtifactSearchSmoke({ page, request, stamp })
    await verifyArtifactSearchSmoke({ page, origin, request, fixtures: searchFixtures, evidenceDirectory, phase: 'before-relaunch' })

    stage = 'current-search-and-explicit-saved-search'
    const input = await openSearch(page, origin, query)
    await expect(page.getByText(`No matches for “${query}”.`, { exact: true })).toBeVisible({ timeout: TIMEOUT_MS })
    await expect(page.locator(`[data-search-result^="artifactVersion-${artifact.id}-"]`)).toHaveCount(0)
    await page.getByRole('button', { name: 'Search saved versions', exact: true }).click()
    const hit = page.locator(`[data-search-result="artifactVersion-${artifact.id}-0"]`)
    await expect(hit).toBeVisible({ timeout: TIMEOUT_MS })
    await expect(hit).toContainText('Version 0 · Baseline')
    await page.screenshot({ path: join(evidenceDirectory, 'owner-explicit-search.png') })

    const mutations = []
    const currentLibraryReads = []
    const observeOwner = outgoing => {
      const url = new URL(outgoing.url())
      if (outgoing.method() === 'GET' && url.pathname === '/api/v1/artifact-content') currentLibraryReads.push(url.href)
      if (url.pathname.startsWith(`/api/v1/artifacts/${encodeURIComponent(artifact.id)}`) &&
        ['POST', 'PATCH', 'PUT', 'DELETE'].includes(outgoing.method())) mutations.push(`${outgoing.method()} ${url.pathname}`)
    }
    page.on('request', observeOwner)
    try {
      await expect(hit).toHaveAttribute('data-search-active', 'true')
      await input.press('Enter')
      await expect(page).toHaveURL(`${origin}${historySearchMatchPath}`)
      await expect(page.getByRole('heading', { name: `${artifactName} · Version 0`, exact: true })).toBeVisible()
      const detail = historyPage(page, artifact.id)
      await expect(detail.locator('[data-artifact-search-reveal="ready"]')).toBeVisible()
      await expect(detail.locator('[data-artifact-search-match][data-artifact-search-field="doc.block.0.p"]')).toHaveCount(1)
      await expect(detail.locator('[data-artifact-history-body]')).toContainText(baseline)
      await expect(detail.locator('[data-artifact-history-body]')).not.toContainText(edited)
      await expect(detail.getByRole('button', { name: 'Compare with current', exact: true })).toBeVisible()
      assert.deepEqual(mutations, [], 'opening the exact saved revision performs no Artifact mutation')
      assert.deepEqual(currentLibraryReads, [], 'saved preview does not read the current-content library')
      await page.reload()
      await expect(page).toHaveURL(`${origin}${historySearchMatchPath}`)
      await expect(detail.locator('[data-artifact-history-body]')).toContainText(baseline)
      await expect(detail.locator('[data-artifact-search-match][data-artifact-search-field="doc.block.0.p"]')).toHaveCount(1)
      assert.deepEqual(currentLibraryReads, [], 'direct revision reload remains on retained content without a current-library read')
      await page.screenshot({ path: join(evidenceDirectory, 'owner-exact-revision-reload.png') })

      stage = 'comparison-cancel-and-current-back'
      await detail.getByRole('button', { name: 'Compare with current', exact: true }).click()
      const comparison = detail.locator('[data-artifact-history-comparison]')
      await expect(comparison).toHaveAttribute('data-comparison-current-revision', '1')
      await expect(comparison).toHaveAttribute('data-comparison-selected-revision', '0')
      await expect(comparison).toContainText(baseline)
      await expect(comparison).toContainText(edited)
      assert.deepEqual(currentLibraryReads, [], 'comparison uses exact saved-body routes, not the broad current-content library')
      await detail.getByRole('button', { name: 'Restore version 0', exact: true }).click()
      const confirmation = page.getByRole('dialog', { name: 'Restore artifact version', exact: true })
      await expect(confirmation).toContainText('current version 1')
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(confirmation).toHaveCount(0)
      assert.deepEqual(mutations, [], 'cancelled restore consent makes no write')

      await detail.getByRole('button', { name: 'View version', exact: true }).click()
      await detail.getByRole('button', { name: 'View current artifact', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/artifacts/${encodeURIComponent(artifact.id)}$`))
      await expect(historyPage(page, artifact.id).locator('[data-resource-section="Content"]')).toContainText(edited)
      await page.goBack()
      await expect(page).toHaveURL(`${origin}${historySearchMatchPath}`)
      await expect(historyPage(page, artifact.id).locator('[data-artifact-history-body]')).toContainText(baseline)
      await expect(historyPage(page, artifact.id).locator('[data-artifact-search-match][data-artifact-search-field="doc.block.0.p"]')).toHaveCount(1)
      assert.deepEqual(mutations, [], 'current/back navigation remains read-only')

      stage = 'unavailable-revision-no-fallback'
      await page.goto(`${origin}/artifacts/${encodeURIComponent(artifact.id)}/history/99999`)
      await expect(historyPage(page, artifact.id).locator('[data-artifact-version-unavailable]'))
        .toContainText('Current content has not been substituted.')
      await expect(historyPage(page, artifact.id).locator('[data-artifact-history-body]')).toHaveCount(0)
      await expect(historyPage(page, artifact.id).locator('[data-resource-section="Content"]')).toHaveCount(0)
      await page.screenshot({ path: join(evidenceDirectory, 'owner-unavailable-revision.png') })
    } finally {
      page.off('request', observeOwner)
    }

    stage = 'shared-and-foreign-privacy'
    const reader = await request(page, '/auth/signup', {
      name: 'Packaged History Reader', email: `artifact-history-reader-${stamp}@example.test`, password: PASSWORD,
    })
    await request(page, '/auth/session', { userId: owner.user.id })
    const grant = await request(page, '/grants', {
      subject: { kind: 'artifact', id: artifact.id },
      audience: { kind: 'org', orgId: reader.tenant.id }, tier: 'view',
    })
    assert.ok(grant.id, 'owner can grant the current Artifact to the generated reader account')
    const foreign = await request(page, '/auth/signup', {
      name: 'Packaged History Foreign', email: `artifact-history-foreign-${stamp}@example.test`, password: PASSWORD,
    })
    await request(page, '/auth/session', { userId: reader.user.id })
    await page.goto(`${origin}/artifacts/${encodeURIComponent(artifact.id)}`)
    await expect(historyPage(page, artifact.id).locator('[data-resource-section="Content"]')).toContainText(edited)
    await openSearch(page, origin, query)
    await page.getByRole('button', { name: 'Search saved versions', exact: true }).click()
    await expect(page.getByText('No matches on this page. Go back to review current results.', { exact: true })).toBeVisible()
    await expect(page.getByText('0–0 of 0', { exact: true })).toBeVisible()
    await page.goto(`${origin}${historyPath}`)
    await expect(page.getByRole('heading', { name: `${artifactName} · Version 0`, exact: true })).toBeVisible()
    const readerDetail = historyPage(page, artifact.id)
    await expect(readerDetail.getByRole('status')).toContainText('Saved versions are available only to the artifact owner.')
    await expect(readerDetail.locator('[data-artifact-history-body]')).toHaveCount(0)
    await expect(readerDetail.getByRole('button', { name: /Restore version/ })).toHaveCount(0)
    await expect(page.getByText(baseline, { exact: false })).toHaveCount(0)
    await page.screenshot({ path: join(evidenceDirectory, 'shared-reader-history-wall.png') })

    await request(page, '/auth/session', { userId: foreign.user.id })
    await page.goto(`${origin}${historyPath}`)
    await expect(page.locator('[data-resource-unavailable]'))
      .toContainText('This artifact isn’t visible from this account (or no longer exists).')
    await expect(page.getByText(baseline, { exact: false })).toHaveCount(0)
    await openSearch(page, origin, query)
    await page.getByRole('button', { name: 'Search saved versions', exact: true }).click()
    await expect(page.getByText('No matches on this page. Go back to review current results.', { exact: true })).toBeVisible()
    await page.screenshot({ path: join(evidenceDirectory, 'foreign-search-wall.png') })

    await request(page, '/auth/session', { userId: owner.user.id })
    await page.goto(`${origin}/artifacts/${encodeURIComponent(artifact.id)}/history/0`)
    await expect(historyPage(page, artifact.id).locator('[data-artifact-history-body]')).toContainText(baseline)

    stage = 'owner-confirmed-restore'
    let restoreIntent
    let restoreResult
    const restoreRequests = []
    const observeRestoreRequest = outgoing => {
      if (outgoing.method() === 'POST' && new URL(outgoing.url()).pathname === restorePath) {
        restoreRequests.push(outgoing.url())
        restoreIntent = { key: outgoing.headers()['idempotency-key'], body: outgoing.postDataJSON() }
      }
    }
    page.on('request', observeRestoreRequest)
    try {
      const detail = historyPage(page, artifact.id)
      await detail.getByRole('button', { name: 'Restore version 0', exact: true }).click()
      const confirmation = page.getByRole('dialog', { name: 'Restore artifact version', exact: true })
      await expect(confirmation).toContainText('current version 1')
      const restoreResponsePromise = page.waitForResponse(incoming =>
        incoming.request().method() === 'POST' && new URL(incoming.url()).pathname === restorePath)
      await confirmation.getByRole('button', { name: 'Restore version', exact: true }).click()
      const restoreResponse = await restoreResponsePromise
      assert.equal(restoreResponse.status(), 200, 'explicit restore is acknowledged by the packaged backend')
      restoreResult = await restoreResponse.json()
      await expect(detail.locator('[data-artifact-history-restored]'))
        .toHaveText('Restored version 0 as current version 2. You are still viewing saved version 0.')
      await expect(page).toHaveURL(new RegExp(`/artifacts/${encodeURIComponent(artifact.id)}/history/0$`))
      assert.ok(restoreIntent?.key, 'confirmed restore sends one durable logical key')
      assert.equal(restoreRequests.length, 1, 'explicit confirmation sends exactly one restore request')
      assert.deepEqual(restoreIntent.body, { expectedRevision: 1 })
      assert.equal(restoreResult.artifactId, artifact.id)
      assert.equal(restoreResult.currentRevision, 2)
      assert.equal(restoreResult.version.revision, 2)
      assert.equal(restoreResult.version.restoredFromRevision, 0)
      assert.deepEqual(restoreResult.version.body, originalVersion.version.body,
        'restore receipt carries the exact selected saved body')
      const restoredHistory = await readHistory(page, artifact.id)
      assert.equal(restoredHistory.currentRevision, 2)
      assert.deepEqual(restoredHistory.versions.map(({ revision }) => revision), [2, 1, 0])
      const currentBodies = await request(page, '/artifact-content')
      assert.deepEqual(currentBodies[artifact.id], { ...originalVersion.version.body, revision: 2 },
        'current body after restore is exactly the addressed saved body at new revision 2')
      await page.screenshot({ path: join(evidenceDirectory, 'owner-restored-exact-revision.png') })
    } finally {
      page.off('request', observeRestoreRequest)
    }

    stage = 'sqlite-and-ordinary-relaunch'
    await verifyStaleArtifactSearchSmoke({ page, origin, artifactId: artifact.id, oldRevision: 1,
      expectedText: baseline, evidenceDirectory, phase: 'before-relaunch' })
    const searchBodiesBeforeQuit = readSqliteSearchBodies(profile, searchFixtures)
    const historyBeforeQuit = readSqliteHistory(profile, artifact.id)
    assert.deepEqual(historyBeforeQuit.map(({ revision }) => revision), [0, 1, 2])
    assert.deepEqual(historyBeforeQuit.map(({ revision, body }) => ({ revision, body })), [
      { revision: 0, body: originalVersion.version.body },
      { revision: 1, body: editedVersion.version.body },
      { revision: 2, body: originalVersion.version.body },
    ], 'SQLite stores the exact baseline, edit and restored body versions')
    const oldOrigin = origin
    await close(run)
    run = undefined
    await assert.rejects(fetch(`${oldOrigin}/api/v1/me`, { signal: AbortSignal.timeout(1_000) }),
      'the packaged service exits before the independent relaunch')
    assert.deepEqual(readSqliteHistory(profile, artifact.id), historyBeforeQuit,
      'the exact retained revisions are committed in SQLite before relaunch')
    assert.deepEqual(readSqliteSearchBodies(profile, searchFixtures), searchBodiesBeforeQuit,
      'the exact current search bodies are committed before relaunch')

    run = await launch(executable, profile)
    ;({ page, origin } = run)
    await page.setViewportSize({ width: 1280, height: 800 })
    assert.equal((await request(page, '/me')).user.id, owner.user.id, 'ordinary relaunch preserves the signed-in owner')
    stage = 'current-body-search-after-relaunch'
    await verifyArtifactSearchSmoke({ page, origin, request, fixtures: searchFixtures, evidenceDirectory, phase: 'after-relaunch' })
    await verifyStaleArtifactSearchSmoke({ page, origin, artifactId: artifact.id, oldRevision: 1,
      expectedText: baseline, evidenceDirectory, phase: 'after-relaunch' })
    assert.deepEqual(readSqliteSearchBodies(profile, searchFixtures), searchBodiesBeforeQuit,
      'ordinary signed-in relaunch preserves exact current search bodies without rewrites')
    await page.goto(`${origin}/artifacts/${encodeURIComponent(artifact.id)}/history/0`)
    await expect(page).toHaveURL(new RegExp(`/artifacts/${encodeURIComponent(artifact.id)}/history/0$`))
    await expect(historyPage(page, artifact.id).locator('[data-artifact-history-body]')).toContainText(baseline)
    await page.screenshot({ path: join(evidenceDirectory, 'owner-exact-revision-after-relaunch.png') })

    stage = 'saved-search-and-receipt-replay-after-relaunch'
    await openSearch(page, origin, query)
    await page.getByRole('button', { name: 'Search saved versions', exact: true }).click()
    const resumedHit = page.locator(`[data-search-result="artifactVersion-${artifact.id}-0"]`)
    await expect(resumedHit).toBeVisible({ timeout: TIMEOUT_MS })
    await expect(resumedHit).toContainText('Version 0 · Baseline')
    await page.screenshot({ path: join(evidenceDirectory, 'owner-search-after-relaunch.png') })
    await resumedHit.click()
    await expect(page).toHaveURL(`${origin}${historySearchMatchPath}`)
    await expect(historyPage(page, artifact.id).locator('[data-artifact-history-body]')).toContainText(baseline)
    await expect(historyPage(page, artifact.id).locator('[data-artifact-search-match][data-artifact-search-field="doc.block.0.p"]')).toHaveCount(1)
    const replay = await page.evaluate(async ({ restorePath, key, body }) => {
      const response = await fetch(restorePath, {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`Restore receipt replay failed: HTTP ${response.status}`)
      return response.json()
    }, { restorePath, key: restoreIntent.key, body: restoreIntent.body })
    assert.deepEqual(replay, restoreResult, 'same-key replay returns the exact durable restore receipt')
    const finalHistory = await readHistory(page, artifact.id)
    assert.equal(finalHistory.currentRevision, 2)
    assert.deepEqual(finalHistory.versions.map(({ revision }) => revision), [2, 1, 0],
      'receipt replay after restart does not append another revision')
    const finalBodies = await request(page, '/artifact-content')
    assert.deepEqual(finalBodies[artifact.id], { ...originalVersion.version.body, revision: 2 },
      'relaunch retains the exact restored current body')
    const finalSqliteHistory = readSqliteHistory(profile, artifact.id)
    assert.deepEqual(finalSqliteHistory, historyBeforeQuit)

    const asarPath = join(dirname(executable), process.platform === 'darwin' ? '../Resources/app.asar' : 'resources/app.asar')
    const asarHash = createHash('sha256').update(await readFile(asarPath)).digest('hex')
    await writeFile(join(evidenceDirectory, 'receipt.json'), `${JSON.stringify({
      checkedAt: new Date().toISOString(), asarSha256: asarHash,
      ownerId: owner.user.id, artifactId: artifact.id, ordinaryCurrentSearchExcludedBaseline: true,
      explicitSearchRevisionZero: true, exactRevisionReloadAndBack: true,
      comparisonAndCancelledRestoreWereReadOnly: true, sharedReaderCurrentOnly: true,
      foreignAccountHistoryHidden: true, confirmedRestoreCurrentRevision: 2,
      retainedRevisions: finalSqliteHistory.map(({ revision, reason, restoredFromRevision }) => ({ revision, reason, restoredFromRevision })),
      sameKeyRestoreReplayAddedNoRevision: true,
      currentSearchMatches: searchFixtures.map(({ id, label, field }) => ({ artifactId: id, format: label, revision: 0, field })),
      currentSearchReloadBackAndFocus: true, currentSearchSqliteRelaunch: true,
      currentSearchMadeNoArtifactWritesOrHistoryReads: true, staleCurrentLocatorSelectedNothing: true,
      scope: 'Ordinary packaged unsigned host-architecture app, generated isolated profile/accounts, real SQLite, no provider/model/service. Not signed/notarized, Intel, or paid-provider acceptance.',
    }, null, 2)}\n`, { mode: 0o600 })
    console.log('[desktop-artifact-history-smoke] four-format current search/reveal/focus · stale locator refusal · explicit saved-version search · exact revision reload/back · shared/foreign privacy · read-only compare/cancel · confirmed restore · real SQLite + signed-in full relaunch + exact receipt replay')
    console.log(`[desktop-artifact-history-smoke] evidence ${evidenceDirectory}`)
  } catch (error) {
    if (run && evidenceDirectory) await run.page.screenshot({ path: join(evidenceDirectory, 'failure.png') }).catch(() => {})
    throw new Error(`Packaged Artifact history workflow failed at ${stage}: ${error.message}`, { cause: error })
  } finally {
    try { await close(run) }
    finally { await rm(profile, { recursive: true, force: true }) }
  }
}
