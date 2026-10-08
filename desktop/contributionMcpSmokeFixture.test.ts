import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MCP_MODERN_VERSION } from '../server/mcpProtocol.ts'
import { createMcpDiscovery } from '../server/mcpDiscovery.ts'
import { createMcpToolSession } from '../server/mcpToolSession.ts'
import { McpToolCallError } from '../server/mcpToolCall.ts'
import { validateMcpSchema } from '../server/mcpSchema.ts'
import {
  CONTRIBUTION_MCP_SMOKE_TOOL,
  startContributionMcpSmokePeer,
} from './contributionMcpSmokeFixture.mjs'

const smokeBearer = 'isolated-contribution-mcp-fixture-bearer'
const invocation = {
  tool: {
    name: CONTRIBUTION_MCP_SMOKE_TOOL.name,
    inputSchema: CONTRIBUTION_MCP_SMOKE_TOOL.inputSchema,
  },
  arguments: { text: 'Exact approved contribution text.' },
}
const loopback = { scope: 'loopback' as const, bearerToken: smokeBearer }

async function waitForCall(peer: Awaited<ReturnType<typeof startContributionMcpSmokePeer>>) {
  for (let attempt = 0; peer.calls.length === 0 && attempt < 200; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(peer.calls.length, 1, 'the fixture must receive exactly one tool call')
}

test('serves the admitted modern catalog and captures one exact authenticated call', async () => {
  const peer = await startContributionMcpSmokePeer({ bearer: smokeBearer })
  try {
    const catalog = await createMcpDiscovery()(peer.url, loopback)
    assert.equal(catalog.protocolVersion, MCP_MODERN_VERSION)
    assert.deepEqual(catalog.tools, [CONTRIBUTION_MCP_SMOKE_TOOL])

    const completed = await createMcpToolSession()(peer.url, invocation, loopback)
    assert.equal(completed.protocolVersion, MCP_MODERN_VERSION)
    assert.equal(completed.cleanup, 'not-needed')
    assert.deepEqual(peer.calls, [{ name: 'write_record', arguments: { text: 'Exact approved contribution text.' } }])
    assert.deepEqual(peer.authorizations.map(({ method, value }) => ({ method, value })), [
      { method: 'server/discover', value: `Bearer ${smokeBearer}` },
      { method: 'tools/list', value: `Bearer ${smokeBearer}` },
      { method: 'server/discover', value: `Bearer ${smokeBearer}` },
      { method: 'tools/call', value: `Bearer ${smokeBearer}` },
    ])
    assert.deepEqual(completed.result.structuredContent, { accepted: true, recordId: 'smoke-record-1' })
    assert.deepEqual(completed.result.content, [{ type: 'text', text: 'The isolated fixture accepted one record.' }])
    assert.ok(completed.result.content.every(item => item.text.length <= 256), 'fixture result text stays bounded')
    assert.deepEqual(await validateMcpSchema(CONTRIBUTION_MCP_SMOKE_TOOL.outputSchema, {
      value: completed.result.structuredContent,
    }), { ok: true }, 'structured fixture result matches its admitted output schema')

    const initialized = await fetch(peer.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${smokeBearer}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'fixture-initialize', method: 'initialize', params: {} }),
    })
    assert.equal(initialized.status, 200)
    assert.equal((await initialized.json()).result.protocolVersion, MCP_MODERN_VERSION)
    const notification = await fetch(peer.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${smokeBearer}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    })
    assert.equal(notification.status, 202)
  } finally {
    await peer.close()
  }
})

test('rejects a wrong bearer before recording a tool effect', async () => {
  const peer = await startContributionMcpSmokePeer({ bearer: smokeBearer })
  try {
    const response = await fetch(peer.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-fixture-bearer' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'unauthorized-call', method: 'tools/call', params: {
        name: 'write_record', arguments: { text: 'must not be recorded' },
      } }),
    })
    assert.equal(response.status, 401)
    assert.deepEqual(peer.calls, [])
    assert.deepEqual(peer.authorizations, [{ method: 'tools/call', value: 'Bearer wrong-fixture-bearer' }])
  } finally {
    await peer.close()
  }
})

test('held tool calls are cancelled by the client and peer close drains sockets', { timeout: 5_000 }, async () => {
  const peer = await startContributionMcpSmokePeer({ bearer: smokeBearer })
  peer.setMode('hold')
  const controller = new AbortController()
  try {
    const pending = createMcpToolSession()(peer.url, invocation, { ...loopback, signal: controller.signal })
    await waitForCall(peer)
    controller.abort()
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof McpToolCallError)
      assert.equal(error.code, 'cancelled')
      assert.equal(error.mayHaveExecuted, true)
      return true
    })
    assert.deepEqual(peer.calls, [{ name: 'write_record', arguments: { text: 'Exact approved contribution text.' } }])
    await peer.close()
  } finally {
    await peer.close()
  }
})
