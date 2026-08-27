/** ADAPT-27's pure decision table: absence is a conclusion, never a synonym
 * for "the network did not answer." */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveResourceUnavailable } from './resourceRead.ts'

const read = (
  status: 'idle' | 'loading' | 'success' | 'error',
  error?: Error,
) => ({ status, error })

const requestError = (status: number) => Object.assign(new Error(`request failed (${status})`), { status })

test('list-derived resources become missing only after every deciding read succeeds', () => {
  assert.equal(resolveResourceUnavailable([read('idle')]), 'loading')
  assert.equal(resolveResourceUnavailable([read('success'), read('loading')]), 'loading')
  assert.equal(resolveResourceUnavailable([read('success'), read('success')]), 'missing')
  assert.equal(
    resolveResourceUnavailable([read('success'), read('error', requestError(0))]),
    'error',
  )
})

test('a direct existence-hiding 404 is missing while every other failure remains retryable', () => {
  const notFound = read('error', requestError(404))
  const denied = read('error', requestError(403))
  const offline = read('error', requestError(0))

  assert.equal(resolveResourceUnavailable([notFound], { notFoundIsMissing: true }), 'missing')
  assert.equal(resolveResourceUnavailable([denied], { notFoundIsMissing: true }), 'error')
  assert.equal(resolveResourceUnavailable([offline], { notFoundIsMissing: true }), 'error')
  assert.equal(resolveResourceUnavailable([notFound]), 'error', 'list reads never interpret a 404 for the page')
})

test('one 404 cannot hide another deciding read that has not succeeded', () => {
  const notFound = read('error', requestError(404))
  assert.equal(resolveResourceUnavailable([notFound, read('loading')], { notFoundIsMissing: true }), 'error')
  assert.equal(resolveResourceUnavailable([notFound, notFound], { notFoundIsMissing: true }), 'error')
})
