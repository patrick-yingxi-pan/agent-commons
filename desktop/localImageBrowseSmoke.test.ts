import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ignoreFromPackage } from './packager.config.mjs'
import { armOriginalDownload, preserveImageDownloadClickFailure } from './localImageBrowseSmoke.mjs'

const file = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
const smoke = file('localImageBrowseSmoke.mjs')
const folder = file('localFolderBrowseSmoke.mjs')
const git = file('localGitSmoke.mjs')

test('native image acceptance resolves an unoverridden Electron viewport from rendered width', () => {
  const helper = readFileSync(new URL('../e2e/accessibility-helpers.ts', import.meta.url), 'utf8')
  assert.ok(helper.includes('page.viewportSize()?.width ?? await page.evaluate(() => innerWidth)'))
  assert.ok(helper.includes('const tier = tierFor(width)'), 'native and browser acceptance share the real layout tier')
})

test('native image browsing covers generated PNG, SVG and ICO fixtures through one shared acceptance path', () => {
  assert.ok(smoke.includes("kind === 'png'"))
  assert.ok(smoke.includes('imageFixture(240, 120)'))
  assert.ok(smoke.includes("kind === 'svg'"))
  assert.ok(smoke.includes('svgFixture(180, 90)'))
  assert.ok(smoke.includes("kind === 'ico'"))
  assert.ok(smoke.includes('iconFixture(64, 32, { png: true })'))
  assert.ok(smoke.includes('`Preview of ${path}`'), 'the locator follows the renderer image alt text')
  for (const [source, expected] of [
    [folder, "source: 'folder'"] ,
    [git, "source: 'git-tracked'"],
    [git, "source: 'git-untracked'"],
  ]) assert.ok(source.includes(expected), `packaged acceptance includes ${expected}`)
  assert.ok(git.includes('`src/${trackedImage.name}`'), 'the SVG fixture is tracked before Git listing')
  assert.ok(git.includes('untrackedImage.name'), 'the ICO fixture remains outside the initial index')
})

test('image preview remains transient until explicit Attach, and only normalized PNG reaches model input', () => {
  const preview = smoke.indexOf('assert.equal(imagePosts.length, 0')
  const attach = smoke.indexOf("name: 'Attach saved copy'")
  const upload = smoke.indexOf('assert.equal(imagePosts.length, 1')
  const send = smoke.indexOf("composer.press('Enter')")
  const modelImage = smoke.indexOf("assert.equal(imageBlocks[0].source.data, content")
  assert.ok(preview >= 0 && attach > preview && upload > attach && send > upload && modelImage > send)
  for (const invariant of [
    'assert.deepEqual(await workspace(run.page, sessionId), initial',
    'assert.equal(endpoint.requests.length, modelRequestsBefore',
    'source changed after preview',
    'original.original.data',
    'basename(path)',
    "name: 'Download original'",
    "preview.getByRole('button', { name: 'Download original', exact: true })",
    "data-attachment-preview', attachmentId",
    'agent-commons-image-download-failure-',
    'data-image-original',
    'download-original-failure.png',
    "hasText: 'Received 1 supplied image(s).'",
    'toHaveCount(previousReplies + 1',
  ]) assert.ok(smoke.includes(invariant), `shared acceptance locks ${invariant}`)
})

test('Git image browse keeps index bytes and mtime stable and source files absent across packaged relaunch', () => {
  assert.ok(git.includes('verifySourceMetadata: () => assertIndexUnchanged(repository, beforeBrowseIndex)'))
  assert.ok(git.includes('verifySourceMetadata: () => assertIndexUnchanged(repository, untrackedIndexBefore)'))
  assert.ok(git.includes("rename(trackedImageReceipt.sourcePath"), 'tracked SVG is moved outside the repository before restart')
  assert.ok(git.includes('untrackedImageReceipt.sourcePath'), 'untracked ICO is removed with other untracked source fixtures')
  assert.ok(git.includes('await verifyLocalImageBrowseRelaunch(run, trackedImageReceipt)'))
  assert.ok(git.includes('await verifyLocalImageBrowseRelaunch(run, untrackedImageReceipt)'))
  assert.ok(smoke.includes("assert.rejects(stat(receipt.sourcePath), { code: 'ENOENT' }, 'the selected native image source is absent after relaunch')"))
})

test('native image smoke helpers are excluded from the packaged application', () => {
  assert.equal(ignoreFromPackage('/desktop/localImageBrowseSmoke.mjs'), true)
  assert.equal(ignoreFromPackage('/desktop/localImageBrowseSmoke.test.ts'), true)
})

