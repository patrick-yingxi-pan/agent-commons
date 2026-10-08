import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DISPATCH_DETAIL_MAX,
  DISPATCH_TITLE_MAX,
  dispatchPrompt,
  parseRealDispatchInput,
} from './dispatchExecution.ts'

const valid = () => ({
  title: 'Review the release plan',
  detail: 'Check the compatibility notes.',
  execution: { agentId: 'agent-1', providerId: 'provider-1', modelId: 'model-1' },
})

test('real Dispatch parser admits only the exact bounded shape and detaches its binding', () => {
  const input = valid()
  const parsed = parseRealDispatchInput(input)
  assert.deepEqual(parsed, input)
  assert.ok(parsed)
  assert.notEqual(parsed, input)
  assert.notEqual(parsed.execution, input.execution)

  input.execution.agentId = 'changed-after-parse'
  assert.equal(parsed.execution.agentId, 'agent-1')
  parsed.execution.providerId = 'changed-output'
  assert.equal(input.execution.providerId, 'provider-1')

  assert.ok(parseRealDispatchInput({
    title: 'x'.repeat(DISPATCH_TITLE_MAX),
    detail: 'd'.repeat(DISPATCH_DETAIL_MAX),
    execution: { agentId: 'a', providerId: 'p', modelId: 'm' },
  }))
})

test('real Dispatch parser rejects malformed, extra, non-string, blank, and over-limit values without coercion', () => {
  const base = valid()
  const rejected: unknown[] = [
    null,
    undefined,
    [],
    'dispatch',
    { ...base, extra: true },
    { ...base, title: 12 },
    { ...base, title: '   ' },
    { ...base, title: `x${'x'.repeat(DISPATCH_TITLE_MAX)}` },
    { ...base, detail: 1 },
    { ...base, detail: 'd'.repeat(DISPATCH_DETAIL_MAX + 1) },
    { ...base, execution: null },
    { ...base, execution: { ...base.execution, extra: 'not admitted' } },
    { ...base, execution: { ...base.execution, agentId: '' } },
    { ...base, execution: { ...base.execution, agentId: '  ' } },
    { ...base, execution: { ...base.execution, providerId: 1 } },
    { ...base, execution: { ...base.execution, modelId: 'm'.repeat(201) } },
  ]
  for (const value of rejected) assert.equal(parseRealDispatchInput(value), undefined)
})

test('dispatch prompt trims title and detail and joins a nonblank detail with one blank line', () => {
  assert.equal(dispatchPrompt('  Release review  ', '  Verify the rollback notes.  '),
    'Release review\n\nVerify the rollback notes.')
  assert.equal(dispatchPrompt('  Release review  '), 'Release review')
  assert.equal(dispatchPrompt('  Release review  ', ' \n '), 'Release review')
})
