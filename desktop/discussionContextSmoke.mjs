/** Real packaged Discussion copies: HTTP setup, rendered Attach/Refresh/send,
 * real SQLite and ordinary process relaunch. Only the loopback model is a fixture.
 * No main-process injection, mock keychain, paid service or user profile is used.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { SMOKE_MODEL_ID, startAttachmentSmokeEndpoint } from './attachmentSmokeFixture.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TIMEOUT_MS = 30_000
const TITLE = 'Packaged discussion — saved reference'
const PASSWORD = 'isolated-discussion-fixture-password'

async function request(page, path, body, method = body === undefined ? 'GET' : 'POST', expectedStatus) {
  return page.evaluate(async ({ path, body, method, expectedStatus }) => {
    const response = await fetch(`/api/v1${path}`, {
      method, headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (expectedStatus === undefined ? !response.ok : response.status !== expectedStatus) {
      throw new Error(`Discussion smoke ${method} ${path}: HTTP ${response.status}, expected ${expectedStatus ?? 'success'}`)
    }
    return response.json()
  }, { path, body, method, expectedStatus })
}

function savedWorkspace(profile, sessionId) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = database.prepare('SELECT json FROM map_entries WHERE slice = ? AND key = ?').get('workspaces', sessionId)
    assert.ok(row, 'the packaged conversation has a committed SQLite workspace')
    return JSON.parse(row.json)
  } finally { database.close() }
}

// Independent oracle, not the production snapshot builder: preserve exact
// Unicode, line breaks, author names, UTC timestamps and reply relationships.
function transcript(discussion) {
  const indexes = new Map(discussion.posts.map((post, index) => [post.id, index + 1]))
  return `# ${TITLE}\n\n${discussion.posts.map((post, index) =>
    `[${index + 1}] ${post.author} · ${new Date(post.at).toISOString()}${post.replyTo ? ` · reply to #${indexes.get(post.replyTo)}` : ''}\n${post.body}`,
  ).join('\n\n')}`
}

async function openCopy(page) {
  const chip = page.getByTitle('Open in sidebar').filter({ hasText: TITLE }).filter({ visible: true })
  await expect(chip).toBeVisible({ timeout: TIMEOUT_MS })
  if (!(await chip.getAttribute('class'))?.includes('ring-accent')) await chip.click()
  const panel = page.locator('[data-discussion-context-panel]').filter({ visible: true })
  await expect(panel).toBeVisible({ timeout: TIMEOUT_MS })
  return panel
}

async function send(page, fixture, sessionPath, text, snapshot) {
  const before = fixture.requests.length
  const reply = snapshot ? 'Read supplied attachment:' : 'No supplied attachment text.'
  const turns = page.locator('[data-turn]').filter({ hasText: reply })
  const previous = await turns.count()
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill(text)
  await composer.press('Enter')
  await expect(turns).toHaveCount(previous + 1, { timeout: TIMEOUT_MS })
  await turns.last().scrollIntoViewIfNeeded()
  await expect(turns.last()).toBeVisible({ timeout: TIMEOUT_MS })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: TIMEOUT_MS })
  const messages = (await request(page, sessionPath)).messages
  assert.equal(messages.at(-1).role, 'assistant')
  assert.equal(messages.at(-1).content, snapshot ? `Read supplied attachment: ${snapshot.text}` : reply,
    'the completed reply preserves exact reference text despite Markdown rendering')
  assert.equal(fixture.requests.length, before + 1, 'one rendered send produces exactly one model request')
  const wire = fixture.requests.at(-1)
  const latest = wire.messages.filter(message => message.role === 'user').at(-1).content
  assert.equal(typeof latest, 'string', 'Discussion input is text, not image or executable context')
  if (snapshot) {
    const marker = latest.lastIndexOf('\n\n{"attached_files":')
    assert.ok(marker > 0, 'the rendered send frames the saved Discussion in attachment input')
    assert.equal(latest.slice(0, marker), text)
    const document = JSON.parse(latest.slice(marker + 2))
    assert.deepEqual(document.attached_files, [{
      name: TITLE, status: 'ready', kind: 'discussion', captured_at: snapshot.capturedAt,
      post_count: snapshot.postCount, text: snapshot.text,
    }], 'the actual model wire contains the exact saved transcript and metadata')
  } else {
    assert.equal(latest, text, 'detach removes current attachment input without erasing previous conversation replies')
  }
}

export async function smokePackagedDiscussionContext({ executable, launch, close }) {
  const profile = await mkdtemp(join(tmpdir(), 'agent-commons-discussion-smoke-'))
  const evidenceRoot = join(ROOT, '.data', 'desktop-discussion-smoke')
  let evidenceDirectory
  let fixture
  let run
  let stage = 'startup'
  try {
    await mkdir(evidenceRoot, { recursive: true })
    evidenceDirectory = await mkdtemp(join(evidenceRoot, 'run-'))
    fixture = await startAttachmentSmokeEndpoint()
    run = await launch(executable, profile)
    let { page, origin } = run
    await page.setViewportSize({ width: 1280, height: 800 })
    const owner = await request(page, '/auth/signup', {
      name: 'Packaged Discussion Owner', email: 'discussion-owner@example.test', password: PASSWORD,
    })
    const provider = await request(page, '/providers', {
      label: 'Discussion local model fixture', modelFamily: 'claude', effortLevels: ['Default'],
      config: { baseURL: fixture.origin, model: SMOKE_MODEL_ID },
    })
    assert.equal(fixture.requests.length, 1, 'provider setup performs one explicit conformance probe')
    assert.deepEqual(fixture.requests[0].messages, [{ role: 'user', content: 'Conformance check. Reply with one word.' }])
    const session = await request(page, '/sessions', { providerId: provider.id })
    const sessionPath = `/sessions/${session.id}`
    const route = `/s/${session.id}`
    const { project } = await request(page, '/projects', { name: 'Private Discussion source', description: '' })
    const source = await request(page, '/discussions', {
      anchor: { ref: { kind: 'project', id: project.id } }, firstPost: TITLE,
    })
    const sourcePath = `/discussions/${source.id}`
    await request(page, `${sourcePath}/posts`, { body: 'A precise copy: café · 東京.\nSecond line stays separate.', replyTo: source.posts[0].id })
    const initialText = transcript(await request(page, sourcePath))
    await page.goto(`${origin}${route}`)
    const sourceReads = []
    const observeSourceReads = target => target.on('request', outgoing => {
      if (outgoing.method() === 'GET' && new URL(outgoing.url()).pathname === `/api/v1${sourcePath}`) sourceReads.push(outgoing.url())
    })
    observeSourceReads(page)

    stage = 'attach-and-send'
    await page.getByRole('button', { name: 'Add context', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Add context', exact: true })
    await picker.getByRole('button', { name: /^Discussion/ }).click()
    await picker.locator('[data-discussion-context-picker]').getByRole('button', { name: TITLE, exact: true }).click()
    const confirmation = picker.locator('[data-discussion-context-confirm]')
    await expect(confirmation).toContainText('Everyone with access to the destination conversation can read it.')
    await expect(confirmation).toContainText('Revoking access to the source later won’t erase this copy or earlier replies.')
    await confirmation.getByRole('button', { name: 'Attach saved copy', exact: true }).click()
    await picker.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(picker).toHaveCount(0)
    let panel = await openCopy(page)
    await expect(panel.getByRole('textbox', { name: 'Saved discussion copy', exact: true })).toHaveValue(initialText)
    const initial = (await request(page, sessionPath)).workspace.attachments[0].discussionSnapshot
    assert.equal(initial.text, initialText)
    assert.equal(initial.postCount, 2)
    assert.deepEqual(savedWorkspace(profile, session.id).attachments[0].discussionSnapshot, initial)
    assert.deepEqual(await request(page, `${sessionPath}/contexts`), [], 'a saved Discussion grants no effect-bearing SessionContext')
    assert.equal(fixture.requests.length, 1, 'Attach and preview do not invoke a model beyond the setup probe')
    await send(page, fixture, sessionPath, 'Read the first saved copy.', initial)

    stage = 'source-change-and-explicit-refresh'
    await request(page, `${sourcePath}/posts`, {
      body: 'LATER_SOURCE_ONLY_739 — appears only after explicit Refresh.', replyTo: source.posts[0].id,
    })
    await page.reload()
    panel = await openCopy(page)
    await expect(panel.getByRole('textbox', { name: 'Saved discussion copy', exact: true })).toHaveValue(initialText)
    await send(page, fixture, sessionPath, 'Read the same saved copy after the source changed.', initial)
    await page.getByRole('button', { name: 'Refresh copy', exact: false }).click()
    const saved = () => savedWorkspace(profile, session.id).attachments[0].discussionSnapshot
    await expect.poll(() => saved().postCount).toBe(3)
    const refreshed = saved()
    assert.notEqual(refreshed.snapshotId, initial.snapshotId, 'explicit Refresh replaces the snapshot identity')
    // Fetch the source only as an independent test oracle, outside renderer read tracking.
    const expectedSource = await page.request.get(`${origin}/api/v1${sourcePath}`)
    assert.equal(expectedSource.status(), 200)
    assert.equal(refreshed.text, transcript(await expectedSource.json()))
    await expect(panel.getByRole('textbox', { name: 'Saved discussion copy', exact: true })).toHaveValue(refreshed.text)
    assert.equal(fixture.requests.length, 3, 'Refresh is not model execution consent')
    await page.screenshot({ path: join(evidenceDirectory, 'owner-refreshed.png') })

    stage = 'destination-sharing-without-source-access'
    // Electron has one trusted default browser context. Use the real account
    // stack and a full navigation for each viewer, not injected tenant headers.
    const reader = await request(page, '/auth/signup', {
      name: 'Packaged Discussion Reader', email: 'discussion-reader@example.test', password: PASSWORD,
    })
    assert.equal((await page.request.get(`${origin}/api/v1${sourcePath}`)).status(), 404)
    await request(page, sessionPath, undefined, 'GET', 404)
    await request(page, '/auth/session', { userId: owner.user.id })
    await request(page, '/grants', { subject: { kind: 'session', id: session.id }, audience: { kind: 'org', orgId: reader.tenant.id }, tier: 'view' })
    await request(page, '/auth/session', { userId: reader.user.id })
    assert.equal((await page.request.get(`${origin}/api/v1${sourcePath}`)).status(), 404,
      'sharing the destination does not grant access to the private Discussion source')
    await page.goto(`${origin}${route}`)
    const readerPanel = await openCopy(page)
    await expect(readerPanel.getByRole('textbox', { name: 'Saved discussion copy', exact: true })).toHaveValue(refreshed.text)
    await expect(page.getByRole('button', { name: 'Refresh copy', exact: false })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Remove discussion context', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add context', exact: true })).toHaveCount(0)
    await page.screenshot({ path: join(evidenceDirectory, 'destination-reader.png') })
    await request(page, '/auth/session', { userId: owner.user.id })
    await page.goto(`${origin}${route}`)

    stage = 'delete-source-and-full-relaunch'
    const currentSource = await page.request.get(`${origin}/api/v1${sourcePath}`)
    assert.equal(currentSource.status(), 200)
    const posts = (await currentSource.json()).posts
    const deleted = await request(page, `${sourcePath}/posts/${posts[0].id}?cascade=1`, { expectedPostIds: posts.map(post => post.id) }, 'DELETE')
    assert.equal(deleted.discussion, null, 'the real source thread is gone before quitting')
    const absent = await page.request.get(`${origin}/api/v1${sourcePath}`)
    assert.equal(absent.status(), 404)
    assert.deepEqual(saved(), refreshed, 'source deletion does not erase the destination copy')
    const beforeQuit = await request(page, sessionPath)
    assert.deepEqual(beforeQuit.viewerPreferences.panelFocus, {
      kind: 'discussion', id: beforeQuit.workspace.attachments[0].id,
    }, 'the owner has a saved open-panel preference before relaunch')
    const oldOrigin = origin
    await close(run)
    run = undefined
    await assert.rejects(fetch(`${oldOrigin}/api/v1/me`, { signal: AbortSignal.timeout(1_000) }))
    assert.deepEqual(saved(), refreshed, 'exact saved Discussion bytes remain in SQLite after process exit')
    run = await launch(executable, profile)
    ;({ page, origin } = run)
    await page.setViewportSize({ width: 1280, height: 800 })
    assert.equal((await request(page, '/me')).user.id, owner.user.id, 'ordinary relaunch preserves the signed-in owner')
    assert.deepEqual((await request(page, sessionPath)).messages, beforeQuit.messages, 'relaunch preserves earlier model replies')
    assert.deepEqual(saved(), refreshed, 'SQLite rehydration preserves the exact snapshot, not a recapture')
    observeSourceReads(page)
    await page.goto(`${origin}${route}`)
    // The server owns the open-panel preference. Await its restoration rather
    // than racing a toggle against the new origin's asynchronous hydration.
    panel = page.locator('[data-discussion-context-panel]').filter({ visible: true })
    await expect(panel).toBeVisible({ timeout: TIMEOUT_MS })
    await expect(panel.getByRole('textbox', { name: 'Saved discussion copy', exact: true })).toHaveValue(refreshed.text)
    assert.equal(fixture.requests.length, 3, 'relaunch never automatically sends a model request')
    await send(page, fixture, sessionPath, 'Read the saved copy after its source was deleted and the app relaunched.', refreshed)
    await page.screenshot({ path: join(evidenceDirectory, 'source-absent-relaunch.png') })
    assert.deepEqual(sourceReads, [], 'saved-copy preview, shared reading, reload and sends never request per-Discussion detail')

    stage = 'detach-and-send'
    const beforeDetach = (await request(page, sessionPath)).messages
    await page.getByRole('button', { name: 'Remove discussion context', exact: true }).click()
    await expect.poll(() => savedWorkspace(profile, session.id).attachments.length).toBe(0)
    await expect(page.getByTitle('Open in sidebar').filter({ hasText: TITLE })).toHaveCount(0)
    assert.deepEqual((await request(page, sessionPath)).messages, beforeDetach, 'detach retains previously saved replies')
    await send(page, fixture, sessionPath, 'A new turn with no Discussion attached.', undefined)
    assert.deepEqual(await request(page, `${sessionPath}/contexts`), [])
    await page.screenshot({ path: join(evidenceDirectory, 'detached.png') })
    const asarPath = join(dirname(executable), process.platform === 'darwin' ? '../Resources/app.asar' : 'resources/app.asar')
    const hash = value => createHash('sha256').update(value).digest('hex')
    await writeFile(join(evidenceDirectory, 'receipt.json'), `${JSON.stringify({
      checkedAt: new Date().toISOString(), asarSha256: hash(await readFile(asarPath)),
      requestCount: fixture.requests.length, initialTranscriptSha256: hash(initial.text),
      refreshedTranscriptSha256: hash(refreshed.text), postCounts: [initial.postCount, refreshed.postCount],
      scope: 'Ordinary unsigned host-architecture package; local model fixture only. Not paid-provider, signed/notarized or Intel acceptance.',
    }, null, 2)}\n`, { mode: 0o600 })
    console.log('[desktop-discussion-smoke] rendered Attach + disclosure · exact model wire · explicit Refresh · destination-only reader · source deletion · SQLite + signed-in full relaunch · saved-only send · detach without erasing replies')
    console.log(`[desktop-discussion-smoke] evidence ${evidenceDirectory}`)
  } catch (error) {
    if (run) await run.page.screenshot({ path: join(evidenceDirectory, 'failure.png') }).catch(() => {})
    throw new Error(`Packaged Discussion context failed at ${stage}: ${error.message}`, { cause: error })
  } finally {
    try { await close(run) }
    finally {
      try { await fixture?.close() }
      finally { await rm(profile, { recursive: true, force: true }) }
    }
  }
}
