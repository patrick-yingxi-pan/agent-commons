/** Release profiles must not turn the store's declared contribution mocks into
 * successful review verdicts, delegated decisions, or external effect records. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from './index.ts'
import { contributionReviewId } from '../contributionReviewIdentity.ts'
import { delegatedJudgmentId } from '../delegatedJudgmentIdentity.ts'
import { contributionEffectExecutionId } from '../contributionEffectExecutionIdentity.ts'
import { contributionRuntimeMode } from '../contributionRuntime.ts'

const OWNER = 'tenant-contribution-runtime-owner'
const CONTRIBUTOR = 'tenant-contribution-runtime-contributor'
let serial = 0

function project() {
  const id = `p-contribution-runtime-${++serial}`
  store.applyRelationOp({ kind: 'create-project', projectId: id, projectName: id, projectDescription: '' }, OWNER)
  store.applyRelationOp({ kind: 'share-project', projectId: id, projectName: id, shared: true }, OWNER)
  return id
}

function contribution(projectId: string, tenantId = CONTRIBUTOR) {
  const opened = store.openContribution(projectId, { title: `Contribution ${serial}` }, tenantId, undefined)
  assert.equal(typeof opened, 'object')
  return opened.id
}

function setProfile(profile: 'desktop' | 'web' | undefined): () => void {
  const prior = process.env.DEPLOYMENT_PROFILE
  if (profile === undefined) delete process.env.DEPLOYMENT_PROFILE
  else process.env.DEPLOYMENT_PROFILE = profile
  return () => {
    if (prior === undefined) delete process.env.DEPLOYMENT_PROFILE
    else process.env.DEPLOYMENT_PROFILE = prior
  }
}

test('any nonempty deployment profile disables contribution fixtures', () => {
  assert.equal(contributionRuntimeMode({}), 'fixture')
  assert.equal(contributionRuntimeMode({ DEPLOYMENT_PROFILE: '' }), 'fixture')
  assert.equal(contributionRuntimeMode({ DEPLOYMENT_PROFILE: 'desktop' }), 'unconfigured')
  assert.equal(contributionRuntimeMode({ DEPLOYMENT_PROFILE: 'web' }), 'unconfigured')
  assert.equal(contributionRuntimeMode({ DEPLOYMENT_PROFILE: 'future-profile' }), 'unconfigured')
})

for (const profile of ['desktop', 'web'] as const) {
  test(`${profile} store refuses mock review, delegated judgment, and effect execution without mutation`, () => {
    const projectId = project()
    const reviewCid = contribution(projectId)
    assert.notEqual(store.crystallizeContribution(projectId, reviewCid, {
      entries: [{ kind: 'note', target: 'release-review', after: 'current text' }],
    }, CONTRIBUTOR, undefined), 'invalid')
    const reviewKey = contributionReviewId(CONTRIBUTOR, projectId, reviewCid, `review-${profile}`)
    assert.equal(typeof store.reviewContribution(projectId, reviewCid, CONTRIBUTOR, undefined, {
      logicalId: reviewKey,
      expectedVersion: 1,
    }), 'object', 'fixture runtime can establish a receipt for the replay check')
    const freshReviewCid = contribution(projectId)
    store.crystallizeContribution(projectId, freshReviewCid, {
      entries: [{ kind: 'note', target: 'new-release-review', after: 'unreviewed text' }],
    }, CONTRIBUTOR, undefined)

    const delegate = store.createAgent({
      ...store.getAgent(),
      label: `Runtime test delegate ${profile}`,
    }, OWNER)
    const delegation = store.createDelegation(projectId, {
      agentId: delegate.id,
      actKind: 'approve-envelope',
      policy: 'Approve the reviewed envelope.',
      mode: 'decide',
    }, OWNER)
    assert.equal(typeof delegation, 'object')
    const delegatedCid = contribution(projectId)
    const proposed = store.proposeEnvelope(projectId, delegatedCid, {
      lines: [{ type: 'connector.read', target: `release:${profile}`, harness: 'dry-run' }],
    }, CONTRIBUTOR, undefined)
    assert.equal(typeof proposed, 'object')
    const delegationKey = delegatedJudgmentId(OWNER, projectId, delegatedCid, delegation.id, `ask-${profile}`)
    assert.equal(typeof store.runDelegation(projectId, delegatedCid, delegation.id, OWNER, undefined, {
      logicalId: delegationKey,
    }), 'object', 'fixture runtime can establish a delegated decision receipt')
    const freshDelegatedCid = contribution(projectId)
    const freshDelegatedProposal = store.proposeEnvelope(projectId, freshDelegatedCid, {
      lines: [{ type: 'connector.read', target: `fresh:${profile}`, harness: 'dry-run' }],
    }, CONTRIBUTOR, undefined)
    assert.equal(typeof freshDelegatedProposal, 'object')

    const effectCid = contribution(projectId)
    const effectProposal = store.proposeEnvelope(projectId, effectCid, {
      lines: [{ type: 'connector.write', target: `release:${profile}`, harness: 'draft-escrow' }],
    }, CONTRIBUTOR, undefined)
    assert.equal(typeof effectProposal, 'object')
    const approved = store.approveEnvelope(projectId, effectCid, OWNER, undefined)
    assert.equal(typeof approved, 'object', 'a human owner can still approve an envelope')
    const line = approved.envelope.lines[0]
    const effectKey = contributionEffectExecutionId(CONTRIBUTOR, projectId, effectCid, `effect-${profile}`)
    assert.equal(typeof store.runEnvelopeEffect(projectId, effectCid, line.id, CONTRIBUTOR, undefined, {
      logicalId: effectKey,
    }), 'object', 'fixture runtime can establish an effect receipt for replay')
    const freshEffectCid = contribution(projectId)
    const freshEffectProposal = store.proposeEnvelope(projectId, freshEffectCid, {
      lines: [{ type: 'connector.write', target: `fresh:${profile}`, harness: 'draft-escrow' }],
    }, CONTRIBUTOR, undefined)
    assert.equal(typeof freshEffectProposal, 'object')

    const restore = setProfile(profile)
    let off: (() => void) | undefined
    try {
      const freshEffectApproved = store.approveEnvelope(projectId, freshEffectCid, OWNER, undefined)
      assert.equal(typeof freshEffectApproved, 'object', 'release posture keeps a direct human approval available')
      const before = store.listContributions(projectId, OWNER)
      const events: string[] = []
      off = store.subscribe((event) => {
        if (event.type === 'contribution.changed' && event.projectId === projectId) events.push(event.type)
      })

      // A stored mock receipt is not a release verdict, and a fresh valid target
      // is equally unavailable until a real reviewer is configured.
      assert.equal(store.reviewContribution(projectId, reviewCid, CONTRIBUTOR, undefined, {
        logicalId: reviewKey,
        expectedVersion: 1,
      }), 'unconfigured')
      assert.equal(store.reviewContribution(projectId, freshReviewCid, CONTRIBUTOR, undefined, {
        logicalId: contributionReviewId(CONTRIBUTOR, projectId, freshReviewCid, `fresh-review-${profile}`),
        expectedVersion: 1,
      }), 'unconfigured')
      // Both replay and fresh decide-mode calls must refuse before approval.
      assert.equal(store.runDelegation(projectId, delegatedCid, delegation.id, OWNER, undefined, {
        logicalId: delegationKey,
      }), 'unconfigured')
      assert.equal(store.runDelegation(projectId, freshDelegatedCid, delegation.id, OWNER, undefined), 'unconfigured')
      // Existing effect receipts and fresh approved lines both fail closed.
      assert.equal(store.runEnvelopeEffect(projectId, effectCid, line.id, CONTRIBUTOR, undefined, {
        logicalId: effectKey,
      }), 'unconfigured')
      const freshLine = freshEffectApproved.envelope.lines[0]
      assert.equal(store.runEnvelopeEffect(projectId, freshEffectCid, freshLine.id, CONTRIBUTOR, undefined), 'unconfigured')
      assert.deepEqual(store.listContributions(projectId, OWNER), before, 'no verdict, spend, or lifecycle state changes')
      assert.deepEqual(events, [], 'a refused mock action publishes no contribution invalidation')

      // Owner authority remains the human escape hatch, including Tier 2 work.
      const landed = store.landContribution(projectId, effectCid, OWNER, undefined)
      assert.equal(typeof landed, 'object')
      assert.equal(landed.status, 'landed')
    } finally {
      restore()
      off?.()
    }
  })
}

test('release profiles ignore fixture review evidence for Tier-1 self-landing but retain its timeline', () => {
  for (const profile of ['desktop', 'web'] as const) {
    const projectId = project()
    const cid = contribution(projectId)
    const crystallized = store.crystallizeContribution(projectId, cid, {
      entries: [{ kind: 'note', target: `legacy-review-${profile}`, after: 'reviewed in development' }],
    }, CONTRIBUTOR, undefined)
    assert.equal(typeof crystallized, 'object')
    const reviewed = store.reviewContribution(projectId, cid, CONTRIBUTOR, undefined, { expectedVersion: 1 })
    assert.equal(typeof reviewed, 'object', 'development fixture review establishes legacy mock evidence')
    assert.equal(reviewed.reviewedVersion, 1)
    assert.ok(reviewed.events.some((event) => event.kind === 'review-passed'))

    const restore = setProfile(profile)
    try {
      const projected = store.listContributions(projectId, CONTRIBUTOR).find((row) => row.id === cid)
      assert.ok(projected)
      assert.equal(projected.reviewedVersion, undefined, 'mock reviewer state is omitted from release projection')
      assert.ok(projected.events.some((event) => event.kind === 'review-passed'), 'historical timeline remains readable')
      assert.equal(projected.tier.level, 1)
      assert.ok(store.attentionLedger(projectId, CONTRIBUTOR).asks.some((ask) =>
        ask.contributionId === cid && ask.function === 'error-catching' && !ask.label.includes('self-lands')),
      'attention projection must not promise a self-land from mock review evidence')
      assert.equal(store.landContribution(projectId, cid, CONTRIBUTOR, undefined), 'needs-review')
      const ownerLand = store.landContribution(projectId, cid, OWNER, undefined)
      assert.equal(typeof ownerLand, 'object', 'the owner can still land through the human authority path')
    } finally {
      restore()
    }
  }
})
