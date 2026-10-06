import { createServer } from 'node:http'

const MAX_REQUEST_BYTES = 256 * 1024
export const REVIEW_SMOKE_MODEL = 'desktop-contribution-review-smoke-model'

function writeJson(res, status, value) {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

async function readBody(req) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_REQUEST_BYTES) return { kind: 'too-large' }
      chunks.push(buffer)
    }
  } catch {
    return { kind: 'aborted' }
  }
  return { kind: 'ok', raw: Buffer.concat(chunks).toString('utf8') }
}

function reviewFrom(body) {
  if (!Array.isArray(body?.messages) || body.messages.length !== 1) return undefined
  const message = body.messages[0]
  if (message?.role !== 'user' || typeof message.content !== 'string') return undefined
  try {
    const review = JSON.parse(message.content)
    return review && typeof review === 'object' && !Array.isArray(review) &&
      Object.hasOwn(review, 'version') && Array.isArray(review.entries)
      ? review
      : undefined
  } catch {
    return undefined
  }
}

function resultFor(review, mode) {
  const finding = mode === 'findings' && typeof review.entries[0]?.id === 'string'
    ? [{ entryId: review.entries[0].id, body: 'The first entry needs a clearer acceptance condition.' }]
    : []
  const summary = finding.length
    ? 'One scoped issue needs attention.'
    : 'The contribution review passed.'
  return {
    id: 'msg_contribution_review_smoke',
    type: 'message',
    role: 'assistant',
    model: REVIEW_SMOKE_MODEL,
    content: [{ type: 'text', text: JSON.stringify({ summary, findings: finding }) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 137, output_tokens: 29 },
  }
}

export async function startContributionReviewSmokeEndpoint() {
  const requests = []
  const held = new Set()
  const sockets = new Set()
  let mode = 'findings'
  let closing
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0]
    if (req.method === 'GET' && path === '/v1/models') {
      writeJson(res, 200, { data: [{ id: REVIEW_SMOKE_MODEL, display_name: 'Contribution review fixture' }] })
      return
    }
    if (req.method !== 'POST' || path !== '/v1/messages') {
      writeJson(res, 404, { error: { type: 'not_found', message: 'Not found' } })
      return
    }
    const bodyResult = await readBody(req)
    if (bodyResult.kind === 'aborted') return
    if (bodyResult.kind === 'too-large') {
      writeJson(res, 413, { error: { type: 'request_too_large', message: 'Request exceeds 256 KiB.' } })
      req.resume()
      return
    }
    let body
    try {
      body = bodyResult.raw ? JSON.parse(bodyResult.raw) : {}
    } catch {
      writeJson(res, 400, { error: { type: 'invalid_request', message: 'Request body must be JSON.' } })
      return
    }
    const review = reviewFrom(body)
    if (!review) {
      writeJson(res, 200, {
        id: 'msg_contribution_review_probe', type: 'message', role: 'assistant',
        model: REVIEW_SMOKE_MODEL, content: [{ type: 'text', text: 'Fixture is ready.' }],
        stop_reason: 'end_turn', usage: { input_tokens: 137, output_tokens: 29 },
      })
      return
    }
    requests.push(structuredClone(body))
    const selectedMode = mode
    if (selectedMode === 'hold') {
      await new Promise((resolve) => {
        const entry = { res, review, resolve }
        held.add(entry)
        const finish = () => {
          held.delete(entry)
          resolve()
        }
        res.once('close', finish)
        entry.release = (releaseMode) => {
          if (!held.has(entry)) return
          res.off('close', finish)
          writeJson(res, 200, resultFor(review, releaseMode))
          finish()
        }
      })
      return
    }
    writeJson(res, 200, resultFor(review, selectedMode))
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    get heldCount() { return held.size },
    setMode(nextMode) {
      if (!['passed', 'findings', 'hold'].includes(nextMode)) throw new TypeError('Unsupported fixture mode.')
      mode = nextMode
    },
    releaseHeld(releaseMode = 'passed') {
      if (!['passed', 'findings'].includes(releaseMode)) throw new TypeError('Held reviews can only be released as passed or findings.')
      const pending = [...held]
      for (const entry of pending) entry.release(releaseMode)
      return pending.length
    },
    close() {
      if (closing) return closing
      closing = new Promise((resolve, reject) => {
        for (const entry of [...held]) {
          entry.res.destroy()
          entry.resolve()
        }
        server.close((error) => error ? reject(error) : resolve())
        for (const socket of sockets) socket.destroy()
      })
      return closing
    },
  }
}
