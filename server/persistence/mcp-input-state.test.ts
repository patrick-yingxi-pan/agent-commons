import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hasCorePersistedShape, SLICE_KIND, STORE_VERSION, type PersistedState } from './format.ts'
import { JsonFileBackend } from './json.ts'
import { SqliteBackend } from './sqlite.ts'
import { mcpInputBindingHash } from '../mcpInputState.ts'
import type { ToolActivity } from '../../contract/entities.ts'

const decisionId = 'tool-activity-decision-0123456789abcdef01234567'
const pending: ToolActivity = {
  id: 'activity-1', tool: 'mcp__example__write', connector: 'Example', connectorId: 'mcp-connection-example',
  kind: 'action', status: 'awaiting-input', decisionId,
  mcp: { connectionRevision: 2, toolName: 'write', schemaHash: 'a'.repeat(64) },
  input: { document: 'draft' }, summary: 'Waiting for form input',
}
const form = {
  resultType: 'input_required',
  inputRequests: {
    profile: {
      method: 'elicitation/create',
      params: { mode: 'form', message: 'Choose a value', requestedSchema: { type: 'object', properties: { name: { type: 'string' } } } },
    },
  },
}
const state = (mcpInputFlows?: unknown, activity: ToolActivity = pending): PersistedState => ({
  version: STORE_VERSION,
  sessions: [{ id: 'session-1', tenantId: 'tenant-1', title: 'test', caps: ['chat'], preview: '', messages: [{ id: 'message-1', toolActivities: [activity] }] }],
  bindings: [], workspaces: [], schedules: [],
  recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
  graph: {
    sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {}, artifactSource: {},
    scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {}, extraArtifacts: [], extraProjects: [], standingApprovals: {},
  },
  seq: { session: 1, message: 0, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
  ...(mcpInputFlows === undefined ? {} : { mcpInputFlows }),
} as PersistedState)

const validFlow = {
  sessionId: 'session-1', activityId: pending.id, decisionId, tenantId: 'tenant-1', ownerUserId: 'user-1',
  bindingHash: mcpInputBindingHash(pending), createdAt: 1_000, expiresAt: 3_601_000, round: 1, pending: form, receipts: [],
}

test('private MCP input flow is an additive array slice in the canonical persistence manifest', () => {
  assert.equal(SLICE_KIND.mcpInputFlows, 'array')
})

test('snapshot admission requires a matching private flow for awaiting-input activities', () => {
  assert.equal(hasCorePersistedShape(state()), false)
  assert.equal(hasCorePersistedShape(state([validFlow])), true)
  assert.equal(hasCorePersistedShape(state([{ ...validFlow, payload: { answer: 'never persist' } }])), false)
  assert.equal(hasCorePersistedShape(state([{ ...validFlow, bindingHash: 'b'.repeat(64) }])), false)

  const reserved: ToolActivity = { ...pending, status: 'running' }
  const reservedFlow = { ...validFlow, round: 1, pending: undefined,
    receipts: [{ responseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', payloadHash: 'c'.repeat(64), round: 1, action: 'respond' }] }
  assert.equal(hasCorePersistedShape(state([reservedFlow], reserved)), true)
})

test('private MCP input flows survive JSON and SQLite backend reloads', () => {
  const snapshot = state([validFlow])
  const db = new SqliteBackend(':memory:')
  db.save(snapshot)
  assert.deepEqual(db.load()?.mcpInputFlows, [validFlow])
  db.close()

  const directory = mkdtempSync(join(tmpdir(), 'mcp-input-flow-json-'))
  const previousDataFile = process.env.DATA_FILE
  try {
    process.env.DATA_FILE = join(directory, 'store.json')
    mkdirSync(directory, { recursive: true })
    const json = new JsonFileBackend()
    json.save(snapshot)
    assert.deepEqual(json.load()?.mcpInputFlows, [validFlow])
  } finally {
    if (previousDataFile === undefined) delete process.env.DATA_FILE
    else process.env.DATA_FILE = previousDataFile
    rmSync(directory, { recursive: true, force: true })
  }
})
