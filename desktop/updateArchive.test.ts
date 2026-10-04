import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { lstat, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { downloadUpdateArchive, serveApprovedUpdate } from './updateArchive.mjs'

const tempPrefix = 'agent-commons-update-archive-'
const bytes = Buffer.from('fixture update archive bytes')
const digest = createHash('sha256').update(bytes).digest('hex')
const update = Object.freeze({
  version: '1.2.3',
  url: 'https://updates.example/releases/Agent-Commons-1.2.3-macos-arm64.zip',
  sha256: digest,
  bytes: bytes.byteLength,
})

function responseWith(body: Uint8Array, init: ResponseInit = {}) {
  return new Response(body, { status: 200, headers: { 'content-length': String(body.byteLength), 'content-type': 'application/zip' }, ...init })
}

async function tempDirectories() {
  return (await readdir(tmpdir())).filter((name) => name.startsWith(tempPrefix)).sort()
}

test('download validates exact metadata, sends a redirect-free uncookied ZIP request and disposes private bytes', async () => {
  const before = await tempDirectories()
  let calledUrl: unknown
  let calledOptions: RequestInit | undefined
  const result = await downloadUpdateArchive(update, {
    fetchImpl: async (url, options) => {
      calledUrl = url
      calledOptions = options
      return responseWith(bytes)
    },
  })
  try {
    assert.equal(calledUrl, update.url)
    assert.equal(calledOptions?.method, 'GET')
    assert.equal(calledOptions?.redirect, 'error')
    assert.equal(calledOptions?.credentials, 'omit')
    assert.equal(new Headers(calledOptions?.headers).get('accept'), 'application/zip')
    const parent = join(result.archivePath, '..')
    assert.equal(result.archivePath.endsWith('/update.zip'), true)
    assert.deepEqual(await readFile(result.archivePath), bytes)
    assert.equal((await stat(parent)).mode & 0o777, 0o700)
    assert.equal((await stat(result.archivePath)).mode & 0o777, 0o600)
  } finally {
    await result.dispose()
  }
  assert.equal(existsSync(result.archivePath), false)
  assert.deepEqual(await tempDirectories(), before)
})

test('download rejects malformed metadata, redirects, declared and streamed size mismatch, and bad hashes without residue', async () => {
  const before = await tempDirectories()
  const invalidUpdates = [
    null,
    [],
    { ...update, extra: true },
    Object.assign(Object.create({ inherited: 'no' }), update),
    { ...update, version: '1.2.3-beta.1' },
    { ...update, version: '9007199254740992.0.0' },
    { ...update, url: 'http://updates.example/file.zip' },
    { ...update, url: 'https://updates.example/path/../file.zip' },
    { ...update, url: 'https://user:pass@updates.example/file.zip' },
    { ...update, url: 'https://updates.example/file.zip#fragment' },
    { ...update, bytes: 0 },
    { ...update, bytes: 1_073_741_825 },
    { ...update, bytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...update, sha256: 'A'.repeat(64) },
  ]
  for (const invalid of invalidUpdates) {
    await assert.rejects(downloadUpdateArchive(invalid as any, { fetchImpl: async () => responseWith(bytes) }))
  }
  await assert.rejects(downloadUpdateArchive(update, {
    fetchImpl: async () => new Response(bytes, { status: 302, headers: { location: 'https://attacker.example/payload' } }),
  }), /status|redirect/i)
  await assert.rejects(downloadUpdateArchive(update, {
    fetchImpl: async () => responseWith(bytes, { headers: { 'content-length': String(bytes.byteLength + 1) } }),
  }), /content-length|size/i)
  await assert.rejects(downloadUpdateArchive(update, {
    fetchImpl: async () => responseWith(Buffer.concat([bytes, Buffer.from('extra')])) ,
  }), /size|bytes/i)
  await assert.rejects(downloadUpdateArchive(update, {
    fetchImpl: async () => responseWith(Buffer.alloc(bytes.byteLength, 0x78)),
  }), /SHA-256|digest/i)
  assert.deepEqual(await tempDirectories(), before)
})

test('download abort and absolute deadline cancel a stalled stream and remove its private directory', async () => {
  const before = await tempDirectories()
  await assert.rejects(downloadUpdateArchive(update, { timeoutMs: 15 * 60_000 + 1, fetchImpl: async () => responseWith(bytes) }), /15 minutes/)
  await assert.rejects(downloadUpdateArchive(update, {
    timeoutMs: 20,
    fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
      pull() { return new Promise(() => {}) },
      cancel() { return new Promise(() => {}) },
    }), { status: 200 }),
  }), /timed out|abort/i)
  assert.deepEqual(await tempDirectories(), before)

  const controller = new AbortController()
  controller.abort(new Error('caller cancelled'))
  let calledAfterAbort = false
  await assert.rejects(downloadUpdateArchive(update, {
    signal: controller.signal,
    fetchImpl: async () => { calledAfterAbort = true; return responseWith(bytes) },
  }), /abort|cancel/i)
  assert.equal(calledAfterAbort, false)
  assert.deepEqual(await tempDirectories(), before)
})

