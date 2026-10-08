import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AutomationUnavailableError, automationRuntimeMode, requireAutomationFixture } from '../automationRuntime.ts'
import { store } from './index.ts'

const OWNER = 'tenant-automation-runtime-owner'
let sequence = 0

function withProfile<T>(profile: string | undefined, run: () => T): T {
  const previous = process.env.DEPLOYMENT_PROFILE
  if (profile === undefined) delete process.env.DEPLOYMENT_PROFILE
  else process.env.DEPLOYMENT_PROFILE = profile
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.DEPLOYMENT_PROFILE
    else process.env.DEPLOYMENT_PROFILE = previous
  }
}

function createProject(share = true) {
  const id = `p-automation-runtime-${++sequence}`
  store.applyRelationOp({ kind: 'create-project', projectId: id, projectName: id, projectDescription: '' }, OWNER)
  if (share) store.applyRelationOp({ kind: 'share-project', projectId: id, projectName: id, shared: true }, OWNER)
  return id
}

function createAgent(label: string) {
  return store.createAgent({ label, systemPrompt: 'test fixture', instructions: '', tools: [] }, OWNER)
}

function createCommission(projectId: string, standing: boolean, label: string) {
  const agent = createAgent(label)
  const commission = store.createCommission({ agentId: agent.id, projectId, role: 'writer', standing }, OWNER)
  return { agent, commission }
}

function expectUnavailable(run: () => unknown) {
  assert.throws(run, (error: unknown) =>
    error instanceof AutomationUnavailableError && error.code === 'capability_unavailable',
  )
}

test('automation fixture mode is explicit and every nonempty deployment profile is unconfigured', () => {
  for (const profile of [undefined, '']) {
    withProfile(profile, () => {
      assert.equal(automationRuntimeMode(), 'fixture')
      assert.equal(store.capabilities().features.simulatedAutomation, true)
      requireAutomationFixture('dispatch')
    })
  }

  for (const profile of ['desktop', 'web', 'unknown-release-profile']) {
    withProfile(profile, () => {
      assert.equal(automationRuntimeMode(), 'unconfigured')
      assert.equal(store.capabilities().features.simulatedAutomation, false)
      for (const kind of ['dispatch', 'project-effect', 'proxy'] as const) {
        expectUnavailable(() => requireAutomationFixture(kind))
      }
    })
  }
})

test('release profiles refuse Dispatch before keyed replay, row creation, or event publication', () => {
  for (const profile of ['desktop', 'web', 'unknown-release-profile']) {
    const key = `d-new-automation-${profile}-${++sequence}`
    const existing = withProfile(undefined, () => store.addDispatch('fixture row', undefined, OWNER, key))
    assert.equal(existing.id, key)

    let changes = 0
    const off = store.subscribe((event) => { if (event.type === 'dispatch.changed') changes += 1 })
    const before = store.listDispatch(OWNER).filter((run) => run.id === key)
    assert.equal(before.length, 1)

    withProfile(profile, () => {
      expectUnavailable(() => store.addDispatch('changed replay body', undefined, OWNER, key))
      expectUnavailable(() => store.addDispatch(`new ${profile} row`, undefined, OWNER, `${key}-new`))
    })

    off()
    assert.equal(changes, 0, `${profile}: refusal emits no dispatch event`)
    assert.equal(store.listDispatch(OWNER).filter((run) => run.id === key).length, 1)
    assert.equal(store.listDispatch(OWNER).some((run) => run.id === `${key}-new`), false)
    assert.equal(store.listDispatch(OWNER).find((run) => run.id === key), existing, 'replay refusal leaves current truth untouched')
  }
})

