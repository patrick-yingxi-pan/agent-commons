import { isIP } from 'node:net'

/** Keep endpoint admission bounded before URL parsing or downstream I/O. */
export const MAX_OUTBOUND_URL_LENGTH = 2048

/** A stable, non-reflective error for configuration and route callers. */
export class OutboundAddressError extends Error {
  readonly code = 'invalid_outbound_endpoint' as const

  constructor() {
    super('Invalid outbound endpoint.')
    this.name = 'OutboundAddressError'
  }
}

const IPV4_DENY_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8 — self-identification / this host
  [0x0a000000, 8], // 10.0.0.0/8 — private use
  [0x64400000, 10], // 100.64.0.0/10 — shared address space
  [0x7f000000, 8], // 127.0.0.0/8 — loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 — link-local
  [0xac100000, 12], // 172.16.0.0/12 — private use
  [0xc0000000, 24], // 192.0.0.0/24 — IANA special purpose
  [0xc0000200, 24], // 192.0.2.0/24 — TEST-NET-1
  [0xc0586300, 24], // 192.88.99.0/24 — 6to4 relay anycast
  [0xc0a80000, 16], // 192.168.0.0/16 — private use
  [0xc6120000, 15], // 198.18.0.0/15 — benchmarking
  [0xc6336400, 24], // 198.51.100.0/24 — TEST-NET-2
  [0xcb007100, 24], // 203.0.113.0/24 — TEST-NET-3
  [0xe0000000, 4], // 224.0.0.0/4 — multicast
  [0xf0000000, 4], // 240.0.0.0/4 — reserved / future use
]

/** IPv6 blocks which are not ordinary globally routed unicast destinations.
 *  The list follows the IANA special-purpose registry and includes the
 *  IPv4-embedded and transition mechanisms that must not become a private-IP
 *  filter bypass. The 2000::/3 check below rejects the remaining reserved
 *  IPv6 address space. */
const IPV6_DENY_PREFIXES: ReadonlyArray<readonly [string, number]> = [
  ['::', 96], // unspecified, loopback, IPv4-compatible, and mapped forms
  ['64:ff9b::', 96], // well-known IPv4/IPv6 translation
  ['64:ff9b:1::', 48], // IPv4/IPv6 translation (local-use)
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF protocol assignments, including Teredo and reserved subranges
  ['2001:1::', 48], // IANA special purpose
  ['2001:2::', 48], // benchmarking
  ['2001:10::', 28], // ORCHID (deprecated)
  ['2001:20::', 28], // ORCHIDv2
  ['2001:30::', 28], // Drone Remote ID special purpose
  ['2001:4:112::', 48], // AS112 anycast
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['2620:4f:8000::', 48], // AS112 anycast
  ['3ffe::', 16], // 6bone (returned space)
  ['3fff::', 20], // documentation
  ['5f00::', 16], // SRv6 SIDs
  ['fc00::', 7], // unique-local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8], // multicast
]

function ipv4Value(address: string): number | null {
  if (isIP(address) !== 4) return null
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0
}

function ipv6Words(address: string): readonly number[] | null {
  if (isIP(address) !== 6 || address.includes('%')) return null
  let source = address
  if (source.includes('.')) {
    const colon = source.lastIndexOf(':')
    if (colon < 0) return null
    const octets = source.slice(colon + 1).split('.').map(Number)
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null
    const high = ((octets[0] << 8) | octets[1]).toString(16)
    const low = ((octets[2] << 8) | octets[3]).toString(16)
    source = `${source.slice(0, colon)}:${high}:${low}`
  }

  const halves = source.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (left.some((word) => !/^[0-9a-f]{1,4}$/i.test(word)) || right.some((word) => !/^[0-9a-f]{1,4}$/i.test(word))) return null
  const missing = 8 - left.length - right.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  return [...left, ...Array.from({ length: missing }, () => '0'), ...right].map((word) => Number.parseInt(word, 16))
}

function ipv6Value(address: string): bigint | null {
  const words = ipv6Words(address)
  if (!words) return null
  return words.reduce((value, word) => (value << 16n) | BigInt(word), 0n)
}

function inIpv4Prefix(value: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return ((value & mask) >>> 0) === (base >>> 0)
}

function inIpv6Prefix(value: bigint, base: string, bits: number): boolean {
  const baseValue = ipv6Value(base)
  if (baseValue === null || bits < 0 || bits > 128) return false
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits)
  return (value & mask) === (baseValue & mask)
}

/** Return true only for a literal globally routable unicast address. DNS names
 * are deliberately false: the HTTP/SSE transport must resolve every answer
 * and call this predicate before connecting, including on redirects/retries. */
export function isPublicAddress(address: string): boolean {
  if (typeof address !== 'string') return false
  const v4 = ipv4Value(address)
  if (v4 !== null) return !IPV4_DENY_RANGES.some(([base, bits]) => inIpv4Prefix(v4, base, bits))

  const v6 = ipv6Value(address)
  if (v6 === null) return false
  // IANA's assignable global-unicast space is 2000::/3. Everything outside it
  // is reserved, multicast, link-local, or another non-global address class.
  if ((v6 >> 125n) !== 1n) return false
  return !IPV6_DENY_PREFIXES.some(([base, bits]) => inIpv6Prefix(v6, base, bits))
}

function reject(): never {
  throw new OutboundAddressError()
}

function hasControlOrEncodedControl(value: string): boolean {
  if (/[\u0000-\u0020\u007f-\u009f]/.test(value)) return true
  return /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)
}

function obviousLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.localdomain')
}

function literalHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function rawAuthorityHostname(raw: string): string | null {
  const schemeEnd = raw.indexOf('://')
  if (schemeEnd < 0) return null
  const authorityStart = schemeEnd + 3
  const ends = [raw.indexOf('/', authorityStart), raw.indexOf('?', authorityStart), raw.indexOf('#', authorityStart)].filter((index) => index >= 0)
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
export function parseOutboundEndpoint(raw: string, scope: 'public' | 'loopback'): URL {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_OUTBOUND_URL_LENGTH || hasControlOrEncodedControl(raw) || raw.includes('#')) reject()
  if (scope !== 'public' && scope !== 'loopback') reject()

  let endpoint: URL
  try {
    endpoint = new URL(raw)
  } catch {
    return reject()
  }

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
