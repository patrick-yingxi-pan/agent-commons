import { createHash, randomBytes } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { createServer } from 'node:http'
import { open, mkdtemp, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_ARCHIVE_BYTES, parseStableVersion } from './updateMetadata.mjs'

const MAX_DOWNLOAD_TIMEOUT_MS = 15 * 60_000
const TEMP_PREFIX = 'agent-commons-update-archive-'
const HASH_PATTERN = /^[a-f0-9]{64}$/

function validateUpdate(update) {
  if (!update || typeof update !== 'object' || Array.isArray(update) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(update)) ||
    Reflect.ownKeys(update).length !== 4 ||
    Reflect.ownKeys(update).some((key) => typeof key !== 'string') ||
    Object.keys(update).sort().join(',') !== 'bytes,sha256,url,version') {
    throw new Error('Approved update metadata must contain exactly version, URL, SHA-256 and byte size.')
  }
  const version = update.version
  parseStableVersion(version)
  const url = update.url
  if (typeof url !== 'string' || url.length > 8192) throw new Error('Approved update URL must be an HTTPS URL.')
  let parsedUrl
  try { parsedUrl = new URL(url) } catch {
    throw new Error('Approved update URL must be an HTTPS URL.')
  }
  if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname || parsedUrl.username || parsedUrl.password ||
    parsedUrl.hash || parsedUrl.href !== url) {
    throw new Error('Approved update URL must be canonical HTTPS without credentials or fragment.')
  }
  if (!Number.isSafeInteger(update.bytes) || update.bytes <= 0 || update.bytes > MAX_ARCHIVE_BYTES) {
    throw new Error('Approved update archive size must be a positive safe integer up to 1 GiB.')
  }
  if (typeof update.sha256 !== 'string' || !HASH_PATTERN.test(update.sha256)) {
    throw new Error('Approved update archive digest must be lowercase SHA-256.')
  }
  return Object.freeze({ version, url, sha256: update.sha256, bytes: update.bytes })
}

function asError(value, fallback) {
  return value instanceof Error ? value : new Error(fallback)
}

function abortReason(signal, fallback) {
  return asError(signal.reason, fallback)
}

function waitWithSignal(promise, signal) {
  if (signal.aborted) return Promise.reject(abortReason(signal, 'Update download was aborted.'))
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(abortReason(signal, 'Update download was aborted.'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise).then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

async function writeChunk(file, chunk, position) {
  let offset = 0
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await file.write(chunk, offset, chunk.byteLength - offset, position + offset)
    if (bytesWritten <= 0) throw new Error('Update archive could not be written completely.')
    offset += bytesWritten
  }
}

async function removePrivateDirectory(path) {
  if (path) await rm(path, { recursive: true, force: true })
}

/** Download one already-approved immutable update archive into a private
 * temporary directory. This verifies bytes only; it never publishes or installs. */
export async function downloadUpdateArchive(update, {
  signal: callerSignal,
  fetchImpl = fetch,
  timeoutMs = 15 * 60_000,
} = {}) {
  const approved = validateUpdate(update)
  if (callerSignal?.aborted) throw abortReason(callerSignal, 'Update download was aborted.')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_DOWNLOAD_TIMEOUT_MS) {
    throw new Error('Update download timeout must be a positive safe integer no greater than 15 minutes.')
  }
  if (typeof fetchImpl !== 'function') throw new Error('Update download fetch implementation is unavailable.')

  const controller = new AbortController()
  const onCallerAbort = () => controller.abort(abortReason(callerSignal, 'Update download was aborted.'))
  if (callerSignal?.aborted) onCallerAbort()
  else callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('Update download timed out.')), timeoutMs)
  timer.unref?.()

  let directory
  let file
  let reader
  let responseBody
  try {
    const response = await waitWithSignal(fetchImpl(approved.url, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: { accept: 'application/zip' },
      signal: controller.signal,
    }), controller.signal)
    responseBody = response?.body
    if (response?.redirected || response?.status !== 200) {
      throw new Error(`Update archive request failed with status ${response?.status ?? 'unknown'} or redirected.`)
    }
    const contentLength = response.headers?.get?.('content-length')
    if (contentLength !== null && contentLength !== undefined) {
      if (!/^(0|[1-9][0-9]*)$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength)) || Number(contentLength) !== approved.bytes) {
        throw new Error('Update archive Content-Length does not match approved size.')
      }
    }
    if (!response.body || typeof response.body.getReader !== 'function') throw new Error('Update archive response has no stream body.')

    directory = await mkdtemp(join(tmpdir(), TEMP_PREFIX))
    await chmod(directory, 0o700)
    const archivePath = join(directory, 'update.zip')
    file = await open(archivePath, 'wx', 0o600)
    reader = response.body.getReader()
    responseBody = undefined
    const hash = createHash('sha256')
    let received = 0
    while (true) {
      const result = await waitWithSignal(reader.read(), controller.signal)
      if (result.done) break
      if (!(result.value instanceof Uint8Array)) throw new Error('Update archive stream yielded invalid bytes.')
      received += result.value.byteLength
      if (!Number.isSafeInteger(received) || received > approved.bytes || received > MAX_ARCHIVE_BYTES) {
        throw new Error('Update archive stream exceeds its approved byte size.')
      }
      hash.update(result.value)
      await waitWithSignal(writeChunk(file, result.value, received - result.value.byteLength), controller.signal)
    }
    if (received !== approved.bytes) throw new Error('Update archive stream size does not match approved bytes.')
    if (hash.digest('hex') !== approved.sha256) throw new Error('Update archive SHA-256 digest does not match approved metadata.')
    await waitWithSignal(file.sync(), controller.signal)
    await file.close()
    file = undefined
    let disposed = false
    return {
      archivePath,
      async dispose() {
        if (disposed) return
        await removePrivateDirectory(directory)
        disposed = true
      },
    }
  } catch (error) {
    const cleanupErrors = []
    if (reader) {
      try { void reader.cancel().catch(() => {}) } catch {}
    } else if (responseBody?.cancel) {
      try { void responseBody.cancel().catch(() => {}) } catch {}
    }
    if (file) {
      try { await file.close() } catch (closeError) { cleanupErrors.push(closeError) }
    }
    if (directory) {
      try { await removePrivateDirectory(directory) } catch (removeError) { cleanupErrors.push(removeError) }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError([asError(error, 'Update archive download failed.'), ...cleanupErrors], 'Update archive download failed and private cleanup was incomplete.')
    }
    throw error
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', onCallerAbort)
  }
}

