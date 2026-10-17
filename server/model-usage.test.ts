import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createModelUsageRecorder, normalizeModelUsage, UsageRecordingError } from './modelUsage.ts'

test('reports and totals are detached and each completed call is recorded once', () => {
  const reports = []
  const recorder = createModelUsageRecorder((usage) => {
    reports.push({ ...usage })
    usage.inputTokens = 999
  })
  recorder.record({ inputTokens: 10, outputTokens: 2 })
  recorder.record({ inputTokens: 20, outputTokens: 3 })
  assert.deepEqual(reports, [{ inputTokens: 10, outputTokens: 2 }, { inputTokens: 20, outputTokens: 3 }])
  const total = recorder.snapshot()
  total.inputTokens = 999
  assert.deepEqual(recorder.snapshot(), { inputTokens: 30, outputTokens: 5 })
})

test('invalid reports and total overflow never reach the sink or advance totals', () => {
  for (const inputTokens of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    let reports = 0
    const recorder = createModelUsageRecorder(() => { reports += 1 })
    assert.throws(() => recorder.record({ inputTokens, outputTokens: 0 }), UsageRecordingError)
    assert.equal(reports, 0)
    assert.deepEqual(recorder.snapshot(), { inputTokens: 0, outputTokens: 0 })
  }
  const recorder = createModelUsageRecorder()
  recorder.record({ inputTokens: Number.MAX_SAFE_INTEGER - 1, outputTokens: 1 })
  assert.throws(() => recorder.record({ inputTokens: 0, outputTokens: 1 }), UsageRecordingError)
  assert.deepEqual(recorder.snapshot(), { inputTokens: Number.MAX_SAFE_INTEGER - 1, outputTokens: 1 })
})

test('a failed sink fences subsequent reports without retrying an uncertain write', () => {
  let reports = 0
  const cause = new Error('private disk path')
  const recorder = createModelUsageRecorder(() => { reports += 1; throw cause })
  assert.throws(() => recorder.record({ inputTokens: 1, outputTokens: 2 }), (error) => {
    assert.ok(error instanceof UsageRecordingError)
    assert.equal(error.cause, cause)
    assert.doesNotMatch(error.message, /private disk path/)
    return true
  })
  assert.throws(() => recorder.record({ inputTokens: 1, outputTokens: 2 }), UsageRecordingError)
  assert.equal(reports, 1)
  assert.deepEqual(recorder.snapshot(), { inputTokens: 0, outputTokens: 0 })
})

test('native Messages cached input is included once; absent or null cache counters mean zero', () => {
  assert.deepEqual(normalizeModelUsage({
    input_tokens: 17,
    output_tokens: 9,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 30,
  }), { inputTokens: 67, outputTokens: 9 })
  assert.deepEqual(normalizeModelUsage({ input_tokens: 17, output_tokens: 9 }), { inputTokens: 17, outputTokens: 9 })
  assert.deepEqual(normalizeModelUsage({
    input_tokens: 17, output_tokens: 9,
    cache_creation_input_tokens: null, cache_read_input_tokens: null,
  }), { inputTokens: 17, outputTokens: 9 })
})

test('malformed cache counters, missing base counters and unsafe cached-input sums are uncertain', () => {
  for (const usage of [
    { input_tokens: 17, output_tokens: 9, cache_creation_input_tokens: '20' },
    { input_tokens: 17, output_tokens: 9, cache_read_input_tokens: -1 },
    { input_tokens: 17, output_tokens: 9, cache_read_input_tokens: undefined },
    { input_tokens: 17, cache_creation_input_tokens: 20 },
    { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 0, cache_creation_input_tokens: 1 },
    { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 },
  ]) assert.throws(() => normalizeModelUsage(usage), UsageRecordingError)
})

test('normalized aggregate usage is not augmented with cached input a second time', () => {
  assert.deepEqual(normalizeModelUsage({
    input_tokens: 47,
    output_tokens: 9,
    cache_read_input_tokens: 30,
  }, { inputIncludesCached: true }), { inputTokens: 47, outputTokens: 9 })
})
