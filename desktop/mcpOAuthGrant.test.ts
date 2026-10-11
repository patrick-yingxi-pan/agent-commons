import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  McpOAuthGrantError,
  mcpOAuthGrantAuthority,
  snapshotMcpOAuthGrant,
  snapshotMcpOAuthGrantAuthority,
} from './mcpOAuthGrant.mjs'

const authority = () => ({
  issuer: 'https://login.example.test/tenant',
  tokenEndpoint: 'https://login.example.test/token',
  clientId: 'desktop-client',
  resource: 'https://mcp.example.test/agent',
  scopes: ['files:read', 'profile'],
})
const grant = (extra: Record<string, unknown> = {}) => ({
  ...authority(), accessToken: 'access_token-1', expiresAt: 1_900_000_000_000, ...extra,
})
const invalid = (fn: () => unknown) => assert.throws(fn, (error: unknown) =>
  error instanceof McpOAuthGrantError && error.message === 'The MCP OAuth grant is invalid.' && error.code === 'invalid')

test('grant validation detaches and freezes the exact native record and authority projection', () => {
  const source = grant({ refreshToken: 'refresh token-1' })
  const captured = snapshotMcpOAuthGrant(source)
  source.scopes[0] = 'changed'
  source.accessToken = 'changed'
  assert.equal(captured.accessToken, 'access_token-1')
  assert.deepEqual(captured.scopes, ['files:read', 'profile'])
  assert.ok(Object.isFrozen(captured) && Object.isFrozen(captured.scopes))
  assert.deepEqual(mcpOAuthGrantAuthority(captured), snapshotMcpOAuthGrantAuthority(authority()))
  assert.deepEqual(Object.keys(mcpOAuthGrantAuthority(captured)).sort(), ['clientId', 'issuer', 'resource', 'scopes', 'tokenEndpoint'])
  assert.equal(Object.hasOwn(mcpOAuthGrantAuthority(captured), 'accessToken'), false)
  assert.equal(snapshotMcpOAuthGrant(grant({ expiresAt: null })).expiresAt, null)
})

test('grant records and authority snapshots require exact keys and plain detached JSON', () => {
  invalid(() => snapshotMcpOAuthGrant({ ...grant(), extra: true }))
  invalid(() => snapshotMcpOAuthGrant(Object.fromEntries(Object.entries(grant()).filter(([key]) => key !== 'expiresAt'))))
  invalid(() => snapshotMcpOAuthGrantAuthority({ ...authority(), accessToken: 'secret' }))
  invalid(() => snapshotMcpOAuthGrantAuthority({ ...authority(), scopes: ['ok'], extra: 1 }))
  invalid(() => snapshotMcpOAuthGrant(Object.assign(Object.create({ inherited: true }), grant())))
  let calls = 0
  const accessor = grant()
  Object.defineProperty(accessor, 'accessToken', { enumerable: true, get() { calls += 1; return 'should-not-run' } })
  invalid(() => snapshotMcpOAuthGrant(accessor))
  assert.equal(calls, 0)
  const toJson = grant() as Record<string, unknown>
  Object.defineProperty(toJson, 'toJSON', { value() { calls += 1; return grant() } })
  invalid(() => snapshotMcpOAuthGrant(toJson))
  assert.equal(calls, 0)
  invalid(() => snapshotMcpOAuthGrant(new Proxy(grant(), { ownKeys() { throw new Error('untrusted') } })))
  invalid(() => snapshotMcpOAuthGrant(grant({ accessToken: 'x'.repeat(65 * 1024) })))
})

test('grant identity URLs are validated but preserved exactly and resource aliases are refused', () => {
  const input = grant({
    issuer: 'HTTPS://LOGIN.EXAMPLE.TEST:443/tenant',
    tokenEndpoint: 'HTTPS://LOGIN.EXAMPLE.TEST:443/token',
    resource: 'https://mcp.example.test/agent',
  })
  const captured = snapshotMcpOAuthGrant(input)
  assert.equal(captured.issuer, input.issuer)
  assert.equal(captured.tokenEndpoint, input.tokenEndpoint)
  for (const resource of [
    'https://MCP.example.test/agent',
    'https://mcp.example.test:443/agent',
    'https://mcp.example.test/x/../agent',
    'https://mcp.example.test/',
    'https://mcp.example.test/%2e/agent',
  ]) invalid(() => snapshotMcpOAuthGrant(grant({ resource })))
  invalid(() => snapshotMcpOAuthGrant(grant({ issuer: 'https://user@login.example.test' })))
  invalid(() => snapshotMcpOAuthGrant(grant({ issuer: 'https://login.example.test/?' })))
  invalid(() => snapshotMcpOAuthGrant(grant({ tokenEndpoint: 'http://login.example.test/token' })))
  invalid(() => snapshotMcpOAuthGrant(grant({ tokenEndpoint: 'https://login.example.test/token#fragment' })))
})

test('credential fields enforce bounded OAuth VSCHAR and bearer character rules', () => {
  assert.equal(snapshotMcpOAuthGrant(grant({ clientId: 'client id', refreshToken: 'refresh token' })).clientId, 'client id')
  for (const clientId of ['', 'x'.repeat(2_049), 'bad\nclient']) invalid(() => snapshotMcpOAuthGrant(grant({ clientId })))
  for (const accessToken of ['', 'has space', 'has\nnewline', 'x'.repeat(8_193)]) invalid(() => snapshotMcpOAuthGrant(grant({ accessToken })))
  for (const refreshToken of ['', 'x'.repeat(8_193), 'bad\u007f']) invalid(() => snapshotMcpOAuthGrant(grant({ refreshToken })))
  for (const expiresAt of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, '1900000000000']) invalid(() => snapshotMcpOAuthGrant(grant({ expiresAt })))
})

test('scope constraints and canonical resource are revalidated at authority custody', () => {
  invalid(() => snapshotMcpOAuthGrant(grant({ scopes: ['read', 'read'] })))
  invalid(() => snapshotMcpOAuthGrant(grant({ scopes: ['bad scope'] })))
  invalid(() => snapshotMcpOAuthGrant(grant({ scopes: Array(65).fill('read') })))
  invalid(() => snapshotMcpOAuthGrantAuthority({ ...authority(), resource: 'HTTPS://MCP.EXAMPLE.TEST/agent' }))
})
