import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SMOKE_MODEL_ID, startAttachmentSmokeEndpoint } from './attachmentSmokeFixture.mjs'
import { preserveSmokeFailure, writeDetachEvidence } from './attachmentSmoke.mjs'

const documentText = (first: string, second: string) => `user prose with { braces }\n\n${JSON.stringify({ attached_files: [
  { name: 'same.py', status: 'ready', text: first },
  { name: 'same.py', status: 'ready', text: second },
  { name: 'photo.png', status: 'preview-only' },
] })}`

test('captures exact same-named attachment bodies and supports non-stream and stream probes', async () => {
  const fixture = await startAttachmentSmokeEndpoint()
  try {
    const models = await fetch(`${fixture.origin}/v1/models`)
    assert.equal(models.status, 200)
    assert.equal((await models.json()).data[0].id, SMOKE_MODEL_ID)

    const ignored = await fetch(`${fixture.origin}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'ordinary message' }] }) })
    assert.equal(ignored.status, 200)
    assert.equal(fixture.documents.length, 0)
    assert.equal(fixture.requests.length, 1)
    assert.equal(fixture.requests[0].messages[0].content, 'ordinary message')

    const body = { messages: [{ role: 'user', content: documentText('# first', '# second') }] }
    const response = await fetch(`${fixture.origin}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal(response.status, 200)
    assert.match((await response.json()).content[0].text, /# first/)
    assert.deepEqual(fixture.documents[0].attached_files.map((file: { name: string; text?: string }) => [file.name, file.text]), [['same.py', '# first'], ['same.py', '# second'], ['photo.png', undefined]])

    const stream = await fetch(`${fixture.origin}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, stream: true }) })
    assert.equal(stream.status, 200)
    assert.match(await stream.text(), /Read supplied attachment: # first/)
    assert.equal(fixture.documents.length, 2)
    assert.equal(fixture.requests.length, 3)
    assert.equal(fixture.requests[1].messages[0].content, body.messages[0].content)
    assert.match(fixture.requests[1].messages[0].content, /user prose with \{ braces \}/)
  } finally {
    await fixture.close()
  }
})

test('malformed and oversized requests fail safely without forwarding or poisoning the listener', async () => {
  const fixture = await startAttachmentSmokeEndpoint()
  try {
    const malformed = await fetch(`${fixture.origin}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' })
    assert.equal(malformed.status, 400)
    const oversized = await fetch(`${fixture.origin}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(12 * 1024 * 1024) }] }) })
    assert.equal(oversized.status, 413)
    assert.deepEqual(fixture.documents, [])
    const models = await fetch(`${fixture.origin}/v1/models`)
    assert.equal(models.status, 200)
    const missing = await fetch(`${fixture.origin}/v1/messages/extra`, { method: 'POST' })
    assert.equal(missing.status, 404)
  } finally {
    await fixture.close()
  }
})

test('aborted request bodies do not reject the server or capture partial data', async () => {
  const fixture = await startAttachmentSmokeEndpoint()
  try {
    await new Promise<void>((resolve) => {
      const url = new URL(`${fixture.origin}/v1/messages`)
      const req = request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'content-length': 100_000 } })
      req.on('error', () => resolve())
      req.on('socket', (socket) => {
        const send = () => req.write('{"messages":[{"role":"user","content":"partial', () => {
          req.destroy()
          resolve()
        })
        if (socket.connecting) socket.once('connect', send)
        else send()
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.deepEqual(fixture.documents, [])
    assert.equal((await fetch(`${fixture.origin}/v1/models`)).status, 200)
  } finally {
    await fixture.close()
    await assert.rejects(fetch(`${fixture.origin}/v1/models`))
  }
})

test('detach diagnostics are private fixture evidence and preserve the original smoke failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-commons-attachment-diagnostics-'))
  const reportPath = join(root, 'failure.json')
  const evidence = {
    stage: 'pdf-detach-reply',
    renderedTurns: ['fixture reply'],
    session: {
      activeTurnId: null,
      messages: [{ role: 'assistant', content: 'fixture reply' }],
      attachments: [{ id: 'fixture-id', label: 'native-document.pdf', documentImport: { format: 'pdf', status: 'ready' } }],
    },
    requestCount: 1,
    latestRequest: { messageCount: 2, lastUserContent: 'Check detached PDF.' },
    screenshotPath: '/private/tmp/fixture.png',
  }
  try {
    await writeDetachEvidence(reportPath, evidence)
    const permissions = (await stat(reportPath)).mode & 0o777
    assert.equal(permissions, 0o600)
    const serialized = await readFile(reportPath, 'utf8')
    assert.deepEqual(JSON.parse(serialized), evidence)
    assert.doesNotMatch(serialized, /"[^"\n]*(?:token|authorization|secret)[^"\n]*"\s*:/i)

    const original = new Error('original smoke assertion')
    const diagnostic = new Error('diagnostic collection failed')
    const logged: string[] = []
    const previousError = console.error
    console.error = (...args: unknown[]) => logged.push(args.join(' '))
    try {
      await assert.rejects(
        preserveSmokeFailure(original, async () => { throw diagnostic }),
        (error: unknown) => error === original,
      )
    } finally {
      console.error = previousError
    }
    assert.equal(logged.some((line) => line.includes('diagnostic collection failed')), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
