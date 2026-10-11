import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { MCP_INPUT_MAX_FLOWS, hasMcpInputFlowCapacity } from './mcpInputState.ts'

const storeSource = readFileSync(new URL('./store/index.ts', import.meta.url), 'utf8')

test('private MCP flow admission shares a fixed persisted bound', () => {
  assert.equal(MCP_INPUT_MAX_FLOWS, 100_000)
  assert.equal(hasMcpInputFlowCapacity(99_999), true)
  assert.equal(hasMcpInputFlowCapacity(100_000), false)
  assert.equal(hasMcpInputFlowCapacity(99_998, 2), true)
  assert.equal(hasMcpInputFlowCapacity(99_999, 2), false)
  assert.equal(hasMcpInputFlowCapacity(100_001, 0), false)
})

test('flow creation and fork copies preflight before their state mutation batches', () => {
  const begin = storeSource.slice(storeSource.indexOf('  beginMcpToolActivityExecution('), storeSource.indexOf('  /** Settle the one durable external call.'))
  assert.ok(begin.includes('hasMcpInputFlowCapacity(mcpInputFlows.size)'), 'form-enabled execution must enforce the shared flow cap')
  assert.ok(begin.indexOf('hasMcpInputFlowCapacity') < begin.indexOf('return commitMutationBatch'), 'flow creation preflight must precede its mutation batch')
  assert.ok(begin.indexOf('hasMcpInputFlowCapacity') < begin.indexOf('mcpInputFlows.set('), 'flow creation preflight must precede insertion')

  const fork = storeSource.slice(storeSource.indexOf('  forkSession('), storeSource.indexOf('  createSession('))
  assert.ok(fork.includes('hasMcpInputFlowCapacity(mcpInputFlows.size'), 'fork must account for private flow copies against the shared cap')
  assert.ok(fork.indexOf('hasMcpInputFlowCapacity') < fork.indexOf('return commitMutationBatch'), 'fork capacity preflight must precede session mutation')
  assert.ok(fork.indexOf('hasMcpInputFlowCapacity') < fork.indexOf('mcpInputFlows.set('), 'fork capacity preflight must precede flow copies')
})
