/** The account-stack cookie primitives (multi-account §12 — GitHub-style
 *  remembered accounts, server/auth.ts): sign/verify round-trip, tamper
 *  refusal, per-entry expiry, the dedupe/front/cap merge, and the cookie
 *  posture. Same trust construction as the session token — HMAC over public
 *  claims — so the failure mode is always "no remembered accounts", never a
 *  guessed one. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STACK_COOKIE,
  STACK_MAX,
  signStack,
  stackClearCookie,
  stackSetCookie,
  stackWith,
  stackWithout,
  verifyStack,
  type StackEntry,
} from '../server/auth.ts'

const entry = (userId: string, tenantId = `${userId}-home`, iat = Date.now()): StackEntry => ({ userId, tenantId, iat })

test('sign/verify round-trips; tampering or garbage degrades to []', () => {
  const entries = [entry('user-a'), entry('user-b')]
  const token = signStack(entries)
  assert.deepEqual(verifyStack(token), entries)

  const [payload, sig] = token.split('.')
  const forged = Buffer.from(JSON.stringify([entry('user-evil')])).toString('base64url')
  assert.deepEqual(verifyStack(`${forged}.${sig}`), [], 'a re-targeted payload fails the signature')
  assert.deepEqual(verifyStack(`${payload}.${Buffer.from('nope').toString('base64url')}`), [], 'a wrong signature fails')
  assert.deepEqual(verifyStack('garbage'), [])
  assert.deepEqual(verifyStack(''), [])
  assert.deepEqual(verifyStack(undefined), [])
  // A validly-signed NON-ARRAY payload is refused by shape.
  const obj = Buffer.from(JSON.stringify({ userId: 'user-a' })).toString('base64url')
  assert.deepEqual(verifyStack(signStack([])) , [], 'an empty stack round-trips to empty')
  assert.deepEqual(verifyStack(`${obj}.${sig}`), [], 'a non-array payload fails (signature or shape)')
})

test('entries expire individually — a stale sibling never takes the fresh ones with it', () => {
  const fresh = entry('user-fresh')
  const stale = entry('user-stale', 'tenant-x', Date.now() - 365 * 24 * 3600 * 1000)
  assert.deepEqual(verifyStack(signStack([stale, fresh])), [fresh])
})

test('malformed entries are dropped, valid siblings kept', () => {
  const good = entry('user-good')
  const bad = { userId: 42, tenantId: 'tenant-x', iat: Date.now() } as unknown as StackEntry
  assert.deepEqual(verifyStack(signStack([bad, good])), [good])
})

test('stackWith: newest first, deduped by user (a re-sign-in refreshes tenant + iat), capped', () => {
  const a = entry('user-a', 'tenant-a1')
  const b = entry('user-b')
  const merged = stackWith([a, b], entry('user-a', 'tenant-a2'))
  assert.equal(merged.length, 2)
  assert.equal(merged[0].userId, 'user-a')
  assert.equal(merged[0].tenantId, 'tenant-a2', 'the refreshed entry records the new last-active tenant')
  assert.equal(merged[1].userId, 'user-b')

  let stack: StackEntry[] = []
  for (let i = 0; i < STACK_MAX + 3; i++) stack = stackWith(stack, entry(`user-${i}`))
  assert.equal(stack.length, STACK_MAX, 'bounded so a hostile client cannot grow the cookie unbounded')
  assert.equal(stack[0].userId, `user-${STACK_MAX + 2}`, 'the newest survives the cap')
})

test('stackWithout forgets exactly that account', () => {
  const rest = stackWithout([entry('user-a'), entry('user-b')], 'user-a')
  assert.equal(rest.length, 1)
  assert.equal(rest[0].userId, 'user-b')
})

test('the stack cookie wears the session posture; an empty stack clears the cookie', () => {
  const set = stackSetCookie([entry('user-a')])
  assert.ok(set.startsWith(`${STACK_COOKIE}=`))
  assert.match(set, /HttpOnly/, 'not readable from script')
  assert.match(set, /SameSite=Lax/)
  assert.match(set, /Path=\//)
  assert.doesNotMatch(set, /Max-Age=0/)
  assert.match(stackSetCookie([]), /Max-Age=0/, 'empty = cleared, not an empty signed token')
  assert.match(stackClearCookie(), /Max-Age=0/)
})
