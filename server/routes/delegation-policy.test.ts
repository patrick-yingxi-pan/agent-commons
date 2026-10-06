import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call, callFresh } from '../testkit/http.ts'

const OWNER = 'tenant-delegation-policy-owner'
const CONTRIBUTOR = 'tenant-delegation-policy-contributor'
const REVIEWER = 'tenant-delegation-policy-reviewer'
const FOREIGN = 'tenant-delegation-policy-foreign'
let sequence = 0

async function setup(label: string) {
  const projectId = `p-delegation-policy-${++sequence}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: label, projectDescription: '' }, OWNER)
  store.applyRelationOp({ kind: 'share-project', projectId, projectName: label, shared: true }, OWNER)
  const agent = store.createAgent({ label: `Delegate ${sequence}`, providerId: 'provider-claude', tools: [] } as any, OWNER)
  const created = await call('POST', `/projects/${projectId}/delegations`, {
    agentId: agent.id,
    actKind: 'land',
    policy: 'Land only reviewed work.',
    escalation: [],
    mode: 'decide',
    expiresAt: Date.now() + 10_000,
  }, { 'x-tenant-id': OWNER })
  assert.equal(created.status, 200)
  return { projectId, agentId: agent.id as string, delegation: created.json }
}

const headers = (tenantId: string) => ({ 'x-tenant-id': tenantId })
async function atTime<T>(now: number, run: () => Promise<T>): Promise<T> {
  const originalNow = Date.now
  Date.now = () => now
  try {
    return await run()
  } finally {
    Date.now = originalNow
  }
}

test('Delegation policy revisions are owner-private, strict, replayable, and compare-revoked', async () => {
  const { projectId, delegation } = await setup('Policy history')
  const path = `/projects/${projectId}/delegations/${delegation.id}`
  const events: any[] = []
  const unsubscribe = store.subscribe((event: any) => {
    if (event.type === 'delegation.changed' && event.projectId === projectId) events.push(event)
  })
  try {
    assert.equal(delegation.revision, 0)
    assert.ok(delegation.expiresAt > Date.now())
    assert.equal(delegation.expired, false)
    assert.equal(delegation.versions.length, 1)
    assert.deepEqual(delegation.versions[0], {
      revision: 0,
      policy: 'Land only reviewed work.',
      escalation: ['effectful'],
      mode: 'decide',
      expiresAt: delegation.expiresAt,
      updatedAt: delegation.createdAt,
    })

    const shared = await call('GET', `/projects/${projectId}/delegations`, undefined, headers(CONTRIBUTOR))
    assert.equal(shared.status, 200)
    const sharedRow = shared.json.find((row: any) => row.id === delegation.id)
    assert.equal(sharedRow.policy, undefined)
    assert.equal(sharedRow.versions, undefined)
    assert.equal(sharedRow.expiresAt, delegation.expiresAt)
    assert.equal(sharedRow.expired, false)

    const privateProject = `p-delegation-policy-private-${sequence}`
    store.applyRelationOp({ kind: 'create-project', projectId: privateProject, projectName: 'Private', projectDescription: '' }, OWNER)
    assert.equal((await call('GET', `/projects/${privateProject}/delegations`, undefined, headers(FOREIGN))).status, 404)

    const firstEdit = {
      expectedRevision: 0,
      policy: 'Land reviewed note changes only.',
      escalation: ['unreviewed'],
      mode: 'draft',
      expiresAt: delegation.expiresAt,
    }
    const unauthorizedBefore = events.length
    assert.equal((await call('PATCH', path, firstEdit, headers(CONTRIBUTOR))).status, 403)
    assert.equal((await call('PATCH', `/projects/${privateProject}/delegations/absent`, firstEdit, headers(FOREIGN))).status, 404)
    assert.equal(events.length, unauthorizedBefore)

    for (const invalid of [
      { ...firstEdit, unexpected: true },
      { ...firstEdit, policy: '  ' },
      { ...firstEdit, policy: 'x'.repeat(2001) },
      { ...firstEdit, escalation: ['unknown'] },
      { ...firstEdit, mode: 'automatic' },
      { ...firstEdit, expectedRevision: 0.5 },
      { ...firstEdit, agentId: 'replacement-agent' },
      { ...firstEdit, actKind: 'approve-envelope' },
    ]) {
      const before = events.length
      const response = await call('PATCH', path, invalid, headers(OWNER))
      assert.equal(response.status, 400, JSON.stringify(invalid).slice(0, 80))
      assert.equal(events.length, before, 'invalid policy input emits no event')
    }
    assert.equal((await call('GET', `/projects/${projectId}/delegations`, undefined, headers(OWNER))).json
      .find((row: any) => row.id === delegation.id).revision, 0)

    const revision1 = await call('PATCH', path, firstEdit, headers(OWNER))
    assert.equal(revision1.status, 200)
    assert.equal(revision1.json.revision, 1)
    assert.equal(revision1.json.agentId, delegation.agentId)
    assert.equal(revision1.json.actKind, delegation.actKind)
    assert.equal(revision1.json.versions.length, 2)

    const secondEdit = {
      expectedRevision: 1,
      policy: 'Draft reviewed notes and explain the choice.',
      escalation: ['stranger'],
      mode: 'decide',
      expiresAt: delegation.expiresAt,
    }
    const revision2 = await call('PATCH', path, secondEdit, headers(OWNER))
    assert.equal(revision2.status, 200)
    assert.equal(revision2.json.revision, 2)
    assert.equal(revision2.json.versions.length, 3)

    const replay = await callFresh('PATCH', path, firstEdit, headers(OWNER))
    assert.equal(replay.status, 200, 'an exact historical step remains replayable after later policy edits')
    assert.equal(replay.json.revision, 2, 'replay returns current row truth')
    assert.equal(replay.json.policy, secondEdit.policy)
    assert.equal(replay.json.versions.length, 3)

    const changedReplay = await callFresh('PATCH', path, { ...firstEdit, policy: 'A changed old request.' }, headers(OWNER))
    assert.equal(changedReplay.status, 409)
    const stale = await call('PATCH', path, { ...secondEdit, expectedRevision: 0 }, headers(OWNER))
    assert.equal(stale.status, 409)
    assert.equal(events.length, 2, 'replay and refusals emit no new change event')

    const staleDelete = await call('DELETE', path, { expectedRevision: 1 }, headers(OWNER))
    assert.equal(staleDelete.status, 409)
    assert.equal(events.length, 2)
    const deleted = await call('DELETE', path, { expectedRevision: 2 }, headers(OWNER))
    assert.equal(deleted.status, 200)
    assert.equal(events.length, 3)
    assert.equal((await call('GET', `/projects/${projectId}/delegations`, undefined, headers(OWNER))).json
      .some((row: any) => row.id === delegation.id), false)
  } finally {
    unsubscribe()
  }
})

test('expired Delegations remain readable, editable, and revocable but cannot run', async () => {
  const { projectId, delegation } = await setup('Expiring policy')
  const delegationPath = `/projects/${projectId}/delegations/${delegation.id}`
  const events: any[] = []
  const unsubscribe = store.subscribe((event: any) => {
    if (event.type === 'contribution.changed' && event.projectId === projectId) events.push(event)
  })
  try {
    // Move the clock for the route/store operations so expiry checks stay
    // deterministic and independent of machine load.
    const baseTime = Math.max(Date.now(), delegation.createdAt)
    const expiringAt = baseTime + 1_000
    const shortGrant = await atTime(baseTime, () => call('PATCH', delegationPath, {
      expectedRevision: 0,
      policy: delegation.policy,
      escalation: delegation.escalation,
      mode: delegation.mode,
      expiresAt: expiringAt,
    }, headers(OWNER)))
    assert.equal(shortGrant.status, 200)

    const afterExpiry = expiringAt + 1
    const { expiredShared, opened } = await atTime(afterExpiry, async () => {
      const roster = await call('GET', `/projects/${projectId}/delegations`, undefined, headers(CONTRIBUTOR))
      const expiredShared = roster.json.find((row: any) => row.id === delegation.id)
      const opened = await call('POST', `/projects/${projectId}/contributions`, { title: 'Expired judgment' }, headers(CONTRIBUTOR))
      return { expiredShared, opened }
    })
    assert.equal(expiredShared.expired, true)
    assert.equal(expiredShared.policy, undefined)
    assert.equal(opened.status, 200)
    const runPath = `/projects/${projectId}/contributions/${opened.json.id}/delegated/${delegation.id}`
    const eventsBeforeRun = events.length
    const { before, refusal, afterRefusal } = await atTime(afterExpiry, async () => {
      const before = (await call('GET', `/projects/${projectId}/contributions`, undefined, headers(OWNER))).json
      const refusal = await call('POST', runPath, undefined, headers(REVIEWER))
      const afterRefusal = (await call('GET', `/projects/${projectId}/contributions`, undefined, headers(OWNER))).json
      return { before, refusal, afterRefusal }
    })
    assert.equal(refusal.status, 409)
    assert.equal(events.length, eventsBeforeRun, 'an expired grant does not append a delegated judgment')
    assert.deepEqual(afterRefusal, before)

    const revived = await atTime(afterExpiry + 1, () => call('PATCH', delegationPath, {
      expectedRevision: 1,
      policy: 'Still editable after expiry.',
      escalation: [],
      mode: 'decide',
      expiresAt: null,
    }, headers(OWNER)))
    assert.equal(revived.status, 200)
    assert.equal(revived.json.expired, false)
    assert.equal(revived.json.revision, 2)

    const judgment = await atTime(afterExpiry + 1, () => call('POST', runPath, undefined, headers(REVIEWER)))
    assert.equal(judgment.status, 200)
    const receipt = judgment.json.events.at(-1)
    assert.equal(receipt.kind, 'delegated-decision')
    assert.equal(receipt.delegationRevision, 2)
    const eventsAfterFixtureRun = events.length
    assert.ok(eventsAfterFixtureRun > eventsBeforeRun)

    const previousProfile = process.env.DEPLOYMENT_PROFILE
    process.env.DEPLOYMENT_PROFILE = 'web'
    try {
      const { releaseContribution, eventsBeforeRelease } = await atTime(afterExpiry + 2, async () => {
        const releaseContribution = await call('POST', `/projects/${projectId}/contributions`, { title: 'Release policy' }, headers(CONTRIBUTOR))
        return { releaseContribution, eventsBeforeRelease: events.length }
      })
      assert.equal(releaseContribution.status, 200)
      const releaseRun = await atTime(afterExpiry + 2, () => callFresh(
        'POST',
        `/projects/${projectId}/contributions/${releaseContribution.json.id}/delegated/${delegation.id}`,
        undefined,
        headers(REVIEWER),
      ))
      assert.equal(releaseRun.status, 409)
      assert.equal(releaseRun.json.error.code, 'capability_unavailable')
      assert.equal(events.length, eventsBeforeRelease, 'release runtime refuses fixture judgments before publishing')
    } finally {
      if (previousProfile === undefined) delete process.env.DEPLOYMENT_PROFILE
      else process.env.DEPLOYMENT_PROFILE = previousProfile
    }

    const staleDelete = await atTime(afterExpiry + 2, () => call('DELETE', delegationPath, { expectedRevision: 1 }, headers(OWNER)))
    assert.equal(staleDelete.status, 409)
    const expiredAgainAt = afterExpiry + 1_000
    const expiresAgain = await atTime(afterExpiry + 3, () => call('PATCH', delegationPath, {
      expectedRevision: 2,
      policy: 'Still editable after expiry.',
      escalation: [],
      mode: 'decide',
      expiresAt: expiredAgainAt,
    }, headers(OWNER)))
    assert.equal(expiresAgain.status, 200)
    const revoked = await atTime(expiredAgainAt + 1, () => call('DELETE', delegationPath, { expectedRevision: 3 }, headers(OWNER)))
    assert.equal(revoked.status, 200, 'an expired current grant can still be revoked')
  } finally {
    unsubscribe()
  }
})

test('Delegation create and edit reject expiry at or before the current time', async () => {
  const projectId = `p-delegation-policy-invalid-expiry-${++sequence}`
  store.applyRelationOp({ kind: 'create-project', projectId, projectName: 'Invalid expiry', projectDescription: '' }, OWNER)
  const agent = store.createAgent({ label: 'Expiry delegate', providerId: 'provider-claude', tools: [] } as any, OWNER)
  const events: any[] = []
  const unsubscribe = store.subscribe((event: any) => {
    if (event.type === 'delegation.changed' && event.projectId === projectId) events.push(event)
  })
  try {
    const now = Date.now()
    const invalidCreate = await call('POST', `/projects/${projectId}/delegations`, {
      agentId: agent.id,
      actKind: 'land',
      policy: 'Do not mint an already expired grant.',
      expiresAt: now,
    }, headers(OWNER))
    assert.equal(invalidCreate.status, 400)
    assert.equal(events.length, 0)

    const created = await call('POST', `/projects/${projectId}/delegations`, {
      agentId: agent.id,
      actKind: 'land',
      policy: 'Valid grant.',
      expiresAt: Date.now() + 10_000,
    }, headers(OWNER))
    assert.equal(created.status, 200)
    const invalidEdit = await call('PATCH', `/projects/${projectId}/delegations/${created.json.id}`, {
      expectedRevision: 0,
      policy: 'Already expired.',
      escalation: [],
      mode: 'draft',
      expiresAt: Date.now() - 1,
    }, headers(OWNER))
    assert.equal(invalidEdit.status, 400)
    assert.equal(events.length, 1, 'invalid expiry leaves the original grant untouched')
    const current = (await call('GET', `/projects/${projectId}/delegations`, undefined, headers(OWNER))).json[0]
    assert.equal(current.revision, 0)
    assert.equal(current.policy, 'Valid grant.')
  } finally {
    unsubscribe()
  }
})

test('Delegation history retains revision zero and stops at fifty versions', async () => {
  const { projectId, delegation } = await setup('Bounded policy history')
  const path = `/projects/${projectId}/delegations/${delegation.id}`
  const events: any[] = []
  const unsubscribe = store.subscribe((event: any) => {
    if (event.type === 'delegation.changed' && event.projectId === projectId) events.push(event)
  })
  try {
    let lastAccepted: any
    for (let revision = 0; revision < 49; revision += 1) {
      lastAccepted = {
        expectedRevision: revision,
        policy: `Retained policy revision ${revision + 1}.`,
        escalation: [],
        mode: revision % 2 === 0 ? 'draft' : 'decide',
        expiresAt: null,
      }
      const response = await call('PATCH', path, lastAccepted, headers(OWNER))
      assert.equal(response.status, 200, `revision ${revision + 1} is accepted`)
    }
    const full = (await call('GET', `/projects/${projectId}/delegations`, undefined, headers(OWNER))).json
      .find((row: any) => row.id === delegation.id)
    assert.equal(full.revision, 49)
    assert.equal(full.versions.length, 50)
    assert.equal(full.versions[0].revision, 0)
    assert.equal(full.versions[0].policy, delegation.policy)

    const atCap = await call('PATCH', path, {
      expectedRevision: 49,
      policy: 'This would be version fifty-one.',
      escalation: [],
      mode: 'draft',
      expiresAt: null,
    }, headers(OWNER))
    assert.equal(atCap.status, 409)
    const replay = await callFresh('PATCH', path, lastAccepted, headers(OWNER))
    assert.equal(replay.status, 200, 'the accepted revision remains replayable when history is full')
    assert.equal(replay.json.revision, 49)
    assert.equal(replay.json.versions.length, 50)
    assert.equal(events.length, 49, 'the cap refusal and represented replay do not emit events')
  } finally {
    unsubscribe()
  }
})
