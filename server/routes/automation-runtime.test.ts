/** Release profiles expose deterministic automation as unavailable. These route
 * locks use the real route table and a verified bearer identity: production
 * refusal must precede both execution and idempotent response replay, while
 * posting work remains an accepted, open coordination act. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../store/index.ts'
import { call } from '../testkit/http.ts'

const TENANT = 'tenant-acme'
let sequence = 0

function withEnv(name: string, value: string | undefined): () => void {
  const previous = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
  return () => {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  }
}

async function verifiedAda() {
  const login = await call('POST', '/auth/login', {
    email: 'ada@acme.example', password: 'ada-demo-password', transport: 'bearer',
  })
  assert.equal(login.status, 200)
  const auth = { authorization: `Bearer ${login.json.token}` }
  const me = await call('GET', '/me', undefined, auth)
  assert.equal(me.status, 200)
  assert.equal(me.json.via, 'session', 'requests use a verified identity, not the test header seam')
  assert.equal(me.json.tenant.id, TENANT)
  return auth
}

function eligibleArena(label: string) {
  const id = `p-automation-runtime-${++sequence}`
  store.applyRelationOp({ kind: 'create-project', projectId: id, projectName: label, projectDescription: '' }, TENANT)
  const agent = store.createAgent({ label: `${label} agent`, systemPrompt: 'x', tools: [], instructions: '' }, TENANT)
  const commission = store.createCommission({ role: 'writer', agentId: agent.id, projectId: id, standing: true }, TENANT)
  return { id, agent, commission }
}

const messageSend = (subGoal: string) => ({
  jsonrpc: '2.0',
  id: `message-${subGoal}`,
  method: 'message/send',
  params: {
    message: {
      kind: 'message', role: 'user', messageId: `message-${subGoal}`,
      parts: [
        { kind: 'text', text: subGoal },
        { kind: 'data', data: { type: 'charge', target: `budget:${subGoal}` } },
      ],
    },
  },
})

test('simulatedAutomation is advertised only without a deployment profile', () => {
  const restore = withEnv('DEPLOYMENT_PROFILE', undefined)
  try {
    assert.equal(store.capabilities().features.simulatedAutomation, true)
    for (const profile of ['desktop', 'web', 'release']) {
      process.env.DEPLOYMENT_PROFILE = profile
      assert.equal(store.capabilities().features.simulatedAutomation, false, `${profile} must fail closed`)
    }
  } finally {
    restore()
  }
})

test('desktop and web refuse simulated effect routes before execution or cached Dispatch replay', async () => {
  const restoreProfile = withEnv('DEPLOYMENT_PROFILE', undefined)
  const restoreAuth = withEnv('AUTH_GATE', 'require')
  try {
    const auth = await verifiedAda()
    const { id: projectId, agent, commission } = eligibleArena('Release effect gate')
    const dispatchKey = `automation-runtime-dispatch-${++sequence}`
    const dispatchPath = '/dispatch'
    const created = await call('POST', dispatchPath, { title: 'Fixture-only dispatch', detail: 'Must not replay in release.' }, {
      ...auth, 'idempotency-key': dispatchKey,
    })
    assert.equal(created.status, 200, 'development keeps deterministic mock automation')
    const feedBeforeProfiles = (await call('GET', '/dispatch', undefined, auth)).json
    assert.ok(feedBeforeProfiles.some((run: any) => run.id === created.json.id))

    for (const profile of ['desktop', 'web']) {
      process.env.DEPLOYMENT_PROFILE = profile
      const beforeFeed = (await call('GET', '/dispatch', undefined, auth)).json
      const beforeCredit = store.getAgent(agent.id).contributions ?? 0
      const projectTarget = `budget:release-project-${profile}-${sequence}`
      const proxyTarget = `budget:release-proxy-${profile}-${sequence}`
      const beforeProjectAudit = store.listAuditLog(TENANT).filter((entry) => entry.target === projectTarget).length
      const beforeProxyAudit = store.listAuditLog(TENANT).filter((entry) => entry.target === proxyTarget).length

      const attempts = [
        ['Dispatch', () => call('POST', dispatchPath, { title: 'Fixture-only dispatch', detail: 'Must not replay in release.' }, {
          ...auth, 'idempotency-key': dispatchKey,
        })],
        ['Project effect', () => call('POST', `/projects/${projectId}/effects`, {
          commissionId: commission.id, subGoal: `release-${profile}`, type: 'charge', target: projectTarget,
        }, auth)],
        ['Agent proxy', () => call('POST', `/agents/${agent.id}/proxy`, {
          fromAgentId: `requester-${profile}`, capability: 'charge', target: proxyTarget,
        }, auth)],
      ] as const

      for (const [name, request] of attempts) {
        const response = await request()
        assert.equal(response.status, 409, `${profile} ${name} refuses simulated execution/replay`)
        assert.equal(response.json.error.code, 'capability_unavailable')
      }

      const afterFeed = (await call('GET', '/dispatch', undefined, auth)).json
      assert.deepEqual(afterFeed.map((run: any) => run.id), beforeFeed.map((run: any) => run.id), `${profile} did not append/replay a Dispatch row`)
      assert.equal(store.getAgent(agent.id).contributions ?? 0, beforeCredit, `${profile} did not credit an effect`)
      assert.equal(store.listAuditLog(TENANT).filter((entry) => entry.target === projectTarget).length, beforeProjectAudit)
      assert.equal(store.listAuditLog(TENANT).filter((entry) => entry.target === proxyTarget).length, beforeProxyAudit)
    }
  } finally {
    restoreAuth()
    restoreProfile()
  }
})

test('release profiles accept eligible standing-agent work posts but leave native and A2A work submitted/open', async () => {
  const restoreProfile = withEnv('DEPLOYMENT_PROFILE', undefined)
  const restoreAuth = withEnv('AUTH_GATE', 'require')
  try {
    const auth = await verifiedAda()
    for (const profile of ['desktop', 'web']) {
      process.env.DEPLOYMENT_PROFILE = profile
      const { id: projectId, commission } = eligibleArena(`Open work ${profile}`)
      const subGoal = `release-open-${profile}-${sequence}`
      const native = await call('POST', `/projects/${projectId}/open-subgoals`, {
        subGoal, type: 'charge', target: `budget:${subGoal}`,
      }, auth)
      assert.equal(native.status, 200, `${profile} still accepts a valid Project work post`)
      assert.equal(native.json.status, 'open', `${profile} does not let standing automation synthesize completion`)
      assert.equal(native.json.resolvedBy, undefined)

      const a2aSubGoal = `release-a2a-${profile}-${sequence}`
      const a2a = await call('POST', `/a2a/projects/${projectId}`, messageSend(a2aSubGoal), auth)
      assert.equal(a2a.status, 200, `${profile} still accepts A2A message/send work`)
      assert.equal(a2a.json.result.kind, 'task')
      assert.equal(a2a.json.result.status.state, 'submitted', `${profile} represents open work as submitted, not completed`)

      const listed = await call('GET', `/projects/${projectId}/open-subgoals`, undefined, auth)
      assert.equal(listed.status, 200)
      assert.equal(listed.json.length, 2)
      assert.ok(listed.json.every((item: any) => item.status === 'open'))
      assert.equal(store.commissionRolePermits(commission.id, 'fire'), true, 'the standing commission is eligible; only simulated execution is disabled')
    }
  } finally {
    restoreAuth()
    restoreProfile()
  }
})
