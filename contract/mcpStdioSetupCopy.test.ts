import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MCP_STDIO_TOOL_APPROVAL_COPY } from './mcpStdioSetupCopy.mjs'

test('local MCP setup names separately approved conversation and Contribution calls, not Routine authority', () => {
  assert.equal(MCP_STDIO_TOOL_APPROVAL_COPY,
    'Conversation and Contribution tool calls each require their own explicit approval. Local servers are not available to Routines.')
})
