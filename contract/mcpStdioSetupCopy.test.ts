import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MCP_STDIO_TOOL_APPROVAL_COPY } from './mcpStdioSetupCopy.mjs'

test('local MCP setup says setup is not Routine consent and avoids claiming local Routines are unavailable', () => {
  assert.equal(MCP_STDIO_TOOL_APPROVAL_COPY,
    'Conversation and Contribution tool calls each require their own explicit approval. Local setup is not Routine consent; local Routines require their own separate approval.')
  assert.doesNotMatch(MCP_STDIO_TOOL_APPROVAL_COPY, /not available to Routines/)
})
