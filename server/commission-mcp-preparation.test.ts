import assert from 'node:assert/strict'
import test from 'node:test'
import type { Agent } from '../contract/workers.ts'
import type { Project } from '../contract/cowork.ts'
import type { CommissionMcpWork } from '../contract/commissionMcp.ts'
import type { McpDiscoveredTool } from '../contract/mcpConnections.ts'
import type { McpToolPermission } from '../contract/mcpExecution.ts'
import { generateCommissionMcpArguments } from './generate.ts'
import {
  CommissionMcpPreparationInputError, CommissionMcpPreparationOutputError,
  CommissionMcpPreparationTransportError, CommissionMcpPreparationUsageError,
  prepareCommissionMcpInput, snapshotPreparedCommissionMcpInput,
} from './commissionMcpPreparation.ts'
import { mcpToolSchemaHash } from './mcpToolAdmission.ts'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

const schemaTool: McpDiscoveredTool = { name: 'search', description: 'Search one reviewed source.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' }, scope: { type: 'string' } }, required: ['query', 'scope'], additionalProperties: false } }
const permission: McpToolPermission = { connectionId: 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', connectionRevision: 7,
  toolName: 'search', schemaHash: mcpToolSchemaHash(schemaTool), fixedArguments: { scope: 'project' } }
const work: CommissionMcpWork = { itemId: 'item-a', subGoal: 'Search the reviewed source', type: 'mcp.mutate', target: 'search', note: 'Focus on recent findings.' }
const agent: Agent = { id: 'agent-a', label: 'Private label', systemPrompt: 'Be careful with claims.', instructions: 'Prefer concise results.', tools: [] }
const project: Project = { id: 'project-private-id', name: 'Reviewed project', description: 'A small research workspace.', instructions: 'Use primary sources.',
  updatedAt: 1, scheduled: [], contexts: [{ kind: 'doc', label: 'secret context', meta: 'Do not include me.' }], sessionIds: [] }

function prepared() { return prepareCommissionMcpInput({ agent, project, work, tool: schemaTool, permission }) }

function message(content: unknown[], overrides: Record<string, unknown> = {}) {
  return { id: 'msg_test', type: 'message', role: 'assistant', model: 'test-model', content,
    stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 23, output_tokens: 11 }, ...overrides }
}

async function withPeer(handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (baseURL: string) => Promise<void>): Promise<void> {
  const peer: Server = createServer(handler)
  await new Promise<void>(resolve => peer.listen(0, '127.0.0.1', resolve))
  const address = peer.address()
  assert.ok(address && typeof address === 'object')
  try { await run(`http://127.0.0.1:${address.port}`) }
  finally {
    peer.closeAllConnections?.()
    await new Promise<void>(resolve => peer.close(() => resolve()))
  }
}

function respond(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

test('preparation returns detached allowlisted model input and a conservative local allowance', () => {
  const inputAgent = structuredClone(agent)
  const inputProject = structuredClone(project)
  const inputWork = structuredClone(work)
  const inputTool = structuredClone(schemaTool)
  const inputPermission = structuredClone(permission)
  const result = prepareCommissionMcpInput({ agent: inputAgent, project: inputProject, work: inputWork, tool: inputTool, permission: inputPermission })
  assert.match(result.system, /untrusted source data/)
  assert.match(result.system, /Be careful with claims/)
  assert.match(result.system, /Prefer concise results/)
  assert.match(result.prompt, /Reviewed project/)
  assert.match(result.prompt, /Use primary sources/)
  assert.match(result.prompt, /Search the reviewed source/)
  assert.match(result.prompt, /additionalProperties/)
  assert.match(result.prompt, /"scope":"project"/)
  assert.doesNotMatch(result.prompt, /secret context|Do not include me|project-private-id|Private label/)
  assert.equal(result.toolPermission.connectionId, permission.connectionId)
  const totalBytes = new TextEncoder().encode(result.system).byteLength + new TextEncoder().encode(result.prompt).byteLength
  assert.ok(totalBytes <= 64 * 1024)
  assert.equal(result.allowanceTokens, totalBytes + 4_096 + 1_024)
  assert.ok(result.allowanceTokens > totalBytes, 'allowance is documented local input/output/framing budget, not provider usage')

  inputAgent.instructions = 'mutated after prep'
  inputProject.description = 'mutated after prep'
  inputTool.inputSchema.properties!.query = { type: 'number' }
  inputPermission.fixedArguments.scope = 'mutated'
  assert.match(result.system, /Prefer concise results/)
  assert.match(result.prompt, /A small research workspace/)
  assert.match(result.prompt, /"type":"string"/)
  assert.match(result.prompt, /"scope":"project"/)
})

test('preparation refuses oversized inputs and accessor-backed selected values without truncating', () => {
  assert.throws(() => prepareCommissionMcpInput({ agent: { ...agent, instructions: 'x'.repeat(70_000) }, project, work, tool: schemaTool, permission }),
    CommissionMcpPreparationInputError)
  const hostileAgent = { ...agent }
  Object.defineProperty(hostileAgent, 'instructions', { enumerable: true, get() { throw new Error('getter ran') } })
  assert.throws(() => prepareCommissionMcpInput({ agent: hostileAgent, project, work, tool: schemaTool, permission }),
    CommissionMcpPreparationInputError)
  assert.throws(() => prepareCommissionMcpInput({ agent, project, work: { ...work, target: 'other' }, tool: schemaTool, permission }),
    CommissionMcpPreparationInputError)
  assert.throws(() => prepareCommissionMcpInput({ agent, project, work, tool: { ...schemaTool, inputSchema: { type: 'object', properties: { changed: { type: 'boolean' } } } }, permission }),
    CommissionMcpPreparationInputError)
})

test('legacy Project definitions without optional instructions use an empty value', () => {
  const { instructions: _instructions, ...legacyProject } = project
  const result = prepareCommissionMcpInput({ agent, project: legacyProject, work, tool: schemaTool, permission })
  assert.match(result.prompt, /"instructions":""/)
})

test('one Messages call sends no tools and binds exact model arguments to selected permission', async () => {
  const requests: Array<Record<string, unknown>> = []
  await withPeer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      respond(response, message([{ type: 'text', text: '{"toolName":"search","arguments":{"query":"otters","scope":"project"}}' }]))
    })
  }, async baseURL => {
    const result = await generateCommissionMcpArguments(prepared(), { baseURL, model: 'test-model' }, undefined, () => {})
    assert.deepEqual(result, { connectionId: permission.connectionId, connectionRevision: 7, toolName: 'search',
      schemaHash: permission.schemaHash, arguments: { query: 'otters', scope: 'project' } })
  })
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.max_tokens, 4_096)
  assert.equal(requests[0]?.model, 'test-model')
  assert.equal(Object.hasOwn(requests[0]!, 'tools'), false)
  assert.deepEqual(requests[0]?.messages, [{ role: 'user', content: prepared().prompt }])
  assert.equal(requests[0]?.system, prepared().system)
})

