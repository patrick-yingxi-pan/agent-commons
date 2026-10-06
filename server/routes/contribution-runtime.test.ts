import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'

const OWNER = 'tenant-contribution-runtime-owner'
const CONTRIBUTOR = 'tenant-contribution-runtime-contributor'
const REVIEWER = 'tenant-contribution-runtime-reviewer'
let sequence = 0

async function sharedProject(label: string) {
  const projectId = `p-contribution-runtime-${++sequence}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: label, projectDescription: '' }, OWNER)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: label, shared: true }, OWNER)
  return projectId
}

async function contribution(projectId: string, title: string, tenant = CONTRIBUTOR) {
  const opened = await call('POST', `/projects/${projectId}/contributions`, { title }, { 'x-tenant-id': tenant })
  assert.equal(opened.status, 200)
  return opened.json
}

function withProfile(profile: string | undefined) {
  const previous = process.env.DEPLOYMENT_PROFILE
  if (profile === undefined) delete process.env.DEPLOYMENT_PROFILE
  else process.env.DEPLOYMENT_PROFILE = profile
  return () => {
    if (previous === undefined) delete process.env.DEPLOYMENT_PROFILE
    else process.env.DEPLOYMENT_PROFILE = previous
  }
}

async function visibleContribution(projectId: string, tenantId = CONTRIBUTOR) {
  const response = await call('GET', `/projects/${projectId}/contributions`, undefined, { 'x-tenant-id': tenantId })
  assert.equal(response.status, 200)
  return response.json
}

async function prepareScenario(profile: string) {
  // Keep fixture setup independent from the release gate and give each profile
  // its own rows so the first profile's manual landing cannot affect the second.
  delete process.env.DEPLOYMENT_PROFILE
  const projectId = await sharedProject(`Runtime boundary ${profile}`)
  const reviewed = await contribution(projectId, 'Needs review')
  const reviewPath = `/projects/${projectId}/contributions/${reviewed.id}`
  const changeset = await call('POST', `${reviewPath}/changeset`, {
    entries: [{ kind: 'note', target: 'runtime-review', after: 'review me' }],
  }, { 'x-tenant-id': CONTRIBUTOR })
  assert.equal(changeset.status, 200)

  const agent = store.createAgent({ label: `Runtime delegate ${profile}`, providerId: 'provider-claude', tools: [] } as any, OWNER)
  const draftDelegation = await call('POST', `/projects/${projectId}/delegations`, {
    agentId: agent.id, actKind: 'land', policy: 'Draft the landing decision.', mode: 'draft', escalation: [],
  }, { 'x-tenant-id': OWNER })
  assert.equal(draftDelegation.status, 200)
  const draftContribution = await contribution(projectId, 'Delegated draft')

  const decisionDelegation = await call('POST', `/projects/${projectId}/delegations`, {
    agentId: agent.id, actKind: 'approve-envelope', policy: 'Approve monotonic plans.', mode: 'decide',
  }, { 'x-tenant-id': OWNER })
  assert.equal(decisionDelegation.status, 200)
  const delegatedContribution = await contribution(projectId, 'Delegated decision')
  const proposed = await call('POST', `/projects/${projectId}/contributions/${delegatedContribution.id}/envelope`, {
    lines: [{ type: 'connector.read', target: `linear:runtime-${profile}` }],
  }, { 'x-tenant-id': CONTRIBUTOR })
  assert.equal(proposed.status, 200)

  const effectContribution = await contribution(projectId, 'Envelope effect')
  const effectProposal = await call('POST', `/projects/${projectId}/contributions/${effectContribution.id}/envelope`, {
    lines: [{ type: 'connector.read', target: `linear:runtime-effect-${profile}` }],
  }, { 'x-tenant-id': CONTRIBUTOR })
  assert.equal(effectProposal.status, 200)
  const manualApproval = await call('POST', `/projects/${projectId}/contributions/${effectContribution.id}/envelope/approve`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(manualApproval.status, 200, 'human envelope approval stays available in every runtime')

  const manualApprovalContribution = await contribution(projectId, 'Release human approval')
  const manualProposal = await call('POST', `/projects/${projectId}/contributions/${manualApprovalContribution.id}/envelope`, {
    lines: [{ type: 'connector.read', target: `linear:manual-${profile}` }],
  }, { 'x-tenant-id': CONTRIBUTOR })
  assert.equal(manualProposal.status, 200)

  const privateProjectId = `p-contribution-runtime-private-${sequence}-${profile}`
  store.applyRelationOp({ kind: 'create-project', projectId: privateProjectId, projectName: 'Private runtime wall', projectDescription: '' }, OWNER)
  const privateContribution = await contribution(privateProjectId, 'Private contribution', OWNER)
  return {
    projectId,
    reviewPath,
    draftContribution,
    draftDelegation,
    delegatedContribution,
    decisionDelegation,
    effectContribution,
    manualApprovalContribution,
    lineId: manualApproval.json.envelope.lines[0].id as string,
    privateProjectId,
    privateContribution,
  }
}

test('contribution runtime fails closed in desktop and web profiles before minting mock review or effect receipts', async () => {
  const restoreProfile = withProfile(undefined)
  const previousConnectorRuntime = process.env.CONNECTOR_RUNTIME
  const previousInlineModel = process.env.MODEL_INLINE
  // Adjacent development switches must not turn release contribution seams back
  // into canned success paths.
  process.env.CONNECTOR_RUNTIME = 'fixture'
  process.env.MODEL_INLINE = '1'

  try {
    for (const profile of ['desktop', 'web']) {
      const scenario = await prepareScenario(profile)
      const {
        projectId, reviewPath, draftContribution, draftDelegation, delegatedContribution,
        decisionDelegation, effectContribution, lineId, privateProjectId, privateContribution,
        manualApprovalContribution,
      } = scenario
      process.env.DEPLOYMENT_PROFILE = profile
      const unsubscribe = store.subscribe((event: any) => {
        if (event?.type === 'contribution.changed' && event.projectId === projectId) events.push(event)
      })
      const events: unknown[] = []
      try {
        const attempts = [
          {
            label: 'review', path: `${reviewPath}/review`, tenant: REVIEWER,
            key: `runtime-review-${profile}`, body: undefined, fixtureEvent: 'review-passed',
          },
          {
            label: 'delegated draft', path: `/projects/${projectId}/contributions/${draftContribution.id}/delegated/${draftDelegation.json.id}`,
            tenant: REVIEWER, key: `runtime-draft-${profile}`, body: undefined, fixtureEvent: 'delegated-draft',
          },
          {
            label: 'delegated decision', path: `/projects/${projectId}/contributions/${delegatedContribution.id}/delegated/${decisionDelegation.json.id}`,
            tenant: REVIEWER, key: `runtime-decision-${profile}`, body: undefined, fixtureEvent: 'delegated-decision',
          },
          {
            label: 'envelope effect', path: `/projects/${projectId}/contributions/${effectContribution.id}/effects`,
            tenant: CONTRIBUTOR, key: `runtime-effect-${profile}`, body: { lineId }, fixtureEvent: 'effect-executed',
          },
        ]

        for (const attempt of attempts) {
          const before = await visibleContribution(projectId)
          const response = await callFresh('POST', attempt.path, attempt.body, {
            'x-tenant-id': attempt.tenant,
            'idempotency-key': attempt.key,
          })
          assert.equal(response.status, 409, `${profile} ${attempt.label} must be unavailable`)
          assert.equal(response.json.error.code, 'capability_unavailable', `${profile} ${attempt.label} error code`)
          assert.match(response.json.error.message, /configured|available|runtime/i, `${profile} ${attempt.label} explains the unavailable runtime`)
          assert.deepEqual(await visibleContribution(projectId), before, `${profile} ${attempt.label} leaves the complete public snapshot unchanged`)
          assert.equal(events.length, 0, `${profile} ${attempt.label} emits no contribution event`)
        }

        const humanApproval = await callFresh('POST', `/projects/${projectId}/contributions/${manualApprovalContribution.id}/envelope/approve`, undefined, { 'x-tenant-id': OWNER })
        assert.equal(humanApproval.status, 200, `${profile} keeps manual envelope approval available`)
        assert.equal(humanApproval.json.envelope.status, 'approved')

        // The project wall remains the first boundary; a hidden project and a
        // ghost project do not reveal the runtime state.
        const hidden = await callFresh('POST', `/projects/${privateProjectId}/contributions/${privateContribution.id}/review`, undefined, { 'x-tenant-id': REVIEWER })
        assert.equal(hidden.status, 404, `${profile} private project stays existence-hidden`)
        const ghost = await callFresh('POST', `/projects/no-such-runtime-project/contributions/no-such-contribution/review`, undefined, { 'x-tenant-id': REVIEWER })
        assert.equal(ghost.status, 404, `${profile} absent project stays existence-hidden`)

        // Restore fixture mode with the exact release-rejected keys. A successful
        // first application proves the refusal created no durable receipt.
        delete process.env.DEPLOYMENT_PROFILE
        for (const attempt of attempts) {
          const response = await callFresh('POST', attempt.path, attempt.body, {
            'x-tenant-id': attempt.tenant,
            'idempotency-key': attempt.key,
          })
          assert.equal(response.status, 200, `fixture retry applies the refused ${attempt.label} once`)
          assert.equal(response.json.events.at(-1).kind, attempt.fixtureEvent, `fixture retry exercises the intended ${attempt.label} path`)
        }

        // A prior fixture review is not valid evidence for a contributor in a
        // release profile. Human owners still retain the authority to land.
        process.env.DEPLOYMENT_PROFILE = profile
        const contributorLanding = await callFresh('POST', `${reviewPath}/land`, undefined, { 'x-tenant-id': CONTRIBUTOR })
        assert.equal(contributorLanding.status, 409, `${profile} rejects a contributor relying on a fixture review`)
        assert.equal(contributorLanding.json.error.code, 'conflict')
        const ownerLanding = await callFresh('POST', `${reviewPath}/land`, undefined, { 'x-tenant-id': OWNER })
        assert.equal(ownerLanding.status, 200, `${profile} preserves the human owner landing path`)

        // Historical fixture receipts are not authority to replay canned
        // success from a release runtime. Every one is refused before it can
        // return the prior public row or create another effect.
        for (const attempt of attempts) {
          const beforeReplay = await visibleContribution(projectId)
          const replay = await callFresh('POST', attempt.path, attempt.body, {
            'x-tenant-id': attempt.tenant,
            'idempotency-key': attempt.key,
          })
          assert.equal(replay.status, 409, `${profile} does not replay fixture ${attempt.label} as a release success`)
          assert.equal(replay.json.error.code, 'capability_unavailable')
          assert.deepEqual(await visibleContribution(projectId), beforeReplay, `${profile} ${attempt.label} replay adds no effect`)
        }
      } finally {
        unsubscribe()
      }
    }
  } finally {
    restoreProfile()
    if (previousConnectorRuntime === undefined) delete process.env.CONNECTOR_RUNTIME
    else process.env.CONNECTOR_RUNTIME = previousConnectorRuntime
    if (previousInlineModel === undefined) delete process.env.MODEL_INLINE
    else process.env.MODEL_INLINE = previousInlineModel
  }
})
