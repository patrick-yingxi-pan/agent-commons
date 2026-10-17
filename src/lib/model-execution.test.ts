import test from 'node:test'
import assert from 'node:assert/strict'
import { composerExecutionState, modelProviderAvailable, modelSetupRequired } from './modelExecution.ts'

test('an unconfigured endpoint blocks composition with an actionable explanation', () => {
  assert.deepEqual(composerExecutionState('unconfigured'), {
    blocked: true,
    placeholder: 'Connect a model provider to begin…',
    note: 'No model endpoint is configured. Choose another provider or add one from Models.',
  })
})

test('an unresolved provider never creates a send-before-status race', () => {
  assert.deepEqual(composerExecutionState(), {
    blocked: true,
    placeholder: 'Checking model connection…',
    note: 'Checking the selected model connection…',
  })
})

test('a resolved registry missing the selected provider is unavailable, not still loading', () => {
  assert.deepEqual(composerExecutionState(undefined, undefined, true), {
    blocked: true,
    placeholder: 'This model connection is unavailable to this account.',
    note: 'This model connection is unavailable to this account.',
  })
})

test('configured and development-mock providers remain usable but never share the same claim', () => {
  assert.equal(composerExecutionState('configured').blocked, false)
  assert.match(composerExecutionState('configured').note, /Connected model/)
  assert.equal(composerExecutionState('mock').blocked, false)
  assert.match(composerExecutionState('mock').note, /local mock/)
  assert.notEqual(composerExecutionState('configured').note, composerExecutionState('mock').note)
})

test('an unavailable exact model blocks an otherwise configured connection with selection recovery', () => {
  assert.deepEqual(composerExecutionState('configured', undefined, false, 'retired-model'), {
    blocked: true,
    placeholder: 'Choose an available model…',
    note: "Model 'retired-model' is unavailable. Choose an available model in Model and effort, or update this connection in Models.",
  })
  assert.equal(composerExecutionState('configured', undefined, false, undefined).blocked, false,
    'an explicit current model remains runnable on the same connection')
})

test('Session-provider liveness has its own honest blocked and connected states', () => {
  assert.deepEqual(composerExecutionState(undefined, false), {
    blocked: true,
    placeholder: 'Start this Session provider to begin…',
    note: 'This Session provider is offline. Start its drain loop, or choose another provider.',
  })
  assert.equal(composerExecutionState(undefined, true).blocked, false)
  assert.match(composerExecutionState(undefined, true).note, /Session provider connected/)
})

test('first-run setup is required until one endpoint or Session provider can answer', () => {
  const endpoint = {
    id: 'endpoint',
    label: 'Endpoint',
    modelFamily: 'claude',
    effortLevels: [],
  }
  const session = {
    ...endpoint,
    id: 'session',
    kind: 'session' as const,
  }

  assert.equal(modelSetupRequired([]), true, 'a resolved empty registry cannot answer')
  assert.equal(modelSetupRequired([{ ...endpoint, execution: 'unconfigured' }]), true)
  assert.equal(modelSetupRequired([{ ...session, online: false }]), true)
  assert.equal(modelProviderAvailable({ ...endpoint, execution: 'configured' }), true)
  assert.equal(modelProviderAvailable({ ...endpoint, execution: 'mock' }), true)
  assert.equal(modelProviderAvailable({ ...session, online: true }), true)
  assert.equal(modelSetupRequired([
    { ...endpoint, execution: 'unconfigured' },
    { ...session, online: true },
  ]), false)
})