test('settled usage is recorded once before rejecting malformed output', async () => {
  await withPeer((_request, response) => respond(response, message([{ type: 'text', text: '{bad json' }])), async baseURL => {
    const usages: Array<{ inputTokens: number; outputTokens: number }> = []
    await assert.rejects(generateCommissionMcpArguments(prepared(), { baseURL, model: 'test-model' }, undefined,
      usage => usages.push(usage)), CommissionMcpPreparationOutputError)
    assert.deepEqual(usages, [{ inputTokens: 23, outputTokens: 11 }])
  })
})

test('changed fixed arguments, changed tool target, truncation, and missing usage refuse the result', async t => {
  const cases = [
    { label: 'changed fixed arguments', response: message([{ type: 'text', text: '{"toolName":"search","arguments":{"query":"otters","scope":"other"}}' }]),
      error: CommissionMcpPreparationOutputError },
    { label: 'changed tool target', response: message([{ type: 'text', text: '{"toolName":"other","arguments":{"query":"otters","scope":"project"}}' }]),
      error: CommissionMcpPreparationOutputError },
    { label: 'truncated response', response: message([{ type: 'text', text: '{"toolName":"search","arguments":{}' }], { stop_reason: 'max_tokens' }),
      error: CommissionMcpPreparationOutputError },
    { label: 'missing usage', response: message([{ type: 'text', text: '{"toolName":"search","arguments":{"query":"otters","scope":"project"}}' }], { usage: { output_tokens: 1 } }),
      error: CommissionMcpPreparationUsageError },
  ]
  for (const entry of cases) await t.test(entry.label, async () => {
    const usages: Array<{ inputTokens: number; outputTokens: number }> = []
    await withPeer((_request, response) => respond(response, entry.response), async baseURL => {
      await assert.rejects(generateCommissionMcpArguments(prepared(), { baseURL, model: 'test-model' }, undefined,
        usage => usages.push(usage)), entry.error)
    })
    assert.equal(usages.length, entry.error === CommissionMcpPreparationUsageError ? 0 : 1)
  })
})

test('transport failure is attempted once with SDK retries disabled', async () => {
  let requests = 0
  await withPeer((_request, response) => { requests += 1; respond(response, { error: { message: 'temporary refusal', type: 'api_error' } }, 500) },
    async baseURL => {
      await assert.rejects(generateCommissionMcpArguments(prepared(), { baseURL, model: 'test-model' }), CommissionMcpPreparationTransportError)
    })
  assert.equal(requests, 1)
})

test('malformed or oversized prepared values refuse before any request is sent', async () => {
  let requests = 0
  await withPeer((_request, response) => { requests += 1; respond(response, message([])) }, async baseURL => {
    const malformed = prepared()
    malformed.prompt += ' altered'
    await assert.rejects(generateCommissionMcpArguments(malformed, { baseURL, model: 'test-model' }), CommissionMcpPreparationInputError)
    const oversized = prepared()
    oversized.prompt = 'x'.repeat(70_000)
    await assert.rejects(generateCommissionMcpArguments(oversized, { baseURL, model: 'test-model' }), CommissionMcpPreparationInputError)
    const wrongAllowance = prepared()
    wrongAllowance.allowanceTokens += 1
    assert.throws(() => snapshotPreparedCommissionMcpInput(wrongAllowance), CommissionMcpPreparationInputError)
  })
  assert.equal(requests, 0)
})

test('prepared binding is frozen before the request and caller mutation during response wait cannot change it', async () => {
  let received!: () => void
  const requestReceived = new Promise<void>(resolve => { received = resolve })
  const input = prepared()
  await withPeer((request, response) => {
    request.resume()
    request.on('end', () => {
      received()
      setTimeout(() => respond(response, message([{ type: 'text',
        text: '{"toolName":"search","arguments":{"query":"otters","scope":"project"}}' }])), 25)
    })
  }, async baseURL => {
    const generation = generateCommissionMcpArguments(input, { baseURL, model: 'test-model' })
    await requestReceived
    input.toolPermission.toolName = 'sibling'
    input.prompt = 'mutated after request start'
    const result = await generation
    assert.equal(result.toolName, 'search')
    assert.equal(result.arguments.scope, 'project')
  })
})
