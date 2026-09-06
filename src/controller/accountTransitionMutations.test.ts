import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Identity } from '../../contract/index.ts'
import {
  enqueueCredentialAccountTransition,
  heldAccountTransition,
} from './accountTransitionMutations.ts'

const unsignedIdentity: Identity = {
  user: { id: 'user-local', name: 'Local' },
  tenant: { id: 'tenant-personal', name: 'Local', kind: 'personal' },
  role: 'owner',
  local: true,
  via: 'default',
}

test('credential facade returns represented refusal and releases its private hold', async (t) => {
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

  const result = await enqueueCredentialAccountTransition({
    kind: 'credential-sign-in',
    email: 'person@example.test',
    password: 'wrong-password',
  })

  assert.deepEqual(result, { ok: false, message: 'Invalid email or password.' })
  assert.equal(heldAccountTransition(), null)
})
