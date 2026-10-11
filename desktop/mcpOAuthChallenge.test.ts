import { test } from 'node:test'
import assert from 'node:assert/strict'
import { McpOAuthChallengeError, parseMcpOAuthChallenge } from './mcpOAuthChallenge.mjs'

function invalid(value: unknown) {
  assert.throws(() => parseMcpOAuthChallenge(value), error =>
    error instanceof McpOAuthChallengeError && error.code === 'invalid' &&
    error.message === 'The MCP authentication challenge is invalid.')
}

test('absent and non-Bearer challenges return a frozen empty hint without poisoning later Bearer parsing', () => {
  for (const absent of [undefined, null, '', []]) {
    const result = parseMcpOAuthChallenge(absent)
    assert.deepEqual(result, {})
    assert.ok(Object.isFrozen(result))
  }
  assert.deepEqual(parseMcpOAuthChallenge('Basic realm="one, two", Negotiate YWJj=='), {})
  assert.deepEqual(parseMcpOAuthChallenge([
    'Basic realm="private, realm"',
    'Negotiate YWJj==, bEaReR RESOURCE_METADATA="https://mcp.example.test/.well-known/oauth-protected-resource", SCOPE="files:read profile"',
  ]), {
    resourceMetadataUrl: 'https://mcp.example.test/.well-known/oauth-protected-resource',
    scopes: ['files:read', 'profile'],
  })
})

test('parses combined challenges, auth-param continuations and quoted strings without splitting quoted commas', () => {
  const parsed = parseMcpOAuthChallenge(
    'Digest realm="realm, with comma", qop="auth, auth-int", nonce="a\\\"b", Basic YWJj==, Bearer scope="files:read profile", resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource?region=a,b"',
  )
  assert.deepEqual(parsed, {
    resourceMetadataUrl: 'https://mcp.example.test/.well-known/oauth-protected-resource?region=a,b',
    scopes: ['files:read', 'profile'],
  })
  assert.ok(Object.isFrozen(parsed))
  assert.ok(Object.isFrozen(parsed.scopes))
})

test('accepts BWS around auth-param equals in the first and subsequent parameters', () => {
  assert.deepEqual(parseMcpOAuthChallenge('Bearer realm = "x", resource_metadata = "https://example.com/meta"'), {
    resourceMetadataUrl: 'https://example.com/meta',
  })
  assert.deepEqual(parseMcpOAuthChallenge('Basic realm = "other", Bearer scope = "read"'), {
    scopes: ['read'],
  })
})

test('ignores bounded empty challenge-list members as required by HTTP recipient list parsing', () => {
  assert.deepEqual(parseMcpOAuthChallenge(', , Bearer scope="read", , Basic realm="x",'), { scopes: ['read'] })
  assert.deepEqual(parseMcpOAuthChallenge('Bearer realm="x", , scope="read", , resource_metadata="https://example.com/meta"'), {
    resourceMetadataUrl: 'https://example.com/meta',
    scopes: ['read'],
  })
  invalid(`${','.repeat(33)}Bearer scope="read"`)
  invalid(`Bearer realm="x",${',,'.repeat(17)}scope="read"`)
  for (const empty of [' \t', ', , ,', ','.repeat(32), [' ', ', ', '']]) {
    const result = parseMcpOAuthChallenge(empty)
    assert.deepEqual(result, {})
    assert.ok(Object.isFrozen(result))
  }
  invalid(','.repeat(33))
})

test('Bearer token68 and Bearer with no relevant hints produce no authority-bearing result', () => {
  assert.deepEqual(parseMcpOAuthChallenge('Bearer abc.DEF_-/+=='), {})
  assert.deepEqual(parseMcpOAuthChallenge('Bearer realm="mcp", error="invalid_token"'), {})
  assert.deepEqual(parseMcpOAuthChallenge('Basic realm="x", Bearer'), {})
})

test('parameter names are case-insensitive, but duplicate and conflicting Bearer hints are refused', () => {
  invalid('Bearer Scope="files:read", scope="files:read"')
  invalid('Bearer resource_metadata="https://one.example.test/r", RESOURCE_METADATA="https://one.example.test/r"')
  invalid('Bearer scope="files:read", Bearer scope="files:write"')
  invalid('Bearer scope="files:read", Bearer')
  assert.deepEqual(
    parseMcpOAuthChallenge('Bearer scope="files:read", Bearer scope="files:read"'),
    { scopes: ['files:read'] },
  )
})

test('rejects malformed challenge grammar, bad URLs/scopes, and never reflects attacker text', () => {
  const secret = 'private-token-canary'
  for (const value of [
    'Bearer scope="files:read',
    'Bearer scope=',
    'Bearer scope="files:read" garbage',
    'Bearer resource_metadata="http://mcp.example.test/metadata"',
    'Bearer resource_metadata="https://user:password@mcp.example.test/metadata"',
    'Bearer resource_metadata="https://mcp.example.test/metadata#fragment"',
    'Bearer scope="files:read  profile"',
    'Bearer scope="files:read files:read"',
    `Bearer error_description="${secret}"` + ', Bearer scope="files:read", scope="files:write"',
  ]) {
    assert.throws(() => parseMcpOAuthChallenge(value), error => {
      assert.ok(error instanceof McpOAuthChallengeError)
      assert.equal(error.message.includes(secret), false)
      return true
    })
  }
})

test('bounds aggregate header bytes, challenge count and per-challenge parameters', () => {
  invalid(`Bearer realm="${'x'.repeat(8 * 1024)}"`)
  invalid(Array.from({ length: 17 }, (_, index) => `Scheme${index}`))
  invalid(`Bearer ${Array.from({ length: 33 }, (_, index) => `p${index}=v`).join(',')}`)
  assert.deepEqual(parseMcpOAuthChallenge('Basic ' + 'a'.repeat(1_024)), {})
})

test('rejects invalid header input types and invalid array fields with a fixed error', () => {
  invalid(42)
  invalid(['Basic realm="valid"', 5])
  invalid('Bearer scope="files:read"\r\nInjected: yes')
})
