/** Packaged saved Artifact copies: rendered attach/send/refresh/detach, real
 * SQLite, account-grant boundaries, source deletion, and ordinary relaunch. */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TIMEOUT_MS = 30_000
const PASSWORD = 'isolated-artifact-context-fixture-password'

async function api(page, path, body, method = body === undefined ? 'GET' : 'POST', expectedStatus, headers = {}) {
  return page.evaluate(async ({ path, body, method, expectedStatus, headers }) => {
    const response = await fetch(`/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (expectedStatus === undefined ? !response.ok : response.status !== expectedStatus) {
      throw new Error(`Artifact context smoke ${method} ${path}: HTTP ${response.status}, expected ${expectedStatus ?? 'success'}`)
    }
    if (response.status === 204) return undefined
    return response.json()
  }, { path, body, method, expectedStatus, headers })
}

export function readSqliteArtifactContext(profile, sessionId, artifactId) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = database.prepare('SELECT json FROM map_entries WHERE slice = ? AND key = ?').get('workspaces', sessionId)
    assert.ok(row, 'SQLite retains the exact destination workspace')
    const workspace = JSON.parse(row.json)
    const attachment = workspace.attachments?.find((item) => item.kind === 'artifact' && item.artifactSnapshot?.artifactId === artifactId)
    assert.ok(attachment, 'SQLite retains the exact Artifact attachment identity')
    return attachment.artifactSnapshot
  } finally { database.close() }
}

function exactSnapshotText(snapshot) {
  return JSON.stringify({ title: snapshot.title, artifactKind: snapshot.artifactKind, revision: snapshot.revision, body: snapshot.body })
}

function latestUserContent(wire) {
  return wire.messages.filter((message) => message.role === 'user').at(-1)?.content
}

function attachedDocument(content) {
  assert.equal(typeof content, 'string', 'the Artifact test request is sent as a text model message')
  const marker = content.lastIndexOf('\n\n{"attached_files":')
  assert.ok(marker > 0, 'the rendered send appends the canonical attached_files document')
  return { userText: content.slice(0, marker), envelope: JSON.parse(content.slice(marker + 2)) }
}

async function openCopy(page, title) {
  const chip = page.getByTitle('Open in sidebar').filter({ hasText: title }).filter({ visible: true })
  await expect(chip).toBeVisible({ timeout: TIMEOUT_MS })
  if (!(await chip.getAttribute('class'))?.includes('ring-accent')) await chip.click()
  const panel = page.locator('[data-artifact-context-panel]').filter({ visible: true })
  await expect(panel).toBeVisible({ timeout: TIMEOUT_MS })
  return panel
}

async function attachFromRenderedPicker(page, title) {
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
  await picker.getByRole('button', { name: /^Artifact/ }).click()
  const list = picker.locator('[data-artifact-context-picker]')
  await expect(list).toBeVisible({ timeout: TIMEOUT_MS })
  await list.getByRole('button', { name: title, exact: true }).click()
  const confirm = picker.locator('[data-artifact-context-confirm]')
  await expect(confirm).toContainText('Everyone with access to the destination conversation can read it.')
  await expect(confirm).toContainText('Revoking access to the source later won’t erase this copy')
  await expect(confirm).toContainText('It won’t update live.')
  await confirm.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
  await picker.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(picker).toHaveCount(0)
}

async function sendWithSnapshot({ page, request, fixture, sessionPath, snapshot, prompt }) {
  const beforeRequests = fixture.requests.length
  const reply = `Read supplied attachment: ${exactSnapshotText(snapshot)}`
  const turns = page.locator('[data-turn]').filter({ hasText: 'Read supplied attachment:' })
  const previousTurns = await turns.count()
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill(prompt)
  await composer.press('Enter')
  await expect(turns).toHaveCount(previousTurns + 1, { timeout: TIMEOUT_MS })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: TIMEOUT_MS })
  const savedSession = await request(page, sessionPath)
  assert.equal(savedSession.messages.at(-1).role, 'assistant')
  assert.equal(savedSession.messages.at(-1).content, reply, 'the durable reply echoes the exact recorded body representation')
  assert.equal(fixture.requests.length, beforeRequests + 1, 'one send reaches the local model exactly once')
  const wire = fixture.requests.at(-1)
  const parsed = attachedDocument(latestUserContent(wire))
  const snapshotText = exactSnapshotText(snapshot)
  assert.equal(parsed.userText, prompt)
  assert.deepEqual(parsed.envelope, {
    attached_files: [{
      name: snapshot.title,
      status: 'ready',
      kind: 'artifact',
      captured_at: snapshot.capturedAt,
      artifact_kind: snapshot.artifactKind,
      revision: snapshot.revision,
      text: snapshotText,
    }],
    omitted_items: 0,
  }, 'the model receives exactly the complete saved body and its recorded revision metadata')
  assert.ok(JSON.stringify(wire).includes('Artifact entries are frozen saved copies of the complete readable body'),
    'the model receives the untrusted-reference and no-source-authority instruction')
  return savedSession
}

async function sendWithoutArtifact({ page, request, fixture, sessionPath, prompt }) {
  const beforeRequests = fixture.requests.length
  const turns = page.locator('[data-turn]').filter({ hasText: 'No supplied attachment text.' })
  const previousNoAttachmentTurns = await turns.count()
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill(prompt)
  await composer.press('Enter')
  await expect(turns).toHaveCount(previousNoAttachmentTurns + 1, { timeout: TIMEOUT_MS })
  const savedSession = await request(page, sessionPath)
  assert.equal(savedSession.messages.at(-1).content, 'No supplied attachment text.')
  assert.equal(fixture.requests.length, beforeRequests + 1)
  const wire = fixture.requests.at(-1)
  assert.equal(latestUserContent(wire), prompt, 'detaching leaves only the new user text in model input')
  return savedSession
}

/**
 * Runs against the existing ordinary packaged app/profile and returns the
 * relaunched process for the caller's normal cleanup. Source and reader are
 * separate real accounts; only the model endpoint is a loopback fixture.
 */
export async function smokePackagedArtifactContext({ run, executable, profile, launch, close, request, owner, providerId, fixture }) {
  const evidenceRoot = join(ROOT, '.data', 'desktop-artifact-context-smoke')
  await mkdir(evidenceRoot, { recursive: true })
  const evidenceDirectory = await mkdtemp(join(evidenceRoot, 'run-'))
  let stage = 'create-source-account'
  let { page, origin } = run
  try {
    const sourceOwner = await api(page, '/auth/signup', {
      name: 'Packaged Artifact Source', email: 'artifact-source@example.test', password: PASSWORD,
    })
    const stamp = `native-artifact-${Date.now().toString(36)}`
    const title = `Packaged source ${stamp}.md`
    const originalText = `Opening copy ${stamp}.\n\nSaved source paragraph ${stamp}.`
    const created = await api(page, '/artifacts', { name: title, kind: 'doc', body: originalText }, 'POST', undefined, {
      'Idempotency-Key': `artifact-context-create-${stamp}`,
    })
    const source = created.artifact
    assert.equal(source.name, title)
    const sourceGrant = await api(page, '/grants', {
      subject: { kind: 'artifact', id: source.id },
      audience: { kind: 'org', orgId: owner.tenant.id },
      tier: 'view',
    })
    await api(page, '/auth/session', { userId: owner.user.id })
    assert.equal((await api(page, '/me')).user.id, owner.user.id)

    stage = 'attach-send-and-exact-model-input'
    const session = await api(page, '/sessions', { providerId })
    const sessionPath = `/sessions/${session.id}`
    const sessionRoute = `/s/${encodeURIComponent(session.id)}`
    await page.goto(`${origin}${sessionRoute}`)
    await attachFromRenderedPicker(page, title)
    let saved = await api(page, sessionPath)
    let snapshot = saved.workspace.attachments.find((item) => item.kind === 'artifact' && item.artifactSnapshot?.artifactId === source.id)?.artifactSnapshot
    assert.ok(snapshot, 'Attach captures the exact readable source body into the destination conversation')
    assert.deepEqual(readSqliteArtifactContext(profile, session.id, source.id), snapshot,
      'the real SQLite workspace stores the exact snapshot receipt and body')
    assert.equal(snapshot.revision, 0)
    assert.equal(snapshot.title, title)
    assert.equal(snapshot.artifactKind, 'doc')
    assert.ok(JSON.stringify(snapshot.body).includes(stamp))
    assert.deepEqual(await api(page, `${sessionPath}/contexts`, undefined, 'GET'), [], 'a saved copy is not an effect-bearing session context')
    let panel = await openCopy(page, title)
    await expect(panel).toContainText(`Saved Artifact copy · revision 0`)
    await expect(panel).toContainText(`Saved source paragraph ${stamp}.`)
    await page.screenshot({ path: join(evidenceDirectory, 'owner-attached.png') })
    await sendWithSnapshot({ page, request: api, fixture, sessionPath, snapshot,
      prompt: `Read this saved Artifact ${stamp}.` })

    stage = 'source-edit-and-explicit-refresh'
    await api(page, '/auth/session', { userId: sourceOwner.user.id })
    const sourceBodies = await api(page, '/artifact-content')
    const sourceBody = sourceBodies[source.id]
    assert.equal(sourceBody.type, 'doc')
    assert.equal(sourceBody.revision, 0)
    const updatedBody = structuredClone(sourceBody)
    updatedBody.blocks[1].p = `Refreshed source paragraph ${stamp}.`
    const { revision: _revision, ...content } = updatedBody
    await api(page, `/artifacts/${source.id}/content`, { content, expectedRevision: 0 }, 'PATCH')
    await api(page, '/auth/session', { userId: owner.user.id })
    await page.goto(`${origin}${sessionRoute}`)
    panel = await openCopy(page, title)
    await expect(panel).toContainText(`Saved source paragraph ${stamp}.`)
    await expect(panel).not.toContainText(`Refreshed source paragraph ${stamp}.`)
    saved = await api(page, sessionPath)
    snapshot = saved.workspace.attachments.find((item) => item.kind === 'artifact' && item.artifactSnapshot?.artifactId === source.id)?.artifactSnapshot
    assert.equal(snapshot.revision, 0, 'a current source edit is not live in the previously saved copy')
    await sendWithSnapshot({ page, request: api, fixture, sessionPath, snapshot,
      prompt: `Confirm the copy has not changed ${stamp}.` })

    await page.getByRole('button', { name: 'Refresh copy', exact: true }).click()
    await expect(panel).toContainText(`Refreshed source paragraph ${stamp}.`, { timeout: TIMEOUT_MS })
    saved = await api(page, sessionPath)
    const refreshed = saved.workspace.attachments.find((item) => item.kind === 'artifact' && item.artifactSnapshot?.artifactId === source.id)?.artifactSnapshot
    assert.equal(refreshed.revision, 1, 'only explicit Refresh replaces the destination snapshot')
    assert.notEqual(refreshed.snapshotId, snapshot.snapshotId)
    assert.deepEqual(readSqliteArtifactContext(profile, session.id, source.id), refreshed,
      'SQLite contains the exact refreshed body rather than a transient renderer projection')
    await page.screenshot({ path: join(evidenceDirectory, 'owner-refreshed.png') })
    await sendWithSnapshot({ page, request: api, fixture, sessionPath, snapshot: refreshed,
      prompt: `Read the explicitly refreshed Artifact ${stamp}.` })

    stage = 'destination-reader-without-source-access'
    await api(page, '/auth/session', { userId: owner.user.id })
    const reader = await api(page, '/auth/signup', {
      name: 'Packaged Artifact Reader', email: 'artifact-reader@example.test', password: PASSWORD,
    })
    await api(page, '/auth/session', { userId: owner.user.id })
    await api(page, '/grants', {
      subject: { kind: 'session', id: session.id }, audience: { kind: 'org', orgId: reader.tenant.id }, tier: 'view',
    })
    await api(page, '/auth/session', { userId: reader.user.id })
    assert.equal(Object.hasOwn(await api(page, '/artifact-content'), source.id), false,
      'the destination reader has no source Artifact grant')
    await page.goto(`${origin}${sessionRoute}`)
    const readerPanel = await openCopy(page, title)
    await expect(readerPanel).toContainText(`Refreshed source paragraph ${stamp}.`)
    await expect(page.getByRole('button', { name: 'Refresh copy', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Remove Artifact context', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)
    await page.screenshot({ path: join(evidenceDirectory, 'destination-reader.png') })

    stage = 'source-revoke-and-delete'
    await api(page, '/auth/session', { userId: sourceOwner.user.id })
    await api(page, `/grants/${sourceGrant.id}`, undefined, 'DELETE')
    const lifecycle = await api(page, `/artifacts/${source.id}/lifecycle`)
    assert.equal(lifecycle.lifecycle.state, 'active')
    await api(page, `/artifacts/${source.id}/lifecycle`, {
      state: 'trashed', expectedRevision: lifecycle.lifecycle.revision,
    }, 'PATCH')
    const preview = await api(page, `/artifacts/${source.id}/deletion-preview`)
    const deletion = await api(page, `/artifacts/${source.id}`, {
      expectedLifecycleRevision: preview.lifecycleRevision, reviewToken: preview.reviewToken,
    }, 'DELETE', undefined, { 'Idempotency-Key': `artifact-context-delete-${stamp}` })
    assert.deepEqual(deletion, { artifactId: source.id, deleted: true }, 'the source owner permanently deletes the reviewed source')
    assert.equal(Object.hasOwn(await api(page, '/artifact-content'), source.id), false)

    stage = 'destination-copy-after-source-removal'
    await api(page, '/auth/session', { userId: owner.user.id })
    assert.equal(Object.hasOwn(await api(page, '/artifact-content'), source.id), false,
      'source deletion is visible before verifying the independent saved copy')
    await page.goto(`${origin}${sessionRoute}`)
    panel = await openCopy(page, title)
    await expect(panel).toContainText(`Refreshed source paragraph ${stamp}.`)
    await expect(page.getByRole('button', { name: 'Refresh copy', exact: true })).toBeVisible()
    await page.screenshot({ path: join(evidenceDirectory, 'owner-source-absent.png') })
    saved = await api(page, sessionPath)
    snapshot = saved.workspace.attachments.find((item) => item.kind === 'artifact' && item.artifactSnapshot?.artifactId === source.id)?.artifactSnapshot
    assert.equal(snapshot.revision, 1)
    assert.ok(JSON.stringify(snapshot.body).includes(`Refreshed source paragraph ${stamp}.`))
    await sendWithSnapshot({ page, request: api, fixture, sessionPath, snapshot,
      prompt: `Use the saved copy after the source was removed ${stamp}.` })

    await api(page, '/auth/session', { userId: reader.user.id })
    assert.equal(Object.hasOwn(await api(page, '/artifact-content'), source.id), false,
      'the destination reader still has no direct source body after source deletion')
    await page.goto(`${origin}${sessionRoute}`)
    const readerAfterDeletion = await openCopy(page, title)
    await expect(readerAfterDeletion).toContainText(`Refreshed source paragraph ${stamp}.`)
    await expect(page.getByRole('button', { name: 'Refresh copy', exact: true })).toHaveCount(0)
    await page.screenshot({ path: join(evidenceDirectory, 'destination-reader-source-absent.png') })
    await api(page, '/auth/session', { userId: owner.user.id })

    stage = 'signed-in-relaunch'
    const beforeQuit = await api(page, sessionPath)
    assert.deepEqual(beforeQuit.viewerPreferences.panelFocus, {
      kind: 'artifact', id: beforeQuit.workspace.attachments.find((item) => item.kind === 'artifact' && item.artifactSnapshot?.artifactId === source.id).id,
    }, 'the owner open-panel preference names the exact saved copy')
    const exactBeforeRelaunch = readSqliteArtifactContext(profile, session.id, source.id)
    const oldOrigin = origin
    await close(run)
    run = undefined
    await assert.rejects(fetch(`${oldOrigin}/api/v1/me`, { signal: AbortSignal.timeout(1_000) }))
    assert.deepEqual(readSqliteArtifactContext(profile, session.id, source.id), exactBeforeRelaunch,
      'the exact refreshed snapshot remains committed after process exit')
    run = await launch(executable, profile)
    ;({ page, origin } = run)
    await page.setViewportSize({ width: 1280, height: 800 })
    assert.equal((await api(page, '/me')).user.id, owner.user.id, 'ordinary packaged relaunch preserves the signed-in destination owner')
    assert.deepEqual(readSqliteArtifactContext(profile, session.id, source.id), exactBeforeRelaunch,
      'SQLite rehydration does not recapture or alter the saved Artifact')
    assert.equal(Object.hasOwn(await api(page, '/artifact-content'), source.id), false,
      'the source stays deleted after relaunch')
    await page.goto(`${origin}${sessionRoute}`)
    panel = page.locator('[data-artifact-context-panel]').filter({ visible: true })
    await expect(panel).toBeVisible({ timeout: TIMEOUT_MS })
    await expect(panel).toContainText(`Refreshed source paragraph ${stamp}.`)
    const afterRelaunch = await api(page, sessionPath)
    assert.deepEqual(afterRelaunch.messages, beforeQuit.messages,
      'earlier owner and model turns remain exact after relaunch')
    assert.deepEqual(afterRelaunch.workspace.attachments.find((item) => item.kind === 'artifact' && item.artifactSnapshot?.artifactId === source.id)?.artifactSnapshot,
      exactBeforeRelaunch, 'the exact saved copy is unchanged by rehydration')
    const relaunchSnapshot = readSqliteArtifactContext(profile, session.id, source.id)
    await sendWithSnapshot({ page, request: api, fixture, sessionPath, snapshot: relaunchSnapshot,
      prompt: `Read the saved Artifact after relaunch ${stamp}.` })
    await page.screenshot({ path: join(evidenceDirectory, 'owner-after-relaunch.png') })

    stage = 'rendered-detach'
    const priorMessages = (await api(page, sessionPath)).messages
    await page.getByRole('button', { name: 'Remove Artifact context', exact: true }).click()
    const maybeConfirm = page.getByRole('dialog', { name: /Remove context|Remove Artifact/i })
    if (await maybeConfirm.isVisible()) await maybeConfirm.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect.poll(async () => readSqliteArtifactContextMaybe(profile, session.id, source.id)).toBeUndefined()
    assert.deepEqual((await api(page, sessionPath)).messages, priorMessages,
      'detaching the source copy leaves all prior replies intact')
    await expect(page.getByTitle('Open in sidebar').filter({ hasText: title })).toHaveCount(0)
    const afterDetach = await sendWithoutArtifact({ page, request: api, fixture, sessionPath,
      prompt: `A new turn after detaching ${stamp}.` })
    assert.deepEqual(afterDetach.messages.slice(0, priorMessages.length), priorMessages)
    await page.screenshot({ path: join(evidenceDirectory, 'owner-detached.png') })

    const asarPath = join(dirname(executable), process.platform === 'darwin' ? '../Resources/app.asar' : 'resources/app.asar')
    // Hash the package bytes only after the real lifecycle has completed.
    const { createHash } = await import('node:crypto')
    const packageHash = createHash('sha256').update(await readFile(asarPath)).digest('hex')
    await writeFile(join(evidenceDirectory, 'receipt.json'), `${JSON.stringify({
      checkedAt: new Date().toISOString(), asarSha256: packageHash,
      artifactId: source.id, sessionId: session.id, title,
      initialRevision: 0, refreshedRevision: 1, exactSnapshotText: true,
      firstSendAndRefreshedSendExactModelEnvelope: true,
      destinationReaderWithoutSourceGrant: true, sourceGrantRevokedAndArtifactDeleted: true,
      signedInRelaunchPreservedExactSnapshot: true, renderedDetachPreservedReplies: true,
      evidenceDirectory,
      scope: 'Ordinary unsigned host-architecture packaged acceptance; local model fixture only. Not paid-provider or signed release acceptance.',
    }, null, 2)}\n`, { mode: 0o600 })
    console.log(`[desktop-artifact-context-smoke] rendered saved copy · exact revisioned model envelope · reader without source grant · reviewed source deletion · signed-in relaunch · detach ${evidenceDirectory}`)
    return run
  } catch (error) {
    if (run) {
      await run.page.screenshot({ path: join(evidenceDirectory, 'failure.png') }).catch(() => {})
      await close(run).catch(() => {})
    }
    throw new Error(`Packaged Artifact context failed at ${stage}: ${error.message}`, { cause: error })
  }
}

async function readSqliteArtifactContextMaybe(profile, sessionId, artifactId) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = database.prepare('SELECT json FROM map_entries WHERE slice = ? AND key = ?').get('workspaces', sessionId)
    if (!row) return undefined
    const workspace = JSON.parse(row.json)
    return workspace.attachments?.find((item) => item.kind === 'artifact' && item.artifactSnapshot?.artifactId === artifactId)?.artifactSnapshot
  } finally { database.close() }
}
