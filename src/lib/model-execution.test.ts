import test from 'node:test'
import assert from 'node:assert/strict'
import { composerExecutionState } from './modelExecution.ts'

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

test('configured and development-mock providers remain usable but never share the same claim', () => {
  assert.equal(composerExecutionState('configured').blocked, false)
  assert.match(composerExecutionState('configured').note, /Connected model/)
  assert.equal(composerExecutionState('mock').blocked, false)
  assert.match(composerExecutionState('mock').note, /local mock/)
  assert.notEqual(composerExecutionState('configured').note, composerExecutionState('mock').note)
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
