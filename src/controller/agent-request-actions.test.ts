import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentRequestView } from '../../contract/agentRequests.ts'
import { createAgentRequestActions, type AgentRequestAction, type AgentRequestActionsPort } from './agentRequestActionsCore.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const createAction: AgentRequestAction = {
  kind: 'create', id: 'agent-request-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', key: 'logical-key',
  input: { fromAgentId: 'agent-from', toAgentId: 'agent-to', task: 'Check this exact work item.' },
}
const decisionAction: AgentRequestAction = {
  kind: 'decision', id: 'agent-request-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  input: { action: 'deny', expectedRevision: 1 },
}

function view(action: AgentRequestAction, overrides: Partial<AgentRequestView> = {}): AgentRequestView {
  return {
    id: action.id,
    fromAgentId: action.kind === 'create' ? action.input.fromAgentId : 'agent-from',
    toAgentId: action.kind === 'create' ? action.input.toAgentId : 'agent-to',
    task: action.kind === 'create' ? action.input.task : 'The existing request task.',
    createdAt: 1, updatedAt: 2, revision: action.kind === 'decision' ? 2 : 1,
    status: action.kind === 'decision' ? 'denied' : 'waiting', role: action.kind === 'create' ? 'requester' : 'owner',
    fromAgentLabel: 'Requester', toAgentLabel: 'Owner', fromAgentAvailable: true, toAgentAvailable: true,
    ...overrides,
  }
}

function harness(options: {
  submit?: (action: AgentRequestAction) => Promise<AgentRequestView>
  read?: (id: string) => Promise<AgentRequestView>
  definitive?: (error: unknown) => boolean
} = {}) {
  const submitted: AgentRequestAction[] = []
  const reads: string[] = []
  const accepted: AgentRequestView[] = []
  const remembered: string[][] = []
  let changes = 0
  const port: AgentRequestActionsPort = {
    submit: action => { submitted.push(structuredClone(action)); return options.submit?.(action) ?? Promise.resolve(view(action)) },
    read: id => { reads.push(id); return options.read?.(id) ?? Promise.reject(new Error('not found')) },
    accept: row => { accepted.push(row) },
    definitive: options.definitive ?? (() => false),
    changed: () => { changes += 1 },
    remember: ids => { remembered.push([...ids]) },
  }
  return { actions: createAgentRequestActions(port), submitted, reads, accepted, remembered, changes: () => changes }
}

test('one POST followed only by a GET recovers an uncertain acknowledgement', async () => {
  const h = harness({
    submit: async () => { throw new Error('connection lost after submit') },
    read: async id => view(createAction, { id, revision: 1, status: 'waiting' }),
  })
  await h.actions.begin(createAction)
  assert.deepEqual(h.submitted, [createAction], 'uncertainty never resends the create POST')
  assert.deepEqual(h.reads, [createAction.id], 'the only recovery operation is an exact-row read')
  assert.equal(h.actions.get(createAction.id)?.state, 'settled')
  assert.equal(h.accepted.length, 1)
  assert.deepEqual(h.actions.get(createAction.id), { id: createAction.id, state: 'settled' },
    'settlement removes private action and receipt copies from recovery memory')
})

test('duplicate begin calls coalesce while the original acknowledgement is pending', async () => {
  const response = deferred<AgentRequestView>()
  const h = harness({ submit: () => response.promise })
  const first = h.actions.begin(createAction)
  const duplicate = h.actions.begin(createAction)
  assert.equal(h.submitted.length, 1)
  response.resolve(view(createAction))
  await Promise.all([first, duplicate])
  assert.equal(h.submitted.length, 1)
  assert.equal(h.accepted.length, 1)
})

test('wrong and malformed acknowledgements cannot settle; unchanged decision revision remains uncertain', async () => {
  for (const [name, acknowledgement] of [
    ['wrong identity', view(decisionAction, { id: 'agent-request-cccccccccccccccccccccccccccccccc', revision: 4 })],
    ['malformed revision', view(decisionAction, { revision: 0 })],
  ] as const) {
    const h = harness({
      submit: async () => acknowledgement,
      read: async () => view(decisionAction, { revision: 1, status: 'waiting' }),
    })
    await h.actions.begin(decisionAction)
    assert.equal(h.actions.get(decisionAction.id)?.state, 'uncertain', name)
    assert.equal(h.actions.get(decisionAction.id)?.error,
      'The saved outcome is not confirmed. Check again without resubmitting.')
    assert.equal(h.accepted.length, 0)
    assert.deepEqual(h.submitted, [decisionAction])
    assert.deepEqual(h.reads, [decisionAction.id])
  }
})

