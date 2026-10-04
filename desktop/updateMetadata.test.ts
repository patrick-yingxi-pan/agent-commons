import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertUpdateBaseUrl,
  checkUpdateMetadata,
  compareStableVersions,
  MAX_ARCHIVE_BYTES,
  parseStableVersion,
  parseUpdateFeed,
} from './updateMetadata.mjs'

const baseUrl = 'https://updates.example/releases/'
const architecture = 'arm64'
const currentVersion = '1.2.3'
const newerVersion = '1.3.0'
const digest = 'a'.repeat(64)
const archiveUrl = `${baseUrl}Agent-Commons-${newerVersion}-macos-${architecture}.zip`

function feed(version = newerVersion, arch = architecture) {
  const url = `${baseUrl}Agent-Commons-${version}-macos-${arch}.zip`
  return {
    currentRelease: version,
    releases: [{
      version,
      updateTo: { version, url, name: version, sha256: digest, size: 1234 },
    }],
  }
}

function response(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers },
    ...init,
  })
}

test('update metadata validates the configured HTTPS directory and stable version ordering', () => {
  assert.equal(assertUpdateBaseUrl(baseUrl), baseUrl)
  for (const value of [
    undefined, null, '', 'http://updates.example/releases/', 'https://updates.example/releases',
    'https://localhost/releases/', 'https://updates.local/releases/', 'https://updates.example.local/releases/',
    'https://updates/releases/', 'https://127.0.0.1/releases/', 'https://[::1]/releases/',
    'https://user:secret@updates.example/releases/', 'https://updates.example:443/releases/',
    'https://updates.example/releases/?channel=stable', 'https://updates.example/releases/#latest',
    'https://updates.example/releases/%2e%2e/private/', 'https://updates.example/releases/../private/',
    'https://updates.example/releases\\private/', ' https://updates.example/releases/',
    'https://UPDATES.example/releases/',
  ]) assert.throws(() => assertUpdateBaseUrl(value))

  assert.deepEqual(parseStableVersion('0.10.2'), [0, 10, 2])
  assert.equal(Object.isFrozen(parseStableVersion('0.10.2')), true)
  for (const value of ['', '1', '1.2', '1.2.3.4', '01.2.3', '1.02.3', '1.2.03', '1.2.3-beta.1', '1.2.3+build.1', '9007199254740992.0.0']) {
    assert.throws(() => parseStableVersion(value))
  }
  assert.equal(compareStableVersions('1.2.10', '1.2.9'), 1)
  assert.equal(compareStableVersions('2.0.0', '2.0.0'), 0)
  assert.equal(compareStableVersions('0.9.99', '1.0.0'), -1)
})

test('feed parser admits only one exact matching architecture release and freezes newer metadata', () => {
  const parsed = parseUpdateFeed(JSON.stringify(feed()), { baseUrl, architecture, currentVersion })
  assert.deepEqual(parsed, { version: newerVersion, url: archiveUrl, sha256: digest, bytes: 1234 })
  assert.equal(Object.isFrozen(parsed), true)
  assert.equal(parseUpdateFeed(JSON.stringify(feed(currentVersion)), { baseUrl, architecture, currentVersion }), null)

  const staleButMalformed = feed(currentVersion)
  staleButMalformed.releases[0]!.updateTo.sha256 = 'A'.repeat(64)
  assert.throws(() => parseUpdateFeed(JSON.stringify(staleButMalformed), { baseUrl, architecture, currentVersion }), /SHA-256/)
  const atLimit = feed()
  atLimit.releases[0]!.updateTo.size = MAX_ARCHIVE_BYTES
  assert.equal(parseUpdateFeed(JSON.stringify(atLimit), { baseUrl, architecture, currentVersion })?.bytes, MAX_ARCHIVE_BYTES)
  atLimit.releases[0]!.updateTo.size += 1
  assert.throws(() => parseUpdateFeed(JSON.stringify(atLimit), { baseUrl, architecture, currentVersion }), /1 GiB/)
})

test('feed parser rejects unknown fields, mismatched versions, URL, architecture, hash and size', () => {
  const invalid: unknown[] = []
  const extraRoot = feed() as Record<string, unknown>
  extraRoot.unexpected = true
  invalid.push(extraRoot)
  const extraRelease = feed()
  ;(extraRelease.releases[0] as unknown as Record<string, unknown>).unexpected = true
  invalid.push(extraRelease)
  const extraUpdate = feed()
  ;(extraUpdate.releases[0]!.updateTo as unknown as Record<string, unknown>).unexpected = true
  invalid.push(extraUpdate)
  invalid.push({ ...feed(), releases: [] })
  invalid.push({ ...feed(), releases: [feed().releases[0], feed().releases[0]] })
  invalid.push({ ...feed(), currentRelease: '1.3.1' })
  invalid.push({ ...feed(), releases: [{ ...feed().releases[0], version: '1.3.1' }] })
  invalid.push({ ...feed(), releases: [{ ...feed().releases[0], updateTo: { ...feed().releases[0]!.updateTo, version: '1.3.1' } }] })
  invalid.push({ ...feed(), releases: [{ ...feed().releases[0], updateTo: { ...feed().releases[0]!.updateTo, name: 'Other' } }] })
  invalid.push(feed(newerVersion, 'x64'))
  invalid.push({ ...feed(), releases: [{ ...feed().releases[0], updateTo: { ...feed().releases[0]!.updateTo, url: `${baseUrl}other.zip` } }] })
  invalid.push({ ...feed(), releases: [{ ...feed().releases[0], updateTo: { ...feed().releases[0]!.updateTo, sha256: 'F'.repeat(64) } }] })
  for (const size of [0, -1, 1.5, 1024 ** 3 + 1, Number.MAX_SAFE_INTEGER + 1]) {
    invalid.push({ ...feed(), releases: [{ ...feed().releases[0], updateTo: { ...feed().releases[0]!.updateTo, size } }] })
  }
  for (const value of invalid) assert.throws(() => parseUpdateFeed(JSON.stringify(value), { baseUrl, architecture, currentVersion }))
  assert.throws(() => parseUpdateFeed('{', { baseUrl, architecture, currentVersion }), /JSON/)
})