async function listenLoopback(server) {
  await new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error) }
    const onListening = () => { server.off('error', onError); resolve(undefined) }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Local update server did not bind an IPv4 loopback port.')
  return `127.0.0.1:${address.port}`
}

async function verifyArchiveHandle(file, approved) {
  const metadata = await file.stat()
  if (!metadata.isFile()) throw new Error('Approved update archive must be a regular file, not a symlink or special file.')
  if (metadata.size !== approved.bytes) throw new Error('Approved update archive size does not match its metadata.')
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  let offset = 0
  while (offset < approved.bytes) {
    const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.byteLength, approved.bytes - offset), offset)
    if (bytesRead <= 0) throw new Error('Approved update archive ended before its declared size.')
    hash.update(buffer.subarray(0, bytesRead))
    offset += bytesRead
  }
  if (hash.digest('hex') !== approved.sha256) throw new Error('Approved update archive SHA-256 digest does not match metadata.')
}

/** Serve a previously approved archive over a short-lived capability URL on
 * IPv4 loopback. This does not download, authorize, or install updates. */
export async function serveApprovedUpdate({ archivePath, update }) {
  const approved = validateUpdate(update)
  if (typeof archivePath !== 'string' || archivePath.length === 0) throw new Error('Approved update archive path is required.')
  let file
  try {
    const noFollow = fsConstants.O_NOFOLLOW
    if (typeof noFollow !== 'number') throw new Error('This platform cannot safely open the approved update archive.')
    file = await open(archivePath, fsConstants.O_RDONLY | noFollow)
    await verifyArchiveHandle(file, approved)

    const feedToken = randomBytes(32).toString('hex')
    const archiveToken = randomBytes(32).toString('hex')
    const feedPath = `/update/${feedToken}/feed.json`
    const archiveRoutePath = `/update/${archiveToken}/archive.zip`
    const activeStreams = new Set()
    let authority
    const server = createServer((request, response) => {
      if (!authority || request.headers.host !== authority) {
        response.writeHead(404).end()
        return
      }
      const origin = request.headers.origin
      if (origin !== undefined) {
        response.writeHead(403).end()
        return
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' }).end()
        return
      }
      if (request.url === feedPath) {
        const archiveUrl = `http://${authority}${archiveRoutePath}`
        const body = Buffer.from(`${JSON.stringify({
          url: archiveUrl,
          name: approved.version,
          sha256: approved.sha256,
          size: approved.bytes,
        })}\n`)
        const headers = {
          'cache-control': 'no-store',
          'content-length': String(body.byteLength),
          'content-type': 'application/json',
          'x-content-type-options': 'nosniff',
        }
        response.writeHead(200, headers)
        response.end(request.method === 'HEAD' ? undefined : body)
        return
      }
      if (request.url !== archiveRoutePath) {
        response.writeHead(404).end()
        return
      }
      if (request.method === 'HEAD') {
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-length': String(approved.bytes),
          'content-type': 'application/zip',
          'x-content-type-options': 'nosniff',
        }).end()
        return
      }
      if (activeStreams.size >= 2) {
        response.writeHead(503).end()
        return
      }
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': String(approved.bytes),
        'content-type': 'application/zip',
        'x-content-type-options': 'nosniff',
      })
      const stream = file.createReadStream({ autoClose: false, start: 0, end: approved.bytes - 1 })
      activeStreams.add(stream)
      stream.once('close', () => activeStreams.delete(stream))
      stream.once('error', () => {
        activeStreams.delete(stream)
        if (!response.headersSent) response.writeHead(500).end()
        else response.destroy()
      })
      response.once('close', () => {
        if (!response.writableFinished && !stream.destroyed) stream.destroy()
      })
      stream.pipe(response)
    })
    server.maxConnections = 4
    server.maxRequestsPerSocket = 16
    server.headersTimeout = 10_000
    server.requestTimeout = 30_000
    server.timeout = 30_000
    server.keepAliveTimeout = 5_000

    try {
      authority = await listenLoopback(server)
    } catch (error) {
      for (const stream of activeStreams) stream.destroy()
      await file.close()
      file = undefined
      throw error
    }

    let closePromise
    return {
      feedUrl: `http://${authority}${feedPath}`,
      close() {
        if (closePromise) return closePromise
        closePromise = new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve(undefined))
          server.closeAllConnections?.()
          for (const stream of activeStreams) stream.destroy()
        }).finally(async () => {
          if (file) {
            const handle = file
            file = undefined
            await handle.close()
          }
        })
        return closePromise
      },
    }
  } catch (error) {
    if (file) await file.close().catch(() => {})
    throw error
  }
}
