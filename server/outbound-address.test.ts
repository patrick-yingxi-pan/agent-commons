import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_OUTBOUND_URL_LENGTH,
  OutboundAddressError,
  isPublicAddress,
  parseOutboundEndpoint,
} from './outboundAddress.ts'

function rejects(raw: string, scope: 'public' | 'loopback') {
  assert.throws(
    () => parseOutboundEndpoint(raw, scope),
    (error: unknown) => {
      assert.ok(error instanceof OutboundAddressError)
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'Invalid outbound endpoint.')
      assert.ok(!error.message.includes(raw))
      return true
    },
  )
}

test('public endpoints preserve the path and query while allowing a DNS name for later resolution', () => {
  const endpoint = parseOutboundEndpoint('https://mcp.example.com/sse?session=one', 'public')
  assert.equal(endpoint.protocol, 'https:')
  assert.equal(endpoint.hostname, 'mcp.example.com')
  assert.equal(endpoint.pathname, '/sse')
  assert.equal(endpoint.search, '?session=one')
  assert.equal(endpoint.hash, '')
})

test('public endpoints admit only HTTPS and globally routable literal unicast addresses', () => {
  assert.equal(parseOutboundEndpoint('https://8.8.8.8/mcp', 'public').hostname, '8.8.8.8')
  assert.equal(parseOutboundEndpoint('https://[2001:4860:4860::8888]/mcp', 'public').hostname, '[2001:4860:4860::8888]')
  for (const raw of [
    'http://8.8.8.8/mcp',
    'https://0.0.0.0/mcp',
    'https://10.1.2.3/mcp',
    'https://100.64.1.1/mcp',
    'https://127.0.0.1/mcp',
    'https://169.254.1.1/mcp',
    'https://172.16.0.1/mcp',
    'https://192.0.0.9/mcp',
    'https://192.0.2.1/mcp',
    'https://192.88.99.1/mcp',
    'https://192.168.1.1/mcp',
    'https://198.18.0.1/mcp',
    'https://198.51.100.1/mcp',
    'https://203.0.113.1/mcp',
    'https://224.0.0.1/mcp',
    'https://240.0.0.1/mcp',
    'https://[::]/mcp',
    'https://[::1]/mcp',
    'https://[::ffff:8.8.8.8]/mcp',
    'https://[64:ff9b::808:808]/mcp',
    'https://[100::1]/mcp',
    'https://[2001:0::1]/mcp',
    'https://[2001:1::1]/mcp',
    'https://[2001:2::1]/mcp',
    'https://[2001:5::1]/mcp',
    'https://[2001:db8::1]/mcp',
    'https://[2002:c000:0201::1]/mcp',
    'https://[3ffe::1]/mcp',
    'https://[3fff::1]/mcp',
    'https://[5f00::1]/mcp',
    'https://[fc00::1]/mcp',
    'https://[fe80::1]/mcp',
    'https://[ff02::1]/mcp',
  ]) rejects(raw, 'public')
})

test('public DNS names with obvious local suffixes fail closed', () => {
  for (const raw of [
    'https://localhost/mcp',
    'https://localhost./mcp',
    'https://service.localhost/mcp',
    'https://printer.local/mcp',
    'https://host.localdomain/mcp',
  ]) rejects(raw, 'public')
})

test('loopback scope permits only exact loopback literals over HTTP or HTTPS', () => {
  assert.equal(parseOutboundEndpoint('http://127.0.0.1:8787/mcp?x=1', 'loopback').hostname, '127.0.0.1')
  assert.equal(parseOutboundEndpoint('https://[::1]/mcp', 'loopback').hostname, '[::1]')
  for (const raw of [
    'http://localhost/mcp',
    'http://localhost./mcp',
    'http://127.0.0.2/mcp',
    'http://0177.0.0.1/mcp',
    'http://2130706433/mcp',
    'http://0x7f000001/mcp',
    'http://[0:0:0:0:0:0:0:1]/mcp',
    'http://[::ffff:127.0.0.1]/mcp',
    'http://192.168.1.1/mcp',
    'https://8.8.8.8/mcp',
    'ftp://127.0.0.1/mcp',
  ]) rejects(raw, 'loopback')
})

test('both scopes reject credentials, fragments, controls, malformed ports, and overlong URLs', () => {
  for (const scope of ['public', 'loopback'] as const) {
    for (const raw of [
      'https://user:pass@example.com/mcp',
      'https://example.com/mcp#fragment',
      'https://example.com/mcp#',
      'https://example.com/mcp%0d%0aX-Header: injected',
      'https://example.com/mcp\nnext',
      'https://example.com:0/mcp',
      'https://example.com:65536/mcp',
      'https://example.com:abc/mcp',
      `https://example.com/${'x'.repeat(MAX_OUTBOUND_URL_LENGTH)}`,
    ]) rejects(raw, scope)
  }
})

test('isPublicAddress is a pure literal-address predicate with no hostname or mapped-address shortcuts', () => {
  for (const address of [
    '8.8.8.8',
    '1.1.1.1',
    '2001:4860:4860::8888',
  ]) assert.equal(isPublicAddress(address), true, address)

  for (const address of [
    'example.com',
    'localhost',
    '127.0.0.1',
    '::1',
    '::ffff:8.8.8.8',
    '2001:db8::1',
    'fe80::1%25en0',
    '',
    'not an address',
  ]) assert.equal(isPublicAddress(address), false, address)
})
