import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { PartnerWorkService } from '../taskPartners/taskWork.ts'
import { STORE_VERSION, type PersistedState } from './format.ts'
import { restoreBackendState } from './portable.ts'
import { partnerRestoreDigest, prepareTaskPartnerRestoreState } from './taskPartnerRestore.ts'

const alice = { userId: 'alice', tenantId: 'alpha', operator: true },
  bob = { userId: 'bob', tenantId: 'beta' }
const origin = 'https://commons.example',
  now = Date.parse('2026-11-19T11:45:00Z')
function shell(): PersistedState {
  return {
    version: STORE_VERSION,
    sessions: [],
    bindings: [],
    workspaces: [],
    schedules: [],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: {
      sessionProject: {},
      artifactProject: {},
      scheduleProject: {},
      projectContexts: {},
      artifactSource: {},
      scheduleArtifact: {},
      scheduleSession: {},
      scheduleExtraTools: {},
      extraArtifacts: [],
      extraProjects: [],
      standingApprovals: {},
    },
    seq: {
      session: 1,
      message: 0,
      schedule: 0,
      run: 0,
      artifact: 0,
      provider: 0,
      systemPrompt: 0,
      agent: 0,
      commission: 0,
    },
  } as PersistedState
}
function issuedState() {
  const s = new PartnerWorkService({
    directory: {} as never,
    audience: origin,
    canAccessProject: () => true,
    now: () => now,
  })
  s.issueCredits(alice, bob, { quantity: '10', reason: 'Pilot', reference: 'reference-42' })
  return { ...shell(), partnerWork: s.snapshot() }
}
function authorized(incoming: PersistedState, live: PersistedState | null, overrides = {}) {
  const pair = generateKeyPairSync('ed25519'),
    kid = 'backup-a'
  const segments = [
    { typ: 'partner-restore+jwt', alg: 'Ed25519', kid },
    {
      iss: 'deployment-operator',
      aud: origin,
      iat: now / 1000,
      exp: now / 1000 + 240,
      jti: 'case-91',
      snapshotDigest: partnerRestoreDigest(incoming),
      liveDigest: live ? partnerRestoreDigest(live) : null,
      reconciliationRef: 'offline-ledger/checkpoint-91',
      ...overrides,
    },
  ]
    .map((x) => Buffer.from(JSON.stringify(x)).toString('base64url'))
    .join('.')
  return {
    TASK_PARTNER_WEB_ORIGIN: origin,
    TASK_PARTNER_RESTORE_PUBLIC_KEY: JSON.stringify({ ...pair.publicKey.export({ format: 'jwk' }), kid }),
    TASK_PARTNER_RESTORE_AUTHORIZATION:
      segments + '.' + sign(null, Buffer.from(segments), pair.privateKey).toString('base64url'),
  }
}
test('a portable workspace cannot mint site credits, remove settled history, or change account authority around an equal ledger', () => {
  const live = issuedState(),
    attempt = structuredClone(live)
  attempt.partnerWork.creditEntries[0][1].amount = '100'
  let saves = 0
  const backend = {
    name: 'restore-test',
    load: () => structuredClone(live),
    save: () => {
      saves++
    },
    close() {},
  }
  assert.throws(() => restoreBackendState(backend, attempt), /conflicting journal/)
  assert.throws(() => restoreBackendState(backend, shell()), /conflicting journal/)
  assert.equal(saves, 0)
  const changed = { ...live, accountUsers: [] }
  assert.throws(() => prepareTaskPartnerRestoreState(changed, backend, {}), /offline operator authorization/)
  assert.deepEqual(prepareTaskPartnerRestoreState(live, backend, {}), live)
  assert.throws(
    () => prepareTaskPartnerRestoreState(attempt, backend, authorized(attempt, live), now),
    /conflicting journal/,
  )
})

test('disaster admission is bound to the complete backup, target deployment, current store and a short-lived external reconciliation', () => {
  const data = issuedState(),
    backend = { load: () => null },
    env = authorized(data, null)
  assert.throws(() => prepareTaskPartnerRestoreState(data, backend, {}, now), /offline operator authorization/)
  assert.throws(
    () =>
      prepareTaskPartnerRestoreState(data, backend, { ...env, TASK_PARTNER_WEB_ORIGIN: 'https://other.example' }, now),
    /does not match/,
  )
  assert.throws(() => prepareTaskPartnerRestoreState(data, backend, env, now + 300_000), /expired/)
  assert.throws(
    () => prepareTaskPartnerRestoreState({ ...data, accountUsers: [] }, backend, env, now),
    /does not match/,
  )
  assert.throws(() => prepareTaskPartnerRestoreState(data, { load: shell }, env, now), /does not match/)
  const restored = prepareTaskPartnerRestoreState(data, backend, env, now)
  const s = new PartnerWorkService({ directory: {} as never, audience: origin, canAccessProject: () => true })
  s.restore(restored.partnerWork)
  assert.equal(s.balance(bob).available, '10')
  assert.deepEqual(prepareTaskPartnerRestoreState(shell(), { load: shell }, {}, now), shell())
})

test('trusted disaster recovery freezes external dispatch while retaining each command and original obligation', () => {
  const f = new PartnerWorkService({
    directory: {} as never,
    audience: origin,
    now: () => now,
    canAccessProject: () => true,
  })
  const task = f.createDraft(alice, 'project-1', { description: 'Test handoff' })
  const snapshot = f.snapshot(),
    t = snapshot.tasks[0][1],
    commandId = 'cmd-test'
  // Simulate an in-flight external run from the read-only archive. This test
  // drives the offline projection; runtime creation and signed receipts have
  // their separate full-stack fixtures.
  snapshot.commands.push([
    commandId,
    {
      view: {
        taskId: t.taskId,
        termsDigest: t.termsDigest,
        termsVersion: t.termsVersion,
        commandId,
        partnerId: 'partner-a',
        state: 'requested',
        environment: 'production',
        issuedAt: new Date(now).toISOString(),
        deadline: new Date(now + 60_000).toISOString(),
        action: {
          kind: 'run',
          input: t.input,
          grantRef: 'grant',
          submissionId: 'sub-a',
          model: 'model',
          maxInputTokens: 1,
          maxOutputTokens: 1,
        },
      },
    },
  ])
  const data = { ...shell(), partnerWork: snapshot }
  const restored = prepareTaskPartnerRestoreState(data, { load: () => null }, authorized(data, null), now)
  assert.equal(data.partnerWork.commands[0][1].view.state, 'requested')
  assert.equal(restored.partnerWork.commands[0][1].view.state, 'uncertain')
  assert.deepEqual(
    restored.partnerWork.obligations.map(([, o]) => [o.taskId, o.commandId, o.state]),
    [[task.taskId, commandId, 'effect_uncertain']],
  )
})
