import { isIP } from 'node:net'

/** Keep endpoint admission bounded before URL parsing or downstream I/O. */
export const MAX_OUTBOUND_URL_LENGTH = 2048

/** A stable, non-reflective error for configuration and route callers. */
export class OutboundAddressError extends Error {
  constructor() {
    super('Invalid outbound endpoint.')
    this.name = 'OutboundAddressError'
    this.code = 'invalid_outbound_endpoint'
  }
}

const IPV4_DENY_RANGES = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
  [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
  [0xc0586300, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24],
  [0xcb007100, 24], [0xe0000000, 4], [0xf0000000, 4],
]

const IPV6_DENY_PREFIXES = [
  ['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:1::', 48], ['2001:2::', 48], ['2001:10::', 28],
  ['2001:20::', 28], ['2001:30::', 28], ['2001:4:112::', 48], ['2001:db8::', 32],
  ['2002::', 16], ['2620:4f:8000::', 48], ['3ffe::', 16], ['3fff::', 20],
  ['5f00::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]

function ipv4Value(address) {
  if (isIP(address) !== 4) return null
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0
}

function ipv6Words(address) {
  if (isIP(address) !== 6 || address.includes('%')) return null
  let source = address
  if (source.includes('.')) {
    const colon = source.lastIndexOf(':')
    if (colon < 0) return null
    const octets = source.slice(colon + 1).split('.').map(Number)
    if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null
    const high = ((octets[0] << 8) | octets[1]).toString(16)
    const low = ((octets[2] << 8) | octets[3]).toString(16)
    source = `${source.slice(0, colon)}:${high}:${low}`
  }
  const halves = source.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (left.some(word => !/^[0-9a-f]{1,4}$/i.test(word)) || right.some(word => !/^[0-9a-f]{1,4}$/i.test(word))) return null
  const missing = 8 - left.length - right.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  return [...left, ...Array.from({ length: missing }, () => '0'), ...right].map(word => Number.parseInt(word, 16))
}

function ipv6Value(address) {
  const words = ipv6Words(address)
  if (!words) return null
  return words.reduce((value, word) => (value << 16n) | BigInt(word), 0n)
}

function inIpv4Prefix(value, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return ((value & mask) >>> 0) === (base >>> 0)
}

function inIpv6Prefix(value, base, bits) {
  const baseValue = ipv6Value(base)
  if (baseValue === null || bits < 0 || bits > 128) return false
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits)
  return (value & mask) === (baseValue & mask)
}

/** Return true only for a literal globally routable unicast address. DNS names
 * are deliberately false: the transport must resolve every answer and call
 * this predicate before connecting, including on redirects/retries. */
export function isPublicAddress(address) {
  if (typeof address !== 'string') return false
  const v4 = ipv4Value(address)
  if (v4 !== null) return !IPV4_DENY_RANGES.some(([base, bits]) => inIpv4Prefix(v4, base, bits))
  const v6 = ipv6Value(address)
  if (v6 === null || (v6 >> 125n) !== 1n) return false
  return !IPV6_DENY_PREFIXES.some(([base, bits]) => inIpv6Prefix(v6, base, bits))
}

function reject() { throw new OutboundAddressError() }

function hasControlOrEncodedControl(value) {
  if (/[\u0000-\u0020\u007f-\u009f]/.test(value)) return true
  return /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)
}

function obviousLocalHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.localdomain')
}

function literalHostname(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function rawAuthorityHostname(raw) {
  const schemeEnd = raw.indexOf('://')
  if (schemeEnd < 0) return null
  const authorityStart = schemeEnd + 3
  const ends = [raw.indexOf('/', authorityStart), raw.indexOf('?', authorityStart), raw.indexOf('#', authorityStart)].filter(index => index >= 0)
  const authorityEnd = ends.length === 0 ? -1 : Math.min(...ends)
  const authority = raw.slice(authorityStart, authorityEnd < 0 ? raw.length : authorityEnd)
  const at = authority.lastIndexOf('@')
  const hostPort = at < 0 ? authority : authority.slice(at + 1)
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']')
    return close < 0 ? null : hostPort.slice(0, close + 1)
  }
  const colon = hostPort.lastIndexOf(':')
  return colon >= 0 && hostPort.indexOf(':') === colon ? hostPort.slice(0, colon) : hostPort
}

/** Parse and admit an outbound endpoint without performing I/O. A public DNS
 * name is syntax-admissible here, but its resolved addresses remain subject to
 * `isPublicAddress` by the transport that opens the connection. */
export function parseOutboundEndpoint(raw, scope) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_OUTBOUND_URL_LENGTH || hasControlOrEncodedControl(raw) || raw.includes('#')) reject()
  if (scope !== 'public' && scope !== 'loopback') reject()
  let endpoint
  try { endpoint = new URL(raw) } catch { return reject() }
  if (endpoint.username || endpoint.password || endpoint.hostname.length === 0) reject()
  if (scope === 'public' ? endpoint.protocol !== 'https:' : !['http:', 'https:'].includes(endpoint.protocol)) reject()
  if (endpoint.port && (!/^\d+$/.test(endpoint.port) || Number(endpoint.port) < 1 || Number(endpoint.port) > 65535)) reject()
  const hostname = endpoint.hostname
  const literal = literalHostname(hostname)
  const addressKind = isIP(literal)
  if (scope === 'loopback') {
    const rawHost = rawAuthorityHostname(raw)
    if (!((rawHost === '127.0.0.1' && literal === '127.0.0.1' && addressKind === 4) || (rawHost === '[::1]' && literal === '::1' && addressKind === 6))) reject()
  } else if (addressKind !== 0 ? !isPublicAddress(literal) : obviousLocalHostname(hostname)) {
    reject()
  }
  return endpoint
}