test('metadata check makes one credential-free no-cache request to the configured feed', async () => {
  let called = 0
  const result = await checkUpdateMetadata({
    baseUrl,
    architecture,
    currentVersion,
    async fetchImpl(input, init) {
      called += 1
      assert.equal(input, `${baseUrl}macos-${architecture}.json`)
      assert.equal(init?.method, 'GET')
      assert.equal(init?.redirect, 'error')
      assert.equal(init?.credentials, 'omit')
      assert.equal(init?.cache, 'no-store')
      assert.deepEqual(init?.headers, { Accept: 'application/json' })
      assert.ok(init?.signal)
      return response(JSON.stringify(feed()))
    },
  })
  assert.equal(called, 1)
  assert.deepEqual(result, { version: newerVersion, url: archiveUrl, sha256: digest, bytes: 1234 })
})

test('metadata check does not fetch when its caller signal is already aborted', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled before fetch'))
  let called = false
  await assert.rejects(checkUpdateMetadata({
    baseUrl,
    architecture,
    currentVersion,
    signal: controller.signal,
    async fetchImpl() {
      called = true
      return response(JSON.stringify(feed()))
    },
  }), /cancelled before fetch/)
  assert.equal(called, false)
})

test('metadata check rejects redirects, non-success, wrong media type and oversized declared bodies', async () => {
  const run = (fetchImpl: typeof fetch) => checkUpdateMetadata({ baseUrl, architecture, currentVersion, fetchImpl })
  await assert.rejects(run(async () => response(JSON.stringify(feed()), { status: 302 })), /HTTP 302/)
  await assert.rejects(run(async () => ({ ...response(JSON.stringify(feed())), redirected: true } as Response)), /redirect/)
  await assert.rejects(run(async () => response(JSON.stringify(feed()), { headers: { 'content-type': 'text/plain' } })), /application\/json/i)
  let cancelled = false
  const oversizedDeclared = new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true } }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-length': String(64 * 1024 + 1) },
  })
  await assert.rejects(run(async () => oversizedDeclared), /64 KiB/)
  assert.equal(cancelled, true, 'rejecting an oversized declaration cancels the unread body')
})

test('metadata check caps streamed bytes and rejects truncated or invalid UTF-8 feeds', async () => {
  let cancelled = false
  const oversized = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(40 * 1024))
      controller.enqueue(new Uint8Array(25 * 1024))
    },
    cancel() { cancelled = true },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  await assert.rejects(checkUpdateMetadata({ baseUrl, architecture, currentVersion, fetchImpl: async () => oversized }), /64 KiB/)
  assert.equal(cancelled, true)

  const truncated = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"currentRelease":')); controller.error(new Error('truncated stream')) },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  await assert.rejects(checkUpdateMetadata({ baseUrl, architecture, currentVersion, fetchImpl: async () => truncated }), /body|stream|truncated/i)

  const invalidUtf8 = new Response(new Uint8Array([0xc3, 0x28]), { status: 200, headers: { 'content-type': 'application/json' } })
  await assert.rejects(checkUpdateMetadata({ baseUrl, architecture, currentVersion, fetchImpl: async () => invalidUtf8 }), /UTF-8/i)
})

test('early response refusal does not wait for a body cancellation promise', async () => {
  let cancellationStarted = false
  const stalledCancel = new Response(new ReadableStream<Uint8Array>({
    cancel() {
      cancellationStarted = true
      return new Promise<void>(() => {})
    },
  }), { status: 503, headers: { 'content-type': 'application/json' } })
  await assert.rejects(checkUpdateMetadata({
    baseUrl,
    architecture,
    currentVersion,
    fetchImpl: async () => stalledCancel,
  }), /HTTP 503/)
  assert.equal(cancellationStarted, true, 'the rejected response body is cancelled asynchronously')
})

test('metadata deadline and caller abort remain active during a stalled body read', async () => {
  let timeoutCancelled = false
  const stalled = () => new Response(new ReadableStream<Uint8Array>({
    pull() { return new Promise<void>(() => {}) },
    cancel() { timeoutCancelled = true },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  await assert.rejects(checkUpdateMetadata({
    baseUrl, architecture, currentVersion, timeoutMs: 15,
    fetchImpl: async () => stalled(),
  }), /deadline|timed out/i)
  assert.equal(timeoutCancelled, true)

  let callerCancelled = false
  const abortController = new AbortController()
  const pending = checkUpdateMetadata({
    baseUrl, architecture, currentVersion, signal: abortController.signal, timeoutMs: 1000,
    fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
      pull() { return new Promise<void>(() => {}) },
      cancel() { callerCancelled = true },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  })
  setTimeout(() => abortController.abort(new Error('caller stopped')), 10)
  await assert.rejects(pending, /caller stopped|abort/i)
  assert.equal(callerCancelled, true)
})

test('stale metadata is fully fetched and validated before returning no update', async () => {
  let requested = false
  const result = await checkUpdateMetadata({
    baseUrl, architecture, currentVersion,
    async fetchImpl(input) {
      requested = true
      assert.equal(input, `${baseUrl}macos-${architecture}.json`)
      return response(JSON.stringify(feed(currentVersion)))
    },
  })
  assert.equal(requested, true)
  assert.equal(result, null)
})
