/** Real loopback protocol + encrypted-file vault + supervised-channel contract.
 * EventEmitters stand in for Electron's process endpoints and a test cipher
 * stands in for safeStorage. This is not packaged or macOS Keychain evidence. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { openMcpCredentialVault } from '../desktop/mcpCredentialVault.mjs'
import { createMcpCredentialHost, installMcpCredentialRuntime } from '../desktop/mcpCredentialProtocol.mjs'
import { createMcpConnectionRegistry, mcpConnectionCreationId } from './mcpConnections.ts'
import { createMcpConnectionInspector } from './mcpConnectionInspector.ts'
import { MCP_MODERN_VERSION } from './mcpDiscovery.ts'

test('authenticated discovery uses the exact private credential and survives a registry/vault restart without executing any tool', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-commons-mcp-integration-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const key = randomBytes(32)
  const encryption = {
    encrypt(plaintext: string) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), body])
    },
    decrypt(bytes: Buffer) {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      cipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
    },
  }
  const calls: string[] = []
  const secret = 'integration-outbound-bearer'
  const peer = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    calls.push(body.method)
    assert.equal(request.headers.authorization, `Bearer ${secret}`)
    assert.equal(request.headers['mcp-method'], body.method)
    assert.equal(request.headers['mcp-protocol-version'], MCP_MODERN_VERSION)
    const result = body.method === 'server/discover'
      ? { supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} } }
      : { tools: [{ name: 'inspect', description: 'Inspect records', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
  })
  peer.listen(0, '127.0.0.1')
  await once(peer, 'listening')
  t.after(async () => {
    peer.closeAllConnections()
    await new Promise<void>(resolve => peer.close(() => resolve()))
  })
  const address = peer.address()
  assert.ok(address && typeof address === 'object')
  const endpoint = `http://127.0.0.1:${address.port}/mcp`
  const id = mcpConnectionCreationId('owner', 'integration')
  const binding = { tenantId: 'owner', connectionId: id, endpoint }
  const filePath = join(directory, 'mcp-credentials.v1.json')
  let vault = await openMcpCredentialVault({ filePath, ...encryption })
  const reference = await vault.provision(binding, secret)
  const child = new EventEmitter() as EventEmitter & { postMessage(message: unknown): void }
  const parentPort = new EventEmitter() as EventEmitter & { postMessage(message: unknown): void }
  child.postMessage = message => queueMicrotask(() => parentPort.emit('message', { data: message }))
  parentPort.postMessage = message => queueMicrotask(() => child.emit('message', message))
  const runtime = installMcpCredentialRuntime(parentPort)!
  const host = createMcpCredentialHost(child, { resolve: (ref: string, owner: typeof binding) => vault.read(ref, owner) })
  t.after(() => { runtime.close(); host.close() })
  let registry = createMcpConnectionRegistry()
  registry.create({ id, label: 'Research', endpoint, authentication: 'device-bearer' }, 'owner', true)
  const inspector = () => createMcpConnectionInspector({
    store: { privateMcpConnection: registry.privateConnection, commitMcpInspection: registry.commitInspection },
    allowLoopback: true, resolveCredential: runtime.resolve,
  })
  const connection = await inspector()(id, 'owner', 0, { credentialReference: reference })
  assert.equal(connection.tools[0].name, 'inspect')
  assert.equal(connection.execution, 'approval-required')
  assert.deepEqual(connection.executableTools, ['inspect'])
  assert.deepEqual(calls, ['server/discover', 'tools/list'])
  assert.doesNotMatch(JSON.stringify(connection), /integration-outbound-bearer|127\.0\.0\.1|MCP_DESKTOP/)
  const serialized = JSON.stringify(registry.snapshot())
  assert.equal(serialized.includes(secret), false)
  assert.equal((await readFile(filePath, 'utf8')).includes(secret), false)

  registry = createMcpConnectionRegistry()
  registry.rehydrate(JSON.parse(serialized))
  vault = await openMcpCredentialVault({ filePath, ...encryption })
  await vault.reconcile(registry.credentialBindings())
  assert.equal(await runtime.resolve(reference, binding), secret)
  await assert.rejects(runtime.resolve(reference, { ...binding, tenantId: 'foreign' }), /unavailable/)
  await inspector()(id, 'owner', 1, { credentialReference: reference })
  assert.deepEqual(calls, ['server/discover', 'tools/list', 'server/discover', 'tools/list'])
  registry.disconnect(id, 'owner', 2)
  await vault.reconcile(registry.credentialBindings())
  await assert.rejects(runtime.resolve(reference, binding), /unavailable/)
  assert.deepEqual(registry.credentialBindings(), [])
  assert.equal(registry.view(id, 'owner')!.status, 'disconnected')
})
