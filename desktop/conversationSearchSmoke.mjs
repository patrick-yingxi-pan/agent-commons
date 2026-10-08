/** Global conversation search in the ordinary packaged Discussion lifecycle.
 * Only the existing loopback model is a fixture; HTTP, grants, SQLite, renderer
 * history paging and OS-backed signed-in relaunch remain real. Never shipped.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect } from '@playwright/test'

const TIMEOUT_MS = 30_000
const REPLY = 'No supplied attachment text.'

function waitForBrowserDownload(downloadSession, expectedOrigin) {
  return new Promise((resolve, reject) => {
    let guid
    let suggestedFilename
    const timeout = setTimeout(() => finish(new Error('Packaged conversation download timed out.')), TIMEOUT_MS)
    const cleanup = () => {
      clearTimeout(timeout)
      downloadSession.off('Browser.downloadWillBegin', onBegin)
      downloadSession.off('Browser.downloadProgress', onProgress)
    }
    const finish = (error, result) => {
      cleanup()
      error ? reject(error) : resolve(result)
    }
    const onBegin = ({ guid: startedGuid, url, suggestedFilename: filename }) => {
      let origin = ''
      try { origin = new URL(url).origin } catch {}
      if (origin !== expectedOrigin) return finish(new Error(`Unexpected download origin: ${origin || 'invalid URL'}`))
      guid = startedGuid
      suggestedFilename = filename
    }
    const onProgress = ({ guid: progressGuid, state, filePath }) => {
      if (!guid || progressGuid !== guid) return
      if (state === 'canceled') return finish(new Error('Packaged conversation download was canceled.'))
      if (state === 'completed') finish(null, { state, filename: suggestedFilename, filePath })
    }
    downloadSession.on('Browser.downloadWillBegin', onBegin)
    downloadSession.on('Browser.downloadProgress', onProgress)
  })
}

export async function prepareConversationSearchSmoke({ page, origin, request, providerId, model, owner, reader, stamp }) {
  const query = `conversationneedle${stamp}`
  const session = await request(page, '/sessions', { firstMessage: `Packaged search ${stamp}`, providerId })
  const texts = [
    `An early saved note contains ${query}. Unicode stays exact: café · 東京.\n${'Earlier context. '.repeat(12)}`,
    `A later duplicate ${query} must not replace the first match.`,
    ...Array.from({ length: 20 }, (_, index) => `Later neutral exchange ${index + 1}.`),
  ]
  const before = model.requests.length
  for (const text of texts) {
    const response = await page.request.post(`${origin}/api/v1/sessions/${encodeURIComponent(session.id)}/messages`, {
      data: { text }, headers: { 'idempotency-key': randomUUID() }, timeout: TIMEOUT_MS,
    })
    assert.equal(response.status(), 200, 'the packaged endpoint accepts each generated search turn')
    // Consume the complete SSE response before checking authoritative saved truth.
    await response.body()
  }
  assert.equal(model.requests.length, before + texts.length, 'setup makes exactly 22 local model requests')
  const saved = await request(page, `/sessions/${encodeURIComponent(session.id)}`)
  assert.equal(saved.messages.length, 44)
  assert.deepEqual(saved.messages.map(({ role, content }) => ({ role, content })),
    texts.flatMap(content => [{ role: 'user', content }, { role: 'assistant', content: REPLY }]),
    'all saved user/assistant content is exact, not a title/preview fixture')
  assert.equal(saved.title.includes(query), false)
  assert.equal(saved.preview.includes(query), false)
  const target = { messageId: saved.messages[0].id, role: 'user' }
  const tail = await request(page, `/sessions/${encodeURIComponent(session.id)}?messageLimit=40`)
  assert.equal(tail.messages.length, 40)
  assert.ok(tail.messagePage.olderCursor)
  assert.equal(tail.messages.some(message => message.id === target.messageId), false,
    'the exact turn starts outside the initial 40-message read')
  const matches = await request(page, `/sessions/${encodeURIComponent(session.id)}/search?q=${encodeURIComponent(query)}`)
  assert.equal(matches.total, 2, 'two current messages contain the same literal query')
  assert.deepEqual(matches.hits.map(({ messageId, role }) => ({ messageId, role })),
    [target, { messageId: saved.messages[2].id, role: 'user' }])

  const grant = await request(page, '/grants', {
    subject: { kind: 'session', id: session.id }, audience: { kind: 'org', orgId: reader.tenant.id }, tier: 'view',
  })
  assert.ok(grant.id)
  const foreign = await request(page, '/auth/signup', {
    name: 'Packaged Search Foreign', email: `conversation-search-${stamp}@example.test`,
    password: 'isolated-conversation-search-fixture-password',
  })
  await request(page, '/auth/session', { userId: owner.user.id })
  return {
    sessionId: session.id, query, target, title: saved.title, preview: saved.preview,
    messages: saved.messages, ownerId: owner.user.id, readerId: reader.user.id, foreignId: foreign.user.id,
  }
}

export function readSqliteConversationSearch(profile, fixture) {
  const database = new DatabaseSync(join(profile, 'store.db'), { readOnly: true })
  try {
    const row = database.prepare('SELECT json FROM entities WHERE slice = ? AND entity_id = ?')
      .get('sessions', fixture.sessionId)
    assert.ok(row, 'SQLite retains the exact search conversation identity')
    const session = JSON.parse(row.json)
    assert.equal(session.messages.length, 44)
    assert.equal(session.id, fixture.sessionId)
    assert.equal(session.title, fixture.title)
    assert.equal(session.preview, fixture.preview)
    assert.deepEqual(session.messages, fixture.messages, 'SQLite retains every exact message identity and body')
    return { id: session.id, title: session.title, preview: session.preview, messages: session.messages }
  } finally { database.close() }
}

export async function verifyConversationSearchSmoke({ browser, page, origin, request, model, fixture, evidenceDirectory, phase }) {
  const sessionPath = `/api/v1/sessions/${encodeURIComponent(fixture.sessionId)}`
  const canonicalUrl = `${origin}/s/${encodeURIComponent(fixture.sessionId)}`
  const modelRequestCount = model.requests.length
  const mutations = []
  const historyReads = []
  const observe = outgoing => {
    const url = new URL(outgoing.url())
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(outgoing.method()) &&
      (url.pathname === sessionPath || url.pathname.startsWith(`${sessionPath}/messages`))) {
      mutations.push(`${outgoing.method()} ${url.pathname}`)
    }
    if (outgoing.method() === 'GET' && url.pathname === sessionPath && url.searchParams.has('messageCursor')) {
      historyReads.push(url.href)
    }
  }
  const downloadSession = await browser.newBrowserCDPSession()
  const downloadDirectories = []
  page.on('request', observe)
  try {
    for (const viewer of [
      { kind: 'owner', id: fixture.ownerId },
      { kind: 'shared', id: fixture.readerId },
      { kind: 'foreign', id: fixture.foreignId },
    ]) {
      await request(page, '/auth/session', { userId: viewer.id })
      await page.goto(`${origin}/projects`)
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Search', exact: true })
      const input = dialog.getByRole('textbox', { name: 'Search everything', exact: true })
      await input.fill(fixture.query)
      const hit = dialog.locator(`[data-search-result="session-${fixture.sessionId}"]`)
      const result = await request(page, `/search?q=${encodeURIComponent(fixture.query)}&type=session`)
      assert.equal(result.groups.length, 1)
      if (viewer.kind === 'foreign') {
        assert.equal(result.groups[0].total, 0)
        assert.deepEqual(result.groups[0].hits, [])
        await expect(dialog.getByText(`No matches for “${fixture.query}”.`, { exact: true })).toBeVisible({ timeout: TIMEOUT_MS })
        await expect(hit).toHaveCount(0)
        await request(page, `/sessions/${encodeURIComponent(fixture.sessionId)}`, undefined, 'GET', 404)
        await request(page, `/sessions/${encodeURIComponent(fixture.sessionId)}/export`, undefined, 'GET', 404)
        await page.screenshot({ path: join(evidenceDirectory, `${phase}-conversation-foreign.png`) })
        continue
      }
      assert.equal(result.groups[0].total, 1, 'the two matching messages project one conversation result')
      assert.equal(result.groups[0].hits[0].id, fixture.sessionId)
      assert.deepEqual(result.groups[0].hits[0].match, fixture.target)
      await expect(hit).toBeVisible({ timeout: TIMEOUT_MS })
      await expect(hit).toContainText('User message')
      await expect(hit).toContainText(fixture.query)
      await expect(hit).toHaveAttribute('data-search-active', 'true')
      await page.screenshot({ path: join(evidenceDirectory, `${phase}-conversation-${viewer.kind}-search.png`) })
      const previousHistoryReads = historyReads.length
      await input.press('Enter')
      await expect(dialog).toHaveCount(0)
      await expect(page).toHaveURL(canonicalUrl)
      const turn = page.locator(`[data-turn="${fixture.target.messageId}"]`)
      await expect(turn).toHaveCount(1)
      // Markdown paragraphs have visible line breaks without text-node separators.
      await expect(turn).toContainText(fixture.messages[0].content, { useInnerText: true })
      // Visibility alone permits a screenshot halfway through the real fade-in.
      await expect(turn).toHaveCSS('opacity', '1')
      await expect(turn).toHaveClass(/ring-co\/40/)
      await expect(turn).toBeInViewport()
      assert.ok(historyReads.length > previousHistoryReads, 'the exact turn requires an actual earlier-history read')
      if (viewer.kind === 'shared') await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled()
      await page.screenshot({ path: join(evidenceDirectory, `${phase}-conversation-${viewer.kind}-landing.png`) })

      // Search focus is transient, not a bookmark. Reload and Back retain the
      // canonical URL without retaining the old query or highlighting a substitute.
      await page.reload()
      await expect(page).toHaveURL(canonicalUrl)
      await expect(page.locator(`[data-turn="${fixture.messages.at(-1).id}"]`)).toBeVisible({ timeout: TIMEOUT_MS })
      await expect(turn).toHaveCount(0)
      await expect(page.locator('[data-turn][class*="ring-co/40"]')).toHaveCount(0)
      await page.goto(`${origin}/projects`)
      await page.goBack()
      await expect(page).toHaveURL(canonicalUrl)
      await expect(page.locator(`[data-turn="${fixture.messages.at(-1).id}"]`)).toBeVisible({ timeout: TIMEOUT_MS })
      await expect(turn).toHaveCount(0)
      await expect(page.locator('[data-turn][class*="ring-co/40"]')).toHaveCount(0)

      // Exercise the real renderer download for each readable principal. The
      // saved bytes must match a fresh authenticated descriptor exactly.
      const descriptor = await request(page, `/sessions/${encodeURIComponent(fixture.sessionId)}/export`)
      assert.equal(descriptor.sessionId, fixture.sessionId)
      assert.equal(descriptor.mediaType, 'text/markdown;charset=utf-8')
      await page.getByRole('button', { name: 'Download conversation', exact: true }).click()
      const downloadDialog = page.getByRole('dialog', { name: 'Download conversation', exact: true })
      await expect(downloadDialog).toBeVisible()
      await page.screenshot({ path: join(evidenceDirectory, `${phase}-conversation-${viewer.kind}-download-dialog.png`) })
      const downloadDirectory = await mkdtemp(join(tmpdir(), `conversation-export-${phase}-${viewer.kind}-`))
      downloadDirectories.push(downloadDirectory)
      await downloadSession.send('Browser.setDownloadBehavior', {
        behavior: 'allow', downloadPath: downloadDirectory, eventsEnabled: true,
      })
      const downloadDone = waitForBrowserDownload(downloadSession, origin)
      const [downloadResult] = await Promise.all([
        downloadDone,
        downloadDialog.getByRole('button', { name: 'Download Markdown', exact: true }).click(),
      ])
      assert.equal(downloadResult.state, 'completed', 'Chromium reports the packaged download completed')
      assert.equal(downloadResult.filename, descriptor.filename, 'download uses the bounded descriptor filename')
      const downloadPath = downloadResult.filePath ?? join(downloadDirectory, downloadResult.filename)
      const downloadedBytes = await readFile(downloadPath)
      assert.deepEqual(downloadedBytes, Buffer.from(descriptor.content, 'utf8'),
        'the downloaded Markdown is exactly the authorized export descriptor')
      await expect(downloadDialog.getByRole('status')).toContainText('Markdown download requested.')
      await page.screenshot({ path: join(evidenceDirectory, `${phase}-conversation-${viewer.kind}-downloaded.png`) })
      await downloadDialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(downloadDialog).toHaveCount(0)
    }
    await request(page, '/auth/session', { userId: fixture.ownerId })
    assert.deepEqual((await request(page, `/sessions/${encodeURIComponent(fixture.sessionId)}`)).messages,
      fixture.messages, 'searching and reading never changes the exact saved transcript')
    assert.deepEqual(mutations, [], 'search navigation performs no message mutations')
    assert.equal(model.requests.length, modelRequestCount, 'search navigation performs no model requests')
  } finally {
    page.off('request', observe)
    await downloadSession.send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => {})
    await downloadSession.detach().catch(() => {})
    await Promise.all(downloadDirectories.map(directory => rm(directory, { recursive: true, force: true })))
  }
}
