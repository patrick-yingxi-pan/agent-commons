/** The portability boundary: ONE UI, two backends, gated by capability — not by
 *  env-sniffing. This file builds the router as the REMOTE web-server variant
 *  (BACKEND=remote) and asserts the native endpoints report unavailable (409) and
 *  the capability descriptor advertises the local-* features as false. The default
 *  (mock = native-like) side is covered by tests/capabilities.test.ts.
 *
 *  BACKEND is read once at store load, so we set it BEFORE importing the router
 *  (dynamically, inside the test). `node --test` runs each file in its own process,
 *  so this never leaks into the other suites' mock store. */
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.BACKEND = 'remote'

/** Drive the given router at the handler level (mirrors tests/helpers/http.ts, but
 *  against a router we built ourselves so it picks up BACKEND=remote). */
function caller(router) {
  return async function call(method, path) {
    let status = 0
    let body = ''
    let ended = false
    const res = {
      writeHead(s) {
        status = s
        return res
      },
      setHeader() {},
      write(chunk) {
        body += chunk
        return true
      },
      end(chunk) {
        if (chunk) body += chunk
        ended = true
      },
      flushHeaders() {},
      on() {},
      get writableEnded() {
        return ended
      },
    }
    const req = { method, on: () => req }
    await router.handle(req, res, new URL(`http://test${path}`))
    return { status, json: body ? JSON.parse(body) : undefined }
  }
}

test('a remote backend reports the local-* capabilities as false', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  const caps = await call('GET', '/capabilities')
  assert.equal(caps.status, 200)
  assert.equal(caps.json.backend, 'remote')
  assert.equal(caps.json.features.localFs, false)
  assert.equal(caps.json.features.localGit, false)
  assert.equal(caps.json.features.osPicker, false)
  assert.equal(caps.json.features.clipboard, false)
  // A remote server still streams + runs schedules.
  assert.equal(caps.json.features.streaming, true)
  assert.equal(caps.json.features.scheduledExecution, true)
})

test('a remote backend 409s every native-only endpoint with capability_unavailable', async () => {
  const { buildRouter } = await import('../server/routes/index.ts')
  const call = caller(buildRouter())

  for (const path of ['/fs/pick?kind=folder', '/fs/folders/insights', '/git/repos/repo-insights/diff']) {
    const r = await call('GET', path)
    assert.equal(r.status, 409, `${path} should be gated on a remote backend`)
    assert.equal(r.json.error.code, 'capability_unavailable', `${path} should report capability_unavailable`)
  }
})
