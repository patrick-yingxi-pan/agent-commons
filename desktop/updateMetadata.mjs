import { isIP } from 'node:net'

const MAX_FEED_BYTES = 64 * 1024
export const MAX_ARCHIVE_BYTES = 1024 ** 3
const MAX_DEADLINE_MS = 15_000
const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
const HASH_PATTERN = /^[a-f0-9]{64}$/

/** Release-owned configuration, never renderer-supplied update destination. */
export function assertUpdateBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new Error('AGENT_COMMONS_UPDATE_BASE_URL must be a canonical HTTPS directory URL.')
  }
  let url
  try { url = new URL(value) } catch {
    throw new Error('AGENT_COMMONS_UPDATE_BASE_URL must be a canonical HTTPS directory URL.')
  }
  const hostname = url.hostname
  if (url.protocol !== 'https:' || url.href !== value || !value.endsWith('/') ||
    url.username || url.password || url.search || url.hash || url.port || /[%\\]/.test(value) ||
    isIP(hostname) || !hostname.includes('.') || /(?:^|\.)(?:localhost|local)$/.test(hostname) ||
    !hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error('AGENT_COMMONS_UPDATE_BASE_URL must be a canonical public HTTPS directory URL without credentials, query, fragment or port.')
  }
  return value
}

/** Parse only a stable, three-part decimal version with safe integer parts. */
export function parseStableVersion(value) {
  if (typeof value !== 'string') throw new Error('Update version must be a stable three-part version.')
  const match = VERSION_PATTERN.exec(value)
  if (!match) throw new Error(`Update version is not a stable three-part version: ${value}`)
  const parts = match.slice(1).map(Number)
  if (!parts.every(Number.isSafeInteger)) throw new Error(`Update version contains an unsafe integer: ${value}`)
  return Object.freeze(parts)
}

/** Compare stable-version strings or the frozen tuples returned above. */
export function compareStableVersions(a, b) {
  const left = Array.isArray(a) ? validateVersionTuple(a) : parseStableVersion(a)
  const right = Array.isArray(b) ? validateVersionTuple(b) : parseStableVersion(b)
  for (let index = 0; index < 3; index += 1) {
    if (left[index] < right[index]) return -1
    if (left[index] > right[index]) return 1
  }
  return 0
}

function validateVersionTuple(value) {
  if (value.length !== 3 || !value.every((part) => Number.isSafeInteger(part) && part >= 0)) {
    throw new Error('Stable version tuple must contain three non-negative safe integers.')
  }
  return value
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
}

function assertArchitecture(architecture) {
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new Error('Update architecture must be arm64 or x64.')
  }
}

/** Validate the whole deterministic one-architecture Squirrel static feed. */
export function parseUpdateFeed(body, { baseUrl, architecture, currentVersion }) {
  assertUpdateBaseUrl(baseUrl)
  assertArchitecture(architecture)
  parseStableVersion(currentVersion)
  if (typeof body !== 'string') throw new Error('Update metadata body must be UTF-8 JSON text.')
  let parsed
  try { parsed = JSON.parse(body) } catch (error) {
    throw new Error('Update metadata is not valid JSON.', { cause: error })
  }
  if (!hasExactKeys(parsed, ['currentRelease', 'releases']) || !Array.isArray(parsed.releases) || parsed.releases.length !== 1) {
    throw new Error('Update metadata must contain exactly currentRelease and one release.')
  }
  const release = parsed.releases[0]
  if (!hasExactKeys(release, ['version', 'updateTo']) ||
    !hasExactKeys(release.updateTo, ['version', 'url', 'name', 'sha256', 'size'])) {
    throw new Error('Update metadata release has an unexpected shape.')
  }

  const version = parsed.currentRelease
  const versionParts = parseStableVersion(version)
  if (release.version !== version || release.updateTo.version !== version || release.updateTo.name !== version) {
    throw new Error('Update metadata versions do not agree.')
  }
  const expectedUrl = `${baseUrl}Agent-Commons-${version}-macos-${architecture}.zip`
  if (release.updateTo.url !== expectedUrl) throw new Error('Update metadata archive URL does not match its configured version and architecture.')
  if (typeof release.updateTo.sha256 !== 'string' || !HASH_PATTERN.test(release.updateTo.sha256)) {
    throw new Error('Update metadata archive digest must be lowercase SHA-256.')
  }
  const bytes = release.updateTo.size
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_ARCHIVE_BYTES) {
    throw new Error('Update metadata archive size must be a positive safe integer no greater than 1 GiB.')
  }
  if (compareStableVersions(versionParts, currentVersion) <= 0) return null
  return Object.freeze({
    version,
    url: expectedUrl,
    sha256: release.updateTo.sha256,
    bytes,
  })
}