test('Done waits for the exact auto-opened image preview without toggling its sidebar chip', () => {
  const start = smoke.indexOf('async function openImagePreview(')
  const end = smoke.indexOf('\nasync function closeImagePreview', start)
  assert.ok(start >= 0 && end > start)
  const helper = smoke.slice(start, end)
  assert.ok(helper.includes("toHaveAttribute('data-attachment-preview', attachmentId)"))
  assert.ok(helper.includes('settledAttachmentPreview(page)'))
  assert.ok(helper.includes("preview.getByRole('button', { name: 'Download original', exact: true })"))
  assert.doesNotMatch(helper, /getByTitle\('Open in sidebar'|Photos \(/,
    'auto-open completion is awaited instead of toggling the pane closed')
})

test('image-download diagnostics cannot mask the click failure and dispose the remote handle', async () => {
  const original = new Error('owned download button disappeared')
  let disposed = false
  const errors = []
  const priorError = console.error
  console.error = message => errors.push(message)
  try {
    await assert.rejects(
      preserveImageDownloadClickFailure(original,
        async () => { throw new Error('diagnostic page already closed') },
        async () => { disposed = true }),
      error => error === original,
    )
  } finally {
    console.error = priorError
  }
  assert.equal(disposed, true)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /unable to capture evidence/)
})

function fakeTimers() {
  let nextId = 0
  const pending = new Map<number, () => void>()
  const cleared: number[] = []
  return {
    pending, cleared,
    setTimeout(callback: () => void, _delay: number) {
      const id = ++nextId
      pending.set(id, callback)
      return id
    },
    clearTimeout(id: number) {
      cleared.push(id)
      pending.delete(id)
    },
    fire() {
      const callbacks = [...pending.values()]
      pending.clear()
      for (const callback of callbacks) callback()
    },
  }
}

function fakeDownload() {
  const item = new EventEmitter() as EventEmitter & {
    savePath?: string
    cancelled?: boolean
    setSavePath(path: string): void
    getFilename(): string
    cancel(): void
  }
  item.setSavePath = path => { item.savePath = path }
  item.getFilename = () => 'selected.png'
  item.cancel = () => { item.cancelled = true }
  return item
}

function armedDownload(timers = fakeTimers()) {
  const session = new EventEmitter()
  const download = armOriginalDownload({ session: { defaultSession: session } }, {
    trustedOrigin: 'http://127.0.0.1:8787', savePath: '/tmp/selected.png', timers,
  })
  return { session, download, timers }
}

test('native image download observer removes listeners and timer after exact-origin success', async () => {
  const { session, download, timers } = armedDownload()
  const item = fakeDownload()
  assert.equal(session.listenerCount('will-download'), 1)
  session.emit('will-download', { preventDefault() { assert.fail('trusted download was prevented') } }, item,
    { getURL: () => 'http://127.0.0.1:8787/api/v1/image-assets/id/original' })
  assert.equal(item.savePath, '/tmp/selected.png')
  assert.equal(item.listenerCount('done'), 1)
  item.emit('done', {}, 'completed')
  assert.deepEqual(await download.done, { state: 'completed', filename: 'selected.png' })
  assert.equal(session.listenerCount('will-download'), 0)
  assert.equal(item.listenerCount('done'), 0)
  assert.equal(timers.pending.size, 0)
  assert.equal(timers.cleared.length, 1)
})

test('native image download observer owns only the first download while it is pending', async () => {
  const { session, download } = armedDownload()
  const first = fakeDownload()
  const second = fakeDownload()
  const trustedContents = { getURL: () => 'http://127.0.0.1:8787/image' }
  const event = { preventDefault() { assert.fail('trusted download was prevented') } }
  session.emit('will-download', event, first, trustedContents)
  assert.equal(session.listenerCount('will-download'), 0, 'the one-shot observer detaches before awaiting item completion')
  session.emit('will-download', event, second, trustedContents)
  assert.equal(first.savePath, '/tmp/selected.png')
  assert.equal(second.savePath, undefined, 'a concurrent download cannot inherit this test save path')
  first.emit('done', {}, 'completed')
  assert.deepEqual(await download.done, { state: 'completed', filename: 'selected.png' })
})

test('native image download timeout removes its listener and cancels an active item', async () => {
  const { session, download, timers } = armedDownload()
  const item = fakeDownload()
  session.emit('will-download', { preventDefault() { assert.fail('trusted download was prevented') } }, item,
    { getURL: () => 'http://127.0.0.1:8787/image' })
  timers.fire()
  assert.deepEqual(await download.done, { state: 'timed-out', filename: '' })
  assert.equal(session.listenerCount('will-download'), 0)
  assert.equal(item.cancelled, true)
  assert.equal(item.listenerCount('done'), 0)
  assert.equal(timers.pending.size, 0)
})

test('native image download timeout without an event retires the pending listener', async () => {
  const { session, download, timers } = armedDownload()
  timers.fire()
  assert.deepEqual(await download.done, { state: 'timed-out', filename: '' })
  assert.equal(session.listenerCount('will-download'), 0)
  assert.equal(timers.pending.size, 0)
})

test('native image download disposal is idempotent and click failure remains primary', async () => {
  const { session, download, timers } = armedDownload()
  const original = new Error('click failed after dispatch')
  const item = fakeDownload()
  let prevented = false
  await assert.rejects(
    preserveImageDownloadClickFailure(original, async () => {}, async () => {
      download.dispose()
      download.dispose()
    }),
    error => error === original,
  )
  assert.deepEqual(await download.done, { state: 'disposed', filename: '' })
  session.emit('will-download', { preventDefault() { prevented = true } }, item,
    { getURL: () => 'http://127.0.0.1:8787/image' })
  assert.equal(prevented, false)
  assert.equal(item.savePath, undefined, 'a later download cannot be redirected by a stale observer')
  assert.equal(session.listenerCount('will-download'), 0)
  assert.equal(timers.pending.size, 0)
  assert.equal(timers.cleared.length, 1)
})

test('native image download rejects an unexpected origin and cleans every observer', async () => {
  const { session, download, timers } = armedDownload()
  const item = fakeDownload()
  let prevented = false
  session.emit('will-download', { preventDefault() { prevented = true } }, item,
    { getURL: () => 'https://outside.example/file.png' })
  assert.deepEqual(await download.done, { state: 'unexpected-origin', filename: '' })
  assert.equal(prevented, true)
  assert.equal(item.savePath, undefined)
  assert.equal(session.listenerCount('will-download'), 0)
  assert.equal(timers.pending.size, 0)
  assert.equal(timers.cleared.length, 1)
})
