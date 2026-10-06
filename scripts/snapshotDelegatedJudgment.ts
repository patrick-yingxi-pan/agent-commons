/** Exercise real durable judgment admission using an explicit loopback fixture. */
import { createServer } from 'node:http'
import { store } from '../server/store/index.ts'
import { delegatedJudgmentId } from '../server/delegatedJudgmentIdentity.ts'

export async function buildDelegatedJudgment(projectId: string): Promise<void> {
  const fixture = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain the bounded, tool-free request */ }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: 'snapshot-judgment-fixture', type: 'message', role: 'assistant', model: 'snapshot-only-model',
      content: [{ type: 'text', text: JSON.stringify({ decision: 'approve', summary: 'Snapshot fixture judgment, not a real policy assessment.' }) }],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    }))
  })
  await new Promise<void>((resolve, reject) => { fixture.once('error', reject); fixture.listen(0, '127.0.0.1', resolve) })
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Snapshot judgment fixture did not bind.')
  const owner = store.defaultTenantId()
  let providerId: string | undefined
  let agentId: string | undefined
  try {
    const provider = store.createProvider({ label: 'Snapshot judgment fixture', modelFamily: 'claude', effortLevels: ['Low'] },
      { baseURL: `http://127.0.0.1:${address.port}`, model: 'snapshot-only-model', capabilities: { toolUse: false } }, owner)
    providerId = provider.id
    const agent = store.createAgent({ label: 'Snapshot fixture delegate', providerId, tools: [], systemPrompt: '', instructions: '' }, owner)
    agentId = agent.id
    const contribution = store.openContribution(projectId, { title: 'Playground delegated judgment — draft advice' }, owner, undefined)
    if (typeof contribution !== 'object') throw new Error('Snapshot judgment Contribution did not open.')
    store.crystallizeContribution(projectId, contribution.id, { entries: [{ kind: 'note', target: 'Snapshot note', after: 'Frozen content.' }] }, owner, undefined)
    const delegation = store.createDelegation(projectId, {
      agentId, actKind: 'land', mode: 'draft', escalation: ['effectful'], policy: 'Recommend only internally consistent notes.',
    }, owner)
    if (typeof delegation !== 'object') throw new Error('Snapshot judgment Delegation did not open.')
    const result = await store.runDelegatedModelJudgment(projectId, contribution.id, delegation.id, owner, undefined,
      delegatedJudgmentId(owner, projectId, contribution.id, delegation.id, 'snapshot-model-judgment'), {
        expectedDelegationRevision: 0, expectedChangesetVersion: 1, expectedEnvelopeVersion: null,
        reviewer: { agentId, agentRevision: agent.revision ?? 0, providerId,
          providerRevision: provider.definitionRevision ?? 0, connectionRevision: provider.connectionRevision ?? 0 },
      })
    if (typeof result !== 'object' || result.judgments?.at(-1)?.status !== 'draft') throw new Error('Snapshot judgment fixture did not commit.')
  } finally {
    fixture.closeAllConnections()
    await new Promise<void>((resolve) => fixture.close(() => resolve()))
    // Keep history, not a dead fixture endpoint or the authority attached to it.
    if (agentId) store.deleteAgent(agentId)
    if (providerId) store.deleteProvider(providerId)
  }
}