test('release profiles refuse Project effects and proxy before guardian, credit, or audit mutation', () => {
  const projectId = createProject()
  const { agent, commission } = createCommission(projectId, false, 'Automation effect worker')
  const profiles = ['desktop', 'web', 'unknown-release-profile']

  for (const profile of profiles) {
    const target = `automation-runtime-${profile}`
    const subGoal = `effect-${profile}`
    const creditBefore = store.getAgent(agent.id)?.contributions ?? 0
    const auditsBefore = store.listAuditLog(OWNER).filter((entry) => entry.target === target).length
    const resourceId = `${projectId}:${subGoal}`
    const resourceWasTracked = store.guardian.resourceIds().includes(resourceId)
    const proxyTarget = `proxy-${profile}`
    const proxyAuditsBefore = store.listAuditLog(OWNER).filter((entry) => entry.target === proxyTarget).length

    withProfile(profile, () => {
      expectUnavailable(() => store.runProjectEffect(projectId, commission.id, subGoal, 'charge', target))
      expectUnavailable(() => store.runAgentProxy(agent.id, { capability: 'mcp.mutate', target: proxyTarget }))
    })

    assert.equal(store.getAgent(agent.id)?.contributions ?? 0, creditBefore, `${profile}: no fake contribution credit`)
    assert.equal(store.listAuditLog(OWNER).filter((entry) => entry.target === target).length, auditsBefore, `${profile}: no Project-effect audit`)
    assert.equal(store.listAuditLog(OWNER).filter((entry) => entry.target === proxyTarget).length, proxyAuditsBefore, `${profile}: no proxy audit`)
    assert.equal(store.guardian.resourceIds().includes(resourceId), resourceWasTracked, `${profile}: refusal occurs before guardian admission`)
  }
})

test('release standing dispatch leaves eligible work open and never credits, audits, or reserves it', () => {
  const projectId = createProject()
  const { agent, commission } = createCommission(projectId, true, 'Standing automation worker')
  const target = `standing-release-${++sequence}`
  const subGoal = `standing-release-${sequence}`
  const creditBefore = store.getAgent(agent.id)?.contributions ?? 0
  const auditsBefore = store.listAuditLog(OWNER).filter((entry) => entry.target === target).length

  const item = withProfile('desktop', () => store.postOpenSubGoal(
    projectId,
    { subGoal, type: 'charge', target },
    OWNER,
    undefined,
  ))

  assert.notEqual(item, 'capped')
  assert.equal(item.status, 'open')
  assert.equal(item.resolvedBy, undefined)
  assert.equal(store.getAgent(agent.id)?.contributions ?? 0, creditBefore)
  assert.equal(store.listAuditLog(OWNER).filter((entry) => entry.target === target).length, auditsBefore)
  assert.equal(store.guardian.resourceIds().includes(`${projectId}:${subGoal}`), false)
  assert.equal(store.listCommissions(projectId, OWNER).some((row) => row.id === commission.id), true)
})

test('creating or enabling a standing commission cannot close queued work in a release profile', () => {
  for (const change of ['create', 'update'] as const) {
    const projectId = createProject()
    const target = `queued-${change}-${++sequence}`
    const subGoal = `queued-${change}-${sequence}`
    const item = withProfile('web', () => store.postOpenSubGoal(
      projectId,
      { subGoal, type: 'charge', target },
      OWNER,
      undefined,
    ))
    assert.notEqual(item, 'capped')
    assert.equal(item.status, 'open')

    const agent = createAgent(`Queued ${change} worker`)
    const commission = withProfile('web', () => store.createCommission({
      agentId: agent.id,
      projectId,
      role: 'writer',
      ...(change === 'create' ? { standing: true } : {}),
    }, OWNER))
    if (change === 'update') {
      withProfile('web', () => store.updateCommission(commission.id, { standing: true }))
    }

    assert.equal(store.listOpenSubGoals(projectId, OWNER).find((row) => row.id === item.id)?.status, 'open')
    assert.equal(store.getAgent(agent.id)?.contributions ?? 0, 0)
    assert.equal(store.listAuditLog(OWNER).some((entry) => entry.target === target && entry.outcome === 'fulfilled'), false)
    assert.equal(store.guardian.resourceIds().includes(`${projectId}:${subGoal}`), false)
  }
})