test('a definitive 4xx refusal ends the attempt without a reconciliation read', async () => {
  const conflict = Object.assign(new Error('revision conflict'), { status: 409 })
  const h = harness({ submit: async () => { throw conflict }, definitive: error =>
    typeof error === 'object' && error !== null && 'status' in error && Number(error.status) >= 400 && Number(error.status) < 500 })
  await h.actions.begin(decisionAction)
  assert.equal(h.actions.get(decisionAction.id)?.state, 'refused')
  assert.equal(h.actions.get(decisionAction.id)?.error, 'revision conflict')
  assert.deepEqual(h.reads, [])
})

test('clear fences late submit acknowledgements and read recovery', async () => {
  const submitResponse = deferred<AgentRequestView>()
  const readResponse = deferred<AgentRequestView>()
  const h = harness({
    submit: () => submitResponse.promise,
    read: () => readResponse.promise,
  })
  const submitting = h.actions.begin(createAction)
  h.actions.clear()
  submitResponse.resolve(view(createAction))
  await submitting
  assert.deepEqual(h.actions.all(), [])
  assert.deepEqual(h.accepted, [], 'an old account acknowledgement cannot publish after clear')

  h.actions.restore(['agent-request-dddddddddddddddddddddddddddddddd'])
  const checking = h.actions.check('agent-request-dddddddddddddddddddddddddddddddd')
  h.actions.clear()
  readResponse.resolve(view(decisionAction, { id: 'agent-request-dddddddddddddddddddddddddddddddd' }))
  await checking
  assert.deepEqual(h.actions.all(), [])
  assert.deepEqual(h.accepted, [], 'a late reconciliation read cannot publish after clear')
})

test('create acknowledgement must echo the exact authored request intent', async () => {
  const h = harness({
    submit: async action => view(action, { task: 'Altered by the server response.' }),
    read: async id => view(createAction, { id, task: 'Altered by the server response.' }),
  })
  await h.actions.begin(createAction)
  assert.equal(h.actions.get(createAction.id)?.state, 'uncertain')
  assert.equal(h.accepted.length, 0)
  assert.deepEqual(h.submitted, [createAction])
  assert.deepEqual(h.reads, [createAction.id])
})

test('restored opaque IDs only read, and Dismiss drops metadata without cancelling server work', async () => {
  const h = harness({ read: async id => view(createAction, { id, task: 'A later read found the represented row.' }) })
  const id = 'agent-request-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  h.actions.restore([id])
  assert.deepEqual(h.actions.get(id), { id, state: 'uncertain' }, 'restored metadata has no saved mutation arguments')
  await h.actions.check(id)
  assert.deepEqual(h.submitted, [], 'an opaque restored ID cannot reconstruct a POST')
  assert.deepEqual(h.reads, [id])
  assert.equal(h.actions.get(id)?.state, 'settled')

  h.actions.restore(['agent-request-ffffffffffffffffffffffffffffffff'])
  const dismissed = 'agent-request-ffffffffffffffffffffffffffffffff'
  h.actions.dismiss(dismissed)
  assert.equal(h.actions.get(dismissed), undefined)
  assert.deepEqual(h.submitted, [], 'Dismiss only clears local recovery metadata')
})

test('remembered recovery metadata contains only opaque IDs, never saved decision text', async () => {
  const privateReply = 'private-reply-that-must-not-be-written-to-browser-storage'
  const action: AgentRequestAction = {
    kind: 'decision', id: 'agent-request-12121212121212121212121212121212',
    input: { action: 'share', expectedRevision: 3, reply: privateReply },
  }
  const h = harness({
    submit: async () => { throw new Error('connection lost') },
    read: async () => { throw new Error('read unavailable') },
  })
  await h.actions.begin(action)
  assert.equal(h.actions.get(action.id)?.state, 'uncertain')
  assert.ok(h.remembered.length >= 2, 'sending and recovery state both reach the persistence boundary')
  assert.ok(h.remembered.every(ids => ids.length === 1 && ids[0] === action.id))
  assert.equal(JSON.stringify(h.remembered).includes(privateReply), false)

  const afterReload = harness()
  afterReload.actions.restore(h.remembered.at(-1)!)
  const restored = afterReload.actions.get(action.id)!
  assert.equal(restored.action, undefined)
  assert.equal(JSON.stringify(restored).includes(privateReply), false)
})
