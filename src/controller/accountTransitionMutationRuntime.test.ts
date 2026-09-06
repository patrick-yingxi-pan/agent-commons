import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Identity } from '../../contract/index.ts'
import { createAccountTransitionMutationRuntime } from './accountTransitionMutationRuntime.ts'

const unsignedIdentity: Identity = {
  user: { id: 'user-local', name: 'Local' },
  tenant: { id: 'tenant-personal', name: 'Local', kind: 'personal' },
  role: 'owner',
  local: true,
  via: 'default',
}

test('represented credential refusal returns its form message after exact source truth', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/auth/login')) {
      return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid email or password.' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.endsWith('/me')) return Response.json(unsignedIdentity)
    if (url.endsWith('/auth/accounts')) return Response.json([])
    throw new Error(`Unexpected request: ${url}`)
  }

  const rejected: Array<{ intentId: string; message: string }> = []
  const runtime = createAccountTransitionMutationRuntime(
    () => undefined,
    (intentId, message) => rejected.push({ intentId, message }),
  )
  const outcome = await runtime.enqueue({
    kind: 'credential-sign-in',
    intentId: 'credential-refusal-1',
    sourceUserId: null,
    email: 'person@example.test',
    password: 'wrong-password',
  })

  assert.equal(outcome, 'discarded')
  assert.deepEqual(rejected, [{ intentId: 'credential-refusal-1', message: 'Invalid email or password.' }])
})

test('ambiguous signup remains a retryable creation-specific hold', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/auth/signup')) {
      return new Response(JSON.stringify({ error: { code: 'internal', message: 'Response lost.' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.endsWith('/me')) return Response.json(unsignedIdentity)
    if (url.endsWith('/auth/accounts')) return Response.json([])
    throw new Error(`Unexpected request: ${url}`)
  }

  const statuses: Array<{ error: string | null; retryable: boolean }> = []
  const runtime = createAccountTransitionMutationRuntime(
    (status) => statuses.push(status),
    () => assert.fail('a transport failure is not a represented refusal'),
  )
  const outcome = runtime.enqueue({
    kind: 'credential-sign-up',
    intentId: 'credential-signup-1',
    sourceUserId: null,
    name: 'New Person',
    email: 'new-person@example.test',
    password: 'new-person-password',
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(statuses.at(-1)?.error, 'Couldn’t confirm whether the account was created. Retry safely.')
  assert.equal(statuses.at(-1)?.retryable, true)
  runtime.clearAll()
  assert.equal(await outcome, 'discarded')
})
