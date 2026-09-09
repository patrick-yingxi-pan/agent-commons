import assert from 'node:assert/strict'
import test from 'node:test'
import type { Session, ToolActivity } from '../../contract/index.ts'
import { refreshAccount } from './account.ts'
import { reconcileToolActivityDecision, type ToolActivityDecisionIntent } from './toolActivityDecisionCommands.ts'
import { toolActivityDecisionId } from './toolActivityDecisionIdentity.ts'

const tenantId = 'tenant-tool-decision-reconcile'
const userId = 'user-tool-decision-reconcile'
const intent: ToolActivityDecisionIntent = {
  intentId: 'tool-decision-reconcile-intent', tenantId, sourceUserId: userId,
  sessionId: 'session-tool-decision-reconcile', activityId: 'archived-call', decision: 'confirm',
}
const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200, headers: { 'Content-Type': 'application/json', 'x-resolved-tenant': tenantId },
})

test('decision recovery finds only exact terminal receipts in the full Session archive', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; refreshAccount(null) })
  refreshAccount({ userId, tenantId })
  const key = 'archived-tool-decision-key'
  const decisionId = await toolActivityDecisionId(tenantId, intent.sessionId, intent.activityId, key)
  const activity = (status: ToolActivity['status'], receipt: string | undefined = decisionId): ToolActivity => ({
    id: intent.activityId, tool: 'mcp_external_hash', connector: 'Archived MCP',
    connectorId: 'mcp-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', kind: 'action', status,
    summary: String(status), ...(receipt ? { decisionId: receipt } : {}),
    mcp: { connectionRevision: 1, toolName: 'write', schemaHash: 'a'.repeat(64) },
  })
  const session = (archived: ToolActivity): Session => ({
    id: intent.sessionId, title: 'Archived receipt', preview: '', caps: [], messages: [],
    compactedMessages: [{ id: 'archived-message', role: 'assistant', content: 'Earlier proposal.', toolActivities: [archived] }],
  })

  globalThis.fetch = async () => jsonResponse(session(activity('done')))
  assert.equal((await reconcileToolActivityDecision(intent, key))?.decisionId, decisionId)
  const reusedId = session(activity('done'))
  reusedId.messages = [{
    id: 'later-message', role: 'assistant', content: 'A later ambiguous proposal.',
    toolActivities: [{ ...activity('proposed', undefined), input: { value: 'changed' } }],
  }]
  globalThis.fetch = async () => jsonResponse(reusedId)
  assert.equal((await reconcileToolActivityDecision(intent, key))?.decisionId, decisionId,
    'exact archived recovery is not shadowed by a later active row reusing the model-authored id')
  const malformedKind = session({ ...activity('done'), kind: 'read' })
  globalThis.fetch = async () => jsonResponse(malformedKind)
  assert.equal(await reconcileToolActivityDecision(intent, key), undefined,
    'an MCP marker cannot make a malformed non-action row an acknowledgement')
  for (const unresolved of [activity('proposed', undefined), activity('running')]) {
    globalThis.fetch = async () => jsonResponse(session(unresolved))
    assert.equal(await reconcileToolActivityDecision(intent, key), undefined,
      'archived nonterminal state is never acknowledged as a completed recovery')
  }
})
