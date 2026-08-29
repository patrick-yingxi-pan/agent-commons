import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SocialEntityRef, SocialProposal } from '../../contract/index.ts'
import {
  createProposalVerdictMutationController,
  IDLE_PROPOSAL_VERDICT_MUTATION,
  type ProposalVerdictIntent,
  type ProposalVerdictMutationStatus,
} from './proposalVerdictMutationsCore.ts'

const subject: SocialEntityRef = { kind: 'project', id: 'p-verdict' }
const proposal = (id: string, state: SocialProposal['state'] = 'offered', stale = false): SocialProposal => ({
  id,
  subject,
  delta: { kind: 'suggestion', text: id },
  state,
  offeredBy: 'Grace Hopper',
  offeredAt: 1,
  discussionId: `d-${id}`,
  ...(stale ? { stale: true } : {}),
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function harness() {
  const calls: Array<{ intent: ProposalVerdictIntent; key: string; result: ReturnType<typeof deferred<SocialProposal>> }> = []
  const reconciles: Array<ReturnType<typeof deferred<SocialProposal[]>>> = []
  let status: ProposalVerdictMutationStatus = IDLE_PROPOSAL_VERDICT_MUTATION
  let key = 0
  const controller = createProposalVerdictMutationController({
    mutate: (intent, idempotencyKey) => {
      const result = deferred<SocialProposal>()
      calls.push({ intent, key: idempotencyKey, result })
      return result.promise
    },
    reconcile: () => {
      const result = deferred<SocialProposal[]>()
      reconciles.push(result)
      return result.promise
    },
    describeFailure: (_error, intent, row) => ({
      message: intent.verdict === 'land' && row?.stale ? 'outdated' : 'uncertain',
      retryable: row?.stale !== true,
    }),
    setStatus: (next) => { status = next },
    mintIdempotencyKey: () => `key-${(key += 1)}`,
  })
  return { controller, calls, reconciles, status: () => status }
}

test('proposal verdicts serialize and duplicate clicks join one logical request', async () => {
  const h = harness()
  const first = h.controller.enqueue({ proposalId: 'p1', subject, verdict: 'land' })
  const duplicate = h.controller.enqueue({ proposalId: 'p1', subject, verdict: 'land' })
  const opposite = h.controller.enqueue({ proposalId: 'p1', subject, verdict: 'decline' })
  const second = h.controller.enqueue({ proposalId: 'p2', subject, verdict: 'decline' })
  assert.equal(h.calls.length, 1, 'later intent cannot pass the active verdict')
  assert.deepEqual(h.status().pendingProposalIds, ['p1', 'p2'])
  assert.equal(await opposite, 'discarded', 'an opposite verdict cannot masquerade as the pending outcome')

  h.calls[0]!.result.resolve(proposal('p1', 'landed'))
  assert.equal(await first, 'applied')
  assert.equal(await duplicate, 'applied', 'the duplicate observes the same outcome')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(h.calls.length, 2)
  h.calls[1]!.result.resolve(proposal('p2', 'declined'))
  assert.equal(await second, 'applied')
})

test('a lost acknowledgement reconciles terminal server truth as applied', async () => {
  const h = harness()
  const outcome = h.controller.enqueue({ proposalId: 'p1', subject, verdict: 'land' })
  h.calls[0]!.result.reject(new Error('connection lost'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(h.reconciles.length, 1)
  h.reconciles[0]!.resolve([proposal('p1', 'landed')])
  assert.equal(await outcome, 'applied')
  assert.equal(h.status().error, null, 'authoritative completion needs no fake recovery warning')
})

test('Retry reuses the logical key; an outdated proposal instead holds until Dismiss reconciles', async () => {
  const h = harness()
  const outcome = h.controller.enqueue({ proposalId: 'p1', subject, verdict: 'land' })
  h.calls[0]!.result.reject(new Error('offline'))
  await new Promise((resolve) => setImmediate(resolve))
  h.reconciles[0]!.resolve([proposal('p1')])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(h.status().retryable, true)
  const later = h.controller.enqueue({ proposalId: 'p2', subject, verdict: 'decline' })
  assert.equal(h.calls.length, 1, 'a failed head keeps later verdicts behind it')
  assert.deepEqual(h.status().pendingProposalIds, ['p1', 'p2'])
  h.controller.retry()
  assert.equal(h.calls[1]!.key, h.calls[0]!.key, 'Retry retransmits one logical verdict')

  h.calls[1]!.result.reject(new Error('conflict'))
  await new Promise((resolve) => setImmediate(resolve))
  h.reconciles[1]!.resolve([proposal('p1', 'offered', true)])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(h.status().error, 'outdated')
  assert.equal(h.status().retryable, false)

  h.controller.discard()
  assert.equal(h.status().busy, true, 'Dismiss reconciles uncertain truth before release')
  h.reconciles[2]!.resolve([proposal('p1', 'offered', true)])
  assert.equal(await outcome, 'discarded')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(h.calls.length, 3, 'the next verdict starts only after Dismiss finishes reconciliation')
  h.calls[2]!.result.resolve(proposal('p2', 'declined'))
  assert.equal(await later, 'applied')
})

test('account clearing drops late acknowledgements and settles queued callers', async () => {
  const h = harness()
  const first = h.controller.enqueue({ proposalId: 'p1', subject, verdict: 'land' })
  const second = h.controller.enqueue({ proposalId: 'p2', subject, verdict: 'decline' })
  h.controller.clearAll()
  assert.equal(await first, 'discarded')
  assert.equal(await second, 'discarded')
  h.calls[0]!.result.resolve(proposal('p1', 'landed'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(h.status(), IDLE_PROPOSAL_VERDICT_MUTATION)
})
