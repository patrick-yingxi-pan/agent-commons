/** Snapshot-only Messages fixture. Never inherits ambient model credentials. */
import { createServer } from 'node:http'
import { store } from '../server/store/index.ts'
import { contributionReviewId } from '../server/contributionReviewIdentity.ts'

export async function buildContributionReview(projectId: string, contributionId: string): Promise<void> {
  const fixture = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain the bounded review body */ }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: 'snapshot-review-fixture', type: 'message', role: 'assistant', model: 'snapshot-only-model',
      content: [{ type: 'text', text: JSON.stringify({ summary: 'Snapshot fixture review, not a real quality assessment.', findings: [] }) }],
      stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    }))
  })
  await new Promise<void>((resolve, reject) => { fixture.once('error', reject); fixture.listen(0, '127.0.0.1', resolve) })
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Snapshot reviewer fixture did not bind.')
  const owner = store.defaultTenantId()
  let providerId: string | undefined
  let agentId: string | undefined
  try {
    const provider = store.createProvider({ label: 'Snapshot fixture provider', modelFamily: 'claude', effortLevels: ['Low'] },
      { baseURL: `http://127.0.0.1:${address.port}`, model: 'snapshot-only-model', capabilities: { toolUse: false } }, owner)
    providerId = provider.id
    const agent = store.createAgent({ label: 'Snapshot fixture reviewer', providerId, tools: [], systemPrompt: 'Review the supplied changeset.', instructions: '' }, owner)
    agentId = agent.id
    const result = await store.runContributionModelReview(projectId, contributionId, owner,
      contributionReviewId(owner, projectId, contributionId, 'snapshot-model-review'), 1, {
        agentId, agentRevision: agent.revision ?? 0, providerId,
        providerRevision: provider.definitionRevision ?? 0, connectionRevision: provider.connectionRevision ?? 0,
      })
    if (typeof result !== 'object' || result.reviews?.at(-1)?.status !== 'passed') throw new Error('Snapshot review fixture did not commit.')
  } finally {
    fixture.closeAllConnections()
    await new Promise<void>((resolve) => fixture.close(() => resolve()))
    // History survives reviewer removal; the playground must not retain a dead endpoint.
    if (agentId) store.deleteAgent(agentId)
    if (providerId) store.deleteProvider(providerId)
  }
}
