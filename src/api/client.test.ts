import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AccountSwitchedError, apiGet } from './client.ts'
import { loadSession } from './commands.ts'
import { switchAccount } from './account.ts'
import { keys } from './keys.ts'
import { peek } from './cache.ts'

test('an aborted session read cannot publish a late noncooperative response body', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  const sessionId = 'aborted-session-publication'
  let release!: () => void
  try {
    switchAccount({ userId: 'user-ada', tenantId: 'tenant-acme' })
    globalThis.fetch = async () => ({
      status: 200, ok: true, statusText: 'OK',
      headers: new Headers({ 'x-resolved-tenant': 'tenant-acme' }),
      text: () => new Promise<string>((resolve) => {
        release = () => resolve(JSON.stringify({ id: sessionId, title: 'late session' }))
      }),
    }) as Response
    const read = loadSession(sessionId, controller.signal)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    controller.abort()
    release()
    await assert.rejects(read, /aborted/i)
    assert.equal(peek(keys.session(sessionId)), undefined)
  } finally {
    globalThis.fetch = originalFetch
    switchAccount(null)
  }
})

test('identity fence rechecks a delayed response body before returning it', async () => {
  const originalFetch = globalThis.fetch
  let release!: () => void
  try {
    globalThis.fetch = async () => ({
      status: 200,
      ok: true,
      statusText: 'OK',
      headers: new Headers({ 'x-resolved-tenant': 'tenant-acme' }),
      text: () => new Promise<string>((resolve) => { release = () => resolve('{"tenant":"acme"}') }),
    }) as Response
    switchAccount({ userId: 'user-ada', tenantId: 'tenant-acme' })
    const read = apiGet<{ tenant: string }>('/delayed')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    switchAccount({ userId: 'user-grace', tenantId: 'tenant-beta' })
    release()
    await assert.rejects(read, (error: unknown) => error instanceof AccountSwitchedError)
  } finally {
    globalThis.fetch = originalFetch
    switchAccount(null)
  }
})

test('loadSession does not publish a body that crosses an account switch', async () => {
  const originalFetch = globalThis.fetch
  const sessionId = 'delayed-body-session-identity-fence'
  let release!: () => void
  try {
    globalThis.fetch = async () => ({
      status: 200,
      ok: true,
      statusText: 'OK',
      headers: new Headers({ 'x-resolved-tenant': 'tenant-acme' }),
      text: () => new Promise<string>((resolve) => {
        release = () => resolve(JSON.stringify({ id: sessionId, title: 'old tenant', caps: ['chat'], preview: '' }))
      }),
    }) as Response
    switchAccount({ userId: 'user-ada', tenantId: 'tenant-acme' })
    const read = loadSession(sessionId)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    switchAccount({ userId: 'user-grace', tenantId: 'tenant-beta' })
    release()
    await assert.rejects(read, (error: unknown) => error instanceof AccountSwitchedError)
    assert.equal(peek(keys.session(sessionId)), undefined)
  } finally {
    globalThis.fetch = originalFetch
    switchAccount(null)
  }
})
