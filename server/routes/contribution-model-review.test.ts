/** Owner-selected model review crosses the Messages endpoint only after the
 * Project wall, exact registry bindings, version pin, and owner budget pass. */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'
import { contributionReviewId } from '../contributionReviewIdentity.ts'

const OWNER = 'tenant-contribution-model-review-owner'
const CONTRIBUTOR = 'tenant-contribution-model-review-contributor'
const BYSTANDER = 'tenant-contribution-model-review-bystander'
const PROVIDER_KEY_NAME = 'PROVIDER_CONTRIBUTION_REVIEW_TEST'
let sequence = 0
const originalEnv = new Map<string, string | undefined>()
for (const name of ['DEPLOYMENT_PROFILE', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', PROVIDER_KEY_NAME]) {
  originalEnv.set(name, process.env[name])
}

after(() => {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

type Reply = { summary: string; findings: Array<{ entryId: string; body: string }> }

async function endpoint(reply: Reply, options: { pause?: boolean; networkFailure?: boolean; responseText?: string; usage?: unknown } = {}) {
  const requests: Array<{ body: any; headers: Record<string, string | string[] | undefined>; method?: string; url?: string; release?: () => void }> = []
  let notified!: () => void
  const requested = new Promise<void>((resolve) => { notified = resolve })
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const record: { body: any; headers: Record<string, string | string[] | undefined>; method?: string; url?: string; release?: () => void } = {
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      headers: req.headers,
      method: req.method,
      url: req.url,
    }
    requests.push(record)
    notified()
    if (options.pause) {
      await new Promise<void>((resolve) => { record.release = resolve })
    }
    if (options.networkFailure) {
      res.destroy()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    const payload: Record<string, unknown> = {
      id: `msg-contribution-review-${requests.length}`,
      type: 'message',
      role: 'assistant',
      model: 'review-fixture-model',
      content: [{ type: 'text', text: options.responseText ?? JSON.stringify(reply) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 137, output_tokens: 29 },
    }
    if (Object.hasOwn(options, 'usage')) payload.usage = options.usage
    res.end(JSON.stringify(payload))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseURL = `http://127.0.0.1:${address.port}`
  const close = async () => {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  return { baseURL, requests, requested, close }
}

async function projectAndContribution(label: string, ownerTenant = OWNER) {
  const projectId = `p-contribution-model-review-${++sequence}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: label, projectDescription: '' }, ownerTenant)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: label, shared: true }, ownerTenant)
  const opened = await call('POST', `/projects/${projectId}/contributions`, { title: label }, { 'x-tenant-id': CONTRIBUTOR })
  assert.equal(opened.status, 200)
  const contributionId = opened.json.id as string
  const changeset = await call('POST', `/projects/${projectId}/contributions/${contributionId}/changeset`, {
    entries: [{ kind: 'note', target: `target-${sequence}`, before: 'old', after: `current reviewed text ${sequence}` }],
  }, { 'x-tenant-id': CONTRIBUTOR })
  assert.equal(changeset.status, 200)
    assert.equal(changeset.json.changeset.at(-1).version, 1)
  return { projectId, contributionId, changeset: changeset.json.changeset.at(-1) }
}

async function reviewerRegistry(
  label: string,
  tenant = OWNER,
  baseURL?: string,
  budgets?: {
    providerPlan?: { windows: Array<{ label: string; ceiling: number }> }
    agentBudget?: { windows: Array<{ label: string; ceiling: number }> }
  },
) {
  const provider = store.createProvider({
    label: `${label} provider`,
    modelFamily: 'claude',
    effortLevels: ['Low'],
    models: [{ id: 'review-fixture-model', label: 'Review fixture model' }],
    ...(budgets?.providerPlan ? { plan: budgets.providerPlan } : {}),
  }, baseURL ? {
    baseURL,
    apiKeyEnv: PROVIDER_KEY_NAME,
    model: 'review-fixture-model',
    capabilities: { toolUse: true },
  } : {}, tenant)
  const agent = store.createAgent({
    label: `${label} reviewer`,
    providerId: provider.id,
    systemPrompt: 'Find only concrete defects in the frozen changeset.',
    tools: [],
    instructions: 'Return the requested JSON review.',
    ...(budgets?.agentBudget ? { budget: budgets.agentBudget } : {}),
  } as any, tenant)
  const publicProvider = store.listProviders(tenant).find((candidate) => candidate.id === provider.id)!
  const publicAgent = store.listAgents(tenant).find((candidate) => candidate.id === agent.id)!
  return {
    provider,
    agent,
    binding: {
      agentId: agent.id,
      agentRevision: publicAgent.revision ?? 0,
      providerId: provider.id,
      providerRevision: publicProvider.definitionRevision ?? 0,
      connectionRevision: publicProvider.connectionRevision ?? 0,
    },
  }
}

function reviewHeaders(tenantId: string, key: string) {
  return { 'x-tenant-id': tenantId, 'idempotency-key': key }
}

function reviewPath(projectId: string, contributionId: string) {
  return `/projects/${projectId}/contributions/${contributionId}/review`
}

test('owner model review sends only the frozen latest changeset, validates the verdict, and meters the owner', async () => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[PROVIDER_KEY_NAME] = 'local-fixture-key'
  const scenario = await projectAndContribution('owner-controlled review')
  const latest = await call('POST', `/projects/${scenario.projectId}/contributions/${scenario.contributionId}/changeset`, {
    entries: [{ kind: 'note', target: `latest-target-${sequence}`, before: 'earlier text', after: 'frozen latest changeset text' }],
  }, { 'x-tenant-id': CONTRIBUTOR })
  assert.equal(latest.status, 200)
  assert.equal(latest.json.changeset.at(-1).version, 2)
  const latestEntryId = latest.json.changeset.at(-1).entries[0].id as string
  const server = await endpoint({
    summary: 'The proposed note is internally consistent.',
    findings: [{ entryId: latestEntryId, body: 'The note omits the rollback owner.' }],
  })
  const { binding } = await reviewerRegistry('owner-controlled', OWNER, server.baseURL)
  const reports: Array<[number, number, string | undefined]> = []
  const recordUsage = store.recordUsage
  store.recordUsage = (inputTokens, outputTokens, tenantId) => {
    reports.push([inputTokens, outputTokens, tenantId])
    return recordUsage.call(store, inputTokens, outputTokens, tenantId)
  }
  const key = `model-review-${sequence}`
  const expectedId = contributionReviewId(OWNER, scenario.projectId, scenario.contributionId, key)
  try {
    const response = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), {
      expectedVersion: 2,
      reviewer: binding,
    }, reviewHeaders(OWNER, key))
    assert.equal(response.status, 200)
    assert.equal(server.requests.length, 1, 'one owner-approved model request is sent')
    assert.equal(server.requests[0].method, 'POST')
    assert.equal(server.requests[0].url, '/v1/messages', 'review uses the standard Messages endpoint')
    assert.equal(server.requests[0].headers['x-api-key'], 'local-fixture-key')
    assert.deepEqual(server.requests[0].body.tools, undefined, 'review is a no-tools endpoint request')
    assert.ok(!server.requests[0].body.tools || server.requests[0].body.tools.length === 0, 'review is a no-tools endpoint request')
    const sentMessages = JSON.stringify(server.requests[0].body.messages)
    assert.match(sentMessages, /frozen latest changeset text/)
    assert.doesNotMatch(sentMessages, /current reviewed text 1/, 'the reviewer receives only the frozen latest changeset')
    const review = response.json.reviews.at(-1)
    assert.equal(review.id, expectedId)
    assert.equal(review.version, 2)
    assert.equal(review.reviewer, 'owner-controlled reviewer')
    assert.equal(review.provider, 'owner-controlled provider')
    assert.equal(review.model, 'review-fixture-model')
    assert.equal(review.status, 'findings')
    assert.equal(review.summary, 'The proposed note is internally consistent.')
    assert.deepEqual(review.findings, [{ entryId: latestEntryId, body: 'The note omits the rollback owner.' }])
    assert.equal(typeof review.startedAt, 'number')
    assert.equal(typeof review.finishedAt, 'number')
    assert.deepEqual(reports, [[137, 29, OWNER]], 'model usage is charged exactly to the Project owner')
    assert.notEqual(response.json.reviewedVersion, 1, 'a model review is not an automatic landing approval')
  } finally {
    store.recordUsage = recordUsage
    await server.close()
  }
})

test('owner model review marks a clean verdict passed but does not land the contribution', async () => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[PROVIDER_KEY_NAME] = 'local-fixture-key'
  const scenario = await projectAndContribution('clean owner review')
  const server = await endpoint({ summary: 'No actionable defect found.', findings: [] })
  const { binding } = await reviewerRegistry('clean-review', OWNER, server.baseURL)
  try {
    const response = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), {
      expectedVersion: 1, reviewer: binding,
    }, reviewHeaders(OWNER, `clean-model-review-${sequence}`))
    assert.equal(response.status, 200)
    assert.equal(response.json.reviews.at(-1).status, 'passed')
    assert.equal(response.json.status, 'open', 'model verdict never auto-lands')
    const landed = await callFresh('GET', `/projects/${scenario.projectId}/contributions`, undefined, { 'x-tenant-id': OWNER })
    assert.equal(landed.json.find((row: any) => row.id === scenario.contributionId).status, 'open')
  } finally {
    await server.close()
  }
})

test('a real release-profile pass enables contributor landing only after the separate manual land act', async () => {
  process.env.DEPLOYMENT_PROFILE = 'desktop'
  process.env[PROVIDER_KEY_NAME] = 'local-fixture-key'
  const scenario = await projectAndContribution('release-profile owner review')
  const server = await endpoint({ summary: 'No actionable defect found.', findings: [] })
  const { binding } = await reviewerRegistry('release-review', OWNER, server.baseURL)
  try {
    const reviewed = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), {
      expectedVersion: 1, reviewer: binding,
    }, reviewHeaders(OWNER, `release-model-review-${sequence}`))
    assert.equal(reviewed.status, 200)
    assert.equal(reviewed.json.reviews.at(-1).status, 'passed')
    assert.equal(reviewed.json.status, 'open', 'even a real model pass never lands automatically')
    const landed = await callFresh('POST', `/projects/${scenario.projectId}/contributions/${scenario.contributionId}/land`, undefined, { 'x-tenant-id': CONTRIBUTOR })
    assert.equal(landed.status, 200, 'the current real pass satisfies Tier 1 for the contributor')
    assert.equal(landed.json.status, 'landed')
    assert.equal(landed.json.landedBy, CONTRIBUTOR)
  } finally {
    await server.close()
  }
})

test('network uncertainty is durable and same-key retry never redispatches', async () => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[PROVIDER_KEY_NAME] = 'local-fixture-key'
  const scenario = await projectAndContribution('uncertain owner review')
  const server = await endpoint({ summary: 'unused', findings: [] }, { networkFailure: true })
  const { binding } = await reviewerRegistry('uncertain-review', OWNER, server.baseURL)
  const body = { expectedVersion: 1, reviewer: binding }
  const headers = reviewHeaders(OWNER, `uncertain-model-review-${sequence}`)
  try {
    const first = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), body, headers)
    assert.equal(first.status, 200)
    assert.equal(first.json.reviews.at(-1).status, 'uncertain')
    assert.equal(server.requests.length, 1)
    const replay = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), body, headers)
    assert.equal(replay.status, 200)
    assert.equal(replay.json.reviews.at(-1).status, 'uncertain')
    assert.deepEqual(replay.json.reviews, first.json.reviews)
    assert.equal(server.requests.length, 1, 'uncertain outcome is never retried under the same key')
  } finally {
    await server.close()
  }
})

test('a malformed completed result is failed but still meters settled usage and replays without another request', async () => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[PROVIDER_KEY_NAME] = 'local-fixture-key'
  const scenario = await projectAndContribution('malformed owner review')
  const server = await endpoint({ summary: 'unused', findings: [] }, {
    responseText: '{"summary":"Looks fine","findings":[],"extra":true}',
  })
  const { binding } = await reviewerRegistry('malformed-review', OWNER, server.baseURL)
  const reports: Array<[number, number, string | undefined]> = []
  const recordUsage = store.recordUsage
  store.recordUsage = (inputTokens, outputTokens, tenantId) => {
    reports.push([inputTokens, outputTokens, tenantId])
    return recordUsage.call(store, inputTokens, outputTokens, tenantId)
  }
  const body = { expectedVersion: 1, reviewer: binding }
  const headers = reviewHeaders(OWNER, `malformed-model-review-${sequence}`)
  try {
    const first = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), body, headers)
    assert.equal(first.status, 200)
    assert.equal(first.json.reviews.at(-1).status, 'failed')
    assert.equal(first.json.reviews.at(-1).summary, undefined)
    assert.deepEqual(reports, [[137, 29, OWNER]], 'completed usage is charged before strict result rejection')
    const replay = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), body, headers)
    assert.equal(replay.json.reviews.at(-1).status, 'failed')
    assert.deepEqual(replay.json.reviews, first.json.reviews)
    assert.equal(server.requests.length, 1)
    assert.deepEqual(reports, [[137, 29, OWNER]], 'replay does not meter again')
  } finally {
    store.recordUsage = recordUsage
    await server.close()
  }
})

test('missing or malformed settled usage is durable uncertainty, never a free pass or replay', async (t) => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[PROVIDER_KEY_NAME] = 'local-fixture-key'
  const cases: Array<[string, unknown]> = [
    ['missing usage', undefined],
    ['missing input count', { output_tokens: 29 }],
    ['missing output count', { input_tokens: 137 }],
    ['negative count', { input_tokens: 137, output_tokens: -1 }],
    ['unsafe combined total', { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 }],
  ]
  for (const [label, usage] of cases) {
    await t.test(label, async () => {
      const scenario = await projectAndContribution(`invalid usage ${label}`)
      const server = await endpoint({ summary: 'No actionable defect found.', findings: [] }, { usage })
      const { binding } = await reviewerRegistry(`invalid-usage-${sequence}`, OWNER, server.baseURL)
      const reports: Array<[number, number, string | undefined]> = []
      const recordUsage = store.recordUsage
      store.recordUsage = (inputTokens, outputTokens, tenantId) => {
        reports.push([inputTokens, outputTokens, tenantId])
        return recordUsage.call(store, inputTokens, outputTokens, tenantId)
      }
      const body = { expectedVersion: 1, reviewer: binding }
      const headers = reviewHeaders(OWNER, `invalid-usage-model-review-${sequence}`)
      try {
        const first = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), body, headers)
        assert.equal(first.status, 200)
        assert.equal(first.json.reviews.at(-1).status, 'uncertain')
        assert.equal(first.json.reviewedVersion, undefined, 'invalid accounting can never authorize a pass')
        assert.deepEqual(reports, [], 'invalid accounting is never converted to zero or charged')
        const replay = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), body, headers)
        assert.equal(replay.json.reviews.at(-1).status, 'uncertain')
        assert.deepEqual(replay.json.reviews, first.json.reviews)
        assert.equal(server.requests.length, 1, 'uncertain settled response is not redispatched')
        assert.deepEqual(reports, [])
      } finally {
        store.recordUsage = recordUsage
        await server.close()
      }
    })
  }
})

test('usage persistence failure leaves the durable attempt pending and does not acknowledge a verdict', async () => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[PROVIDER_KEY_NAME] = 'local-fixture-key'
  const scenario = await projectAndContribution('usage persistence failure')
  const server = await endpoint({ summary: 'No actionable defect found.', findings: [] })
  const { binding } = await reviewerRegistry(`usage-persistence-${sequence}`, OWNER, server.baseURL)
  const body = { expectedVersion: 1, reviewer: binding }
  const headers = reviewHeaders(OWNER, `usage-persistence-model-review-${sequence}`)
  const recordUsage = store.recordUsage
  store.recordUsage = () => { throw new Error('usage persistence unavailable') }
  try {
    const failed = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), body, headers)
    assert.equal(failed.status, 500, 'accounting failure is a storage wall, not a terminal verdict')
    assert.equal(server.requests.length, 1)
  } finally {
    store.recordUsage = recordUsage
  }
  try {
    const replay = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), body, headers)
    assert.equal(replay.status, 200)
    assert.equal(replay.json.reviews.at(-1).status, 'pending', 'storage failure cannot persist a terminal acknowledgement')
    assert.equal(replay.json.reviews.at(-1).summary, undefined)
    assert.equal(server.requests.length, 1, 'pending intent is not replayed after accounting storage failed')
  } finally {
    await server.close()
  }
})

test('a version change while the endpoint is responding makes the result stale', async () => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[PROVIDER_KEY_NAME] = 'local-fixture-key'
  const scenario = await projectAndContribution('stale owner review')
  const server = await endpoint({ summary: 'Review completed after source changed.', findings: [] }, { pause: true })
  const { binding } = await reviewerRegistry('stale-review', OWNER, server.baseURL)
  const key = `pending-model-review-${sequence}`
  const body = { expectedVersion: 1, reviewer: binding }
  try {
    const pending = callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), body, reviewHeaders(OWNER, key))
    let requestTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        server.requested,
        new Promise<never>((_, reject) => { requestTimeout = setTimeout(() => reject(new Error('review endpoint was not called')), 1500) }),
      ])
    } finally {
      if (requestTimeout) clearTimeout(requestTimeout)
    }
    const pendingReplay = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), body, reviewHeaders(OWNER, key))
    assert.equal(pendingReplay.status, 200)
    assert.equal(pendingReplay.json.reviews.at(-1).status, 'pending', 'exact retry attaches to the retained pending attempt')
    const concurrentKey = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), body,
      reviewHeaders(OWNER, `${key}-different`))
    assert.equal(concurrentKey.status, 409, 'another logical key cannot start a concurrent model review')
    assert.equal(server.requests.length, 1)
    const newer = await callFresh('POST', `/projects/${scenario.projectId}/contributions/${scenario.contributionId}/changeset`, {
      entries: [{ kind: 'note', target: `new-target-${sequence}`, after: 'a newer source version' }],
    }, { 'x-tenant-id': CONTRIBUTOR })
    assert.equal(newer.status, 200)
    server.requests[0].release?.()
    const response = await pending
    assert.equal(response.status, 200, 'the attempt remains visible as a completed stale review')
    assert.equal(response.json.reviews.at(-1).status, 'stale')
    assert.equal(response.json.reviewedVersion, undefined)
    assert.equal(response.json.status, 'open')
  } finally {
    server.requests[0]?.release?.()
    await server.close()
  }
})

test('keyed model review replays the durable attempt without a second request; changed binding conflicts', async () => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[PROVIDER_KEY_NAME] = 'local-fixture-key'
  const scenario = await projectAndContribution('durable model review')
  const server = await endpoint({ summary: 'The change is ready for owner landing.', findings: [] })
  const registry = await reviewerRegistry('durable-review', OWNER, server.baseURL)
  const secondRegistry = await reviewerRegistry('other-review', OWNER, server.baseURL)
  const key = `durable-model-review-${sequence}`
  const body = { expectedVersion: 1, reviewer: registry.binding }
  const headers = reviewHeaders(OWNER, key)
  try {
    const first = await call('POST', reviewPath(scenario.projectId, scenario.contributionId), body, headers)
    assert.equal(first.status, 200)
    const replay = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), body, headers)
    assert.equal(replay.status, 200)
    assert.equal(server.requests.length, 1, 'durable replay never resends after losing process-local route cache')
    assert.deepEqual(replay.json.reviews, first.json.reviews)
    const changed = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), {
      ...body, reviewer: secondRegistry.binding,
    }, headers)
    assert.equal(changed.status, 409, 'same key cannot be rebound to a different reviewer')
    assert.equal(server.requests.length, 1)
  } finally {
    await server.close()
  }
})

test('visibility, ownership, registry scope, provider readiness, key, and budget gates precede provider traffic', async () => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[PROVIDER_KEY_NAME] = 'local-fixture-key'
  const scenario = await projectAndContribution('review gates')
  const server = await endpoint({ summary: 'No findings.', findings: [] })
  const ownerRegistry = await reviewerRegistry('gate-owner', OWNER, server.baseURL)
  const privateRegistry = await reviewerRegistry('gate-private', BYSTANDER, server.baseURL)
  const unconfiguredRegistry = await reviewerRegistry('gate-unconfigured', OWNER)
  const path = reviewPath(scenario.projectId, scenario.contributionId)
  try {
    const nonOwner = await callFresh('POST', path, { expectedVersion: 1, reviewer: ownerRegistry.binding }, reviewHeaders(BYSTANDER, 'non-owner-model-review'))
    assert.equal(nonOwner.status, 403)

    const privateAgent = await callFresh('POST', path, { expectedVersion: 1, reviewer: privateRegistry.binding }, reviewHeaders(OWNER, 'private-reviewer-model-review'))
    assert.ok([404, 409].includes(privateAgent.status), 'another tenant cannot nominate its private Agent')

    const missingKey = await callFresh('POST', path, { expectedVersion: 1, reviewer: ownerRegistry.binding }, { 'x-tenant-id': OWNER })
    assert.equal(missingKey.status, 400)

    const unconfigured = await callFresh('POST', path, { expectedVersion: 1, reviewer: {
      ...unconfiguredRegistry.binding,
      providerId: unconfiguredRegistry.provider.id,
    } }, reviewHeaders(OWNER, 'unconfigured-model-review'))
    assert.equal(unconfigured.status, 409, 'fixture/default provider cannot be used for explicit model judgment')
    assert.equal(unconfigured.json.error.code, 'capability_unavailable')

    const mismatchedRevision = await callFresh('POST', path, { expectedVersion: 1, reviewer: {
      ...ownerRegistry.binding, connectionRevision: ownerRegistry.binding.connectionRevision + 1,
    } }, reviewHeaders(OWNER, 'stale-binding-model-review'))
    assert.equal(mismatchedRevision.status, 409)

    const privateProjectId = `p-contribution-model-review-private-${sequence}`
    store.applyRelationOp({ kind: 'create-project', projectId: privateProjectId, projectName: 'Private review wall', projectDescription: '' }, OWNER)
    const privateContribution = await callFresh('POST', `/projects/${privateProjectId}/contributions`, { title: 'hidden' }, { 'x-tenant-id': OWNER })
    const hidden = await callFresh('POST', reviewPath(privateProjectId, privateContribution.json.id), { expectedVersion: 1, reviewer: ownerRegistry.binding }, reviewHeaders(BYSTANDER, 'hidden-model-review'))
    assert.equal(hidden.status, 404, 'the Project wall precedes owner/runtime diagnostics')

    const before = server.requests.length
    store.recordUsage(1_000_000_000, 0, OWNER)
    const exhausted = await callFresh('POST', path, { expectedVersion: 1, reviewer: ownerRegistry.binding }, reviewHeaders(OWNER, 'budget-model-review'))
    assert.equal(exhausted.status, 429)
    assert.equal(server.requests.length, before, 'an exhausted owner budget must not contact the provider')
  } finally {
    await server.close()
  }
})

test('owner model review honors an exhausted provider plan when Agent budget inherits or partially overrides it', async (t) => {
  delete process.env.DEPLOYMENT_PROFILE
  process.env[PROVIDER_KEY_NAME] = 'local-fixture-key'
  const partialAgentBudget = { windows: [{ label: 'Weekly · all models', ceiling: 1_000 }] }
  for (const [label, agentBudget] of [['omitted', undefined], ['partial', partialAgentBudget]] as const) {
    await t.test(label, async () => {
      const tenant = `tenant-provider-budget-review-${label}`
      const scenario = await projectAndContribution(`provider budget ${label}`, tenant)
      const server = await endpoint({ summary: 'This should not be reached.', findings: [] })
      const { binding } = await reviewerRegistry(`provider-budget-${label}`, tenant, server.baseURL, {
        providerPlan: { windows: [
          { label: '5-hour limit', ceiling: 1 },
          { label: 'Weekly · all models', ceiling: 2_000 },
        ] },
        ...(agentBudget ? { agentBudget } : {}),
      })
      store.recordUsage(1, 0, tenant)
      try {
        const exhausted = await callFresh('POST', reviewPath(scenario.projectId, scenario.contributionId), {
          expectedVersion: 1, reviewer: binding,
        }, reviewHeaders(tenant, `provider-plan-review-${label}`))
        assert.equal(exhausted.status, 429, 'the inherited or partial Agent budget cannot widen the provider plan')
        assert.equal(exhausted.json.error.code, 'limit_exceeded')
        assert.equal(server.requests.length, 0, 'provider plan exhaustion must block outbound model traffic')
      } finally {
        await server.close()
      }
    })
  }
})