test('local server pins and serves only the verified archive through capability paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), `${tempPrefix}serve-test-`))
  const archivePath = join(directory, 'update.zip')
  await writeFile(archivePath, bytes, { mode: 0o600 })
  const server = await serveApprovedUpdate({ archivePath, update })
  try {
    const feedResponse = await fetch(server.feedUrl)
    assert.equal(feedResponse.status, 200)
    assert.equal(feedResponse.headers.get('content-type'), 'application/json')
    assert.equal(feedResponse.headers.get('access-control-allow-origin'), null)
    const feed = await feedResponse.json()
    const archiveUrl = feed.url
    assert.deepEqual(feed, {
      url: archiveUrl,
      name: update.version,
      sha256: update.sha256,
      size: update.bytes,
    })
    assert.match(archiveUrl, /^http:\/\/127\.0\.0\.1:\d+\//)
    assert.equal(archiveUrl.includes(archivePath), false)

    const archiveResponse = await fetch(archiveUrl)
    assert.equal(archiveResponse.status, 200)
    assert.equal(archiveResponse.headers.get('content-type'), 'application/zip')
    assert.equal(archiveResponse.headers.get('content-length'), String(update.bytes))
    assert.deepEqual(Buffer.from(await archiveResponse.arrayBuffer()), bytes)

    const head = await fetch(archiveUrl, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('content-length'), String(update.bytes))
    assert.equal(await head.text(), '')

    const forbiddenPath = `${new URL(archiveUrl).pathname}/extra`
    const wrongPath = await fetch(`http://127.0.0.1:${new URL(archiveUrl).port}${forbiddenPath}`)
    assert.equal(wrongPath.status, 404)
    const wrongOrigin = await fetch(archiveUrl, { headers: { origin: `http://127.0.0.1:${new URL(archiveUrl).port}` } })
    assert.equal(wrongOrigin.status, 403)
    const wrongMethod = await fetch(archiveUrl, { method: 'POST' })
    assert.equal(wrongMethod.status, 405)
    const wrongHostStatus = await new Promise<number>((resolve, reject) => {
      const target = new URL(archiveUrl)
      const request = httpRequest({ hostname: '127.0.0.1', port: Number(target.port), path: target.pathname, method: 'GET', headers: { host: 'attacker.example' } }, (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode ?? 0))
      })
      request.on('error', reject)
      request.end()
    })
    assert.equal(wrongHostStatus, 404)

    const replacedPath = join(directory, 'replaced-original.zip')
    await rename(archivePath, replacedPath)
    await writeFile(archivePath, Buffer.from('mutated bytes'), { mode: 0o600 })
    const pinned = await fetch(archiveUrl)
    assert.equal(pinned.status, 200)
    assert.deepEqual(Buffer.from(await pinned.arrayBuffer()), bytes)
  } finally {
    await server.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('server refuses symlink, non-regular, wrong-size, and wrong-hash archive paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), `${tempPrefix}invalid-server-test-`))
  try {
    const archivePath = join(directory, 'archive.zip')
    await writeFile(archivePath, Buffer.from('wrong size'))
    await assert.rejects(serveApprovedUpdate({ archivePath, update }), /size|bytes/i)

    await writeFile(archivePath, bytes)
    await assert.rejects(serveApprovedUpdate({ archivePath, update: { ...update, sha256: 'b'.repeat(64) } }), /SHA-256|digest/i)

    const symlinkPath = join(directory, 'archive-link.zip')
    await (await import('node:fs/promises')).symlink(archivePath, symlinkPath)
    await assert.rejects(serveApprovedUpdate({ archivePath: symlinkPath, update }), /regular|symlink|open/i)

    await assert.rejects(serveApprovedUpdate({ archivePath: directory, update }), /regular|file|open/i)
    assert.equal((await lstat(symlinkPath)).isSymbolicLink(), true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
