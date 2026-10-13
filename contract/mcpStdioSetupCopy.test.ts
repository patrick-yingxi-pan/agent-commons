import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MCP_STDIO_TOOL_APPROVAL_COPY } from './mcpStdioSetupCopy.mjs'

test('local MCP setup separates per-call approval from each unattended workflow and grants none of them', () => {
  assert.equal(MCP_STDIO_TOOL_APPROVAL_COPY,
    'Conversation and Contribution tool calls each require their own explicit approval. Local setup does not approve unattended work; local Routines and Commissions each require their own separate approval.')
  assert.doesNotMatch(MCP_STDIO_TOOL_APPROVAL_COPY, /not available to (?:Routines|Commissions)/)
})