function abortError(signal, timedOut) {
  if (timedOut) return new Error('Update metadata request exceeded its absolute deadline.')
  const reason = signal.reason
  if (reason instanceof Error) return reason
  return new Error(typeof reason === 'string' && reason ? reason : 'Update metadata request was aborted.')
}

function awaitAbortable(value, signal, timedOut) {
  if (signal.aborted) return Promise.reject(abortError(signal, timedOut()))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal, timedOut()))
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(value).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function readBoundedUtf8(body, signal, timedOut) {
  if (!body) throw new Error('Update metadata response has no body.')
  const reader = body.getReader()
  const chunks = []
  let total = 0
  let complete = false
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      if (signal.aborted) throw abortError(signal, timedOut())
      const { done, value } = await awaitAbortable(reader.read(), signal, timedOut)
      if (signal.aborted) throw abortError(signal, timedOut())
      if (done) { complete = true; break }
      if (!(value instanceof Uint8Array)) throw new Error('Update metadata response body was not a byte stream.')
      total += value.byteLength
      if (total > MAX_FEED_BYTES) throw new Error('Update metadata response exceeds the 64 KiB limit.')
      chunks.push(value)
    }
  } catch (error) {
    cancel()
    if (signal.aborted) throw abortError(signal, timedOut())
    if (error instanceof Error && /64 KiB|byte stream/.test(error.message)) throw error
    throw new Error('Could not read the complete update metadata response body.', { cause: error })
  } finally {
    signal.removeEventListener('abort', cancel)
    if (!complete) cancel()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch (error) {
    throw new Error('Update metadata response is not valid UTF-8.', { cause: error })
  }
}

function assertContentLength(response) {
  const value = response.headers.get('content-length')
  if (value === null) return
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Update metadata Content-Length is invalid.')
  const length = Number(value)
  if (!Number.isSafeInteger(length) || length > MAX_FEED_BYTES) {
    throw new Error('Update metadata response exceeds the 64 KiB limit.')
  }
}

/** Read-only metadata request. It never fetches an archive or supplies identity. */
export async function checkUpdateMetadata({
  baseUrl,
  architecture,
  currentVersion,
  signal,
  fetchImpl = fetch,
  timeoutMs = MAX_DEADLINE_MS,
}) {
  assertUpdateBaseUrl(baseUrl)
  assertArchitecture(architecture)
  parseStableVersion(currentVersion)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_DEADLINE_MS) {
    throw new RangeError('Update metadata deadline must be between 1 and 15000 milliseconds.')
  }
  if (signal?.aborted) throw abortError(signal, false)

  const controller = new AbortController()
  let deadlineExpired = false
  const timedOut = () => deadlineExpired
  const onCallerAbort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', onCallerAbort, { once: true })
  const timer = setTimeout(() => {
    deadlineExpired = true
    controller.abort(new Error('Update metadata request exceeded its absolute deadline.'))
  }, timeoutMs)
  const feedUrl = `${baseUrl}macos-${architecture}.json`
  try {
    const response = await awaitAbortable(fetchImpl(feedUrl, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }), controller.signal, timedOut)
    try {
      if (controller.signal.aborted) throw abortError(controller.signal, timedOut())
      if (response.redirected || (response.url && response.url !== feedUrl)) {
        throw new Error('Update metadata feed redirects are not allowed.')
      }
      if (response.status !== 200) throw new Error(`Update metadata feed returned HTTP ${response.status}.`)
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (contentType !== 'application/json') throw new Error('Update metadata feed must use application/json.')
      assertContentLength(response)
      const body = await readBoundedUtf8(response.body, controller.signal, timedOut)
      return parseUpdateFeed(body, { baseUrl, architecture, currentVersion })
    } catch (error) {
      if (!response.bodyUsed) void response.body?.cancel().catch(() => {})
      throw error
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCallerAbort)
  }
}
