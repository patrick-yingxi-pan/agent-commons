import { oauthHttpsUrl, oauthScopes } from './mcpOAuthMetadata.mjs'

export class McpOAuthChallengeError extends Error {
  constructor() {
    super('The MCP authentication challenge is invalid.')
    this.name = 'McpOAuthChallengeError'
    this.code = 'invalid'
  }
}

const fail = () => { throw new McpOAuthChallengeError() }
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const TOKEN68 = /^[A-Za-z0-9\-._~+/]+=*$/
const MAX_BYTES = 8 * 1024
const MAX_CHALLENGES = 16
const MAX_PARAMS = 32
const MAX_EMPTY_MEMBERS = 32

function parseHeader(raw) {
  if (raw === undefined || raw === null) return ''
  const values = Array.isArray(raw) ? raw : [raw]
  if (values.length > MAX_CHALLENGES * 4 || values.some(value => typeof value !== 'string')) fail()
  const size = values.reduce((total, value) => total + Buffer.byteLength(value, 'utf8'), Math.max(0, values.length - 1))
  if (size > MAX_BYTES) fail()
  return values.join(',')
}

function parseChallenges(header) {
  const challenges = []
  let emptyMembers = 0
  let index = 0
  const skipOws = () => { while (header[index] === ' ' || header[index] === '\t') index++ }
  const readToken = () => {
    const start = index
    while (index < header.length && /[!#$%&'*+\-.^_`|~0-9A-Za-z]/.test(header[index])) index++
    if (start === index) fail()
    return header.slice(start, index)
  }
  const parseValue = () => {
    if (header[index] !== '"') return readToken()
    index++
    let value = ''
    while (index < header.length) {
      const character = header[index++]
      if (character === '"') return value
      if (character === '\\') {
        if (index >= header.length) fail()
        const escaped = header[index++]
        const code = escaped.charCodeAt(0)
        if (!(escaped === '\t' || code === 0x20 || (code >= 0x21 && code <= 0x7e) || (code >= 0x80 && code <= 0xff))) fail()
        value += escaped
      } else {
        const code = character.charCodeAt(0)
        if (!(character === '\t' || code === 0x20 || code === 0x21 || (code >= 0x23 && code <= 0x5b) ||
          (code >= 0x5d && code <= 0x7e) || (code >= 0x80 && code <= 0xff))) fail()
        value += character
      }
    }
    fail()
  }

  skipOws()
  while (index < header.length) {
    if (header[index] === ',') {
      if (++emptyMembers > MAX_EMPTY_MEMBERS) fail()
      index++
      skipOws()
      continue
    }
    if (challenges.length >= MAX_CHALLENGES) fail()
    const scheme = readToken().toLowerCase()
    const params = new Map()
    let token68
    const afterScheme = index
    skipOws()
    if (index > afterScheme && index < header.length && header[index] !== ',') {
      // token68 is a single opaque payload. Otherwise parse auth-param pairs;
      // a comma followed by token BWS '=' is another parameter, not a scheme.
      const payloadStart = index
      while (index < header.length && header[index] !== ',' && header[index] !== ' ' && header[index] !== '\t') index++
      const payload = header.slice(payloadStart, index)
      const afterPayload = index
      skipOws()
      const hasAuthParamEquals = TOKEN.test(payload) && header[index] === '='
      index = afterPayload
      if (TOKEN68.test(payload) && !hasAuthParamEquals) {
        // A bare `scope=`/`resource_metadata=` could be a token68 credential or
        // an accidentally truncated known Bearer parameter. Refuse this
        // ambiguous spelling rather than silently treating the hint as absent.
        if (scheme === 'bearer' && /^(?:scope|resource_metadata)=$/i.test(payload)) fail()
        skipOws()
        if (index < header.length && header[index] !== ',') fail()
        token68 = payload
      } else {
        index = payloadStart
        let count = 0
        while (true) {
          if (++count > MAX_PARAMS) fail()
          const name = readToken().toLowerCase()
          skipOws()
          if (header[index++] !== '=') fail()
          skipOws()
          const value = parseValue()
          if (params.has(name)) fail()
          params.set(name, value)
          skipOws()
          if (index >= header.length || header[index] !== ',') break
          const commaIndex = index
          index++
          skipOws()
          let skippedEmpty = 0
          while (index < header.length && header[index] === ',') {
            if (++skippedEmpty > MAX_EMPTY_MEMBERS || emptyMembers + skippedEmpty > MAX_EMPTY_MEMBERS) fail()
            index++
            skipOws()
          }
          if (index >= header.length) { index = commaIndex; break }
          const lookahead = index
          readToken()
          skipOws()
          const continuesParams = header[index] === '='
          if (continuesParams) emptyMembers += skippedEmpty
          index = continuesParams ? lookahead : commaIndex
          if (!continuesParams) break
        }
      }
    }
    challenges.push({ scheme, params, token68 })
    skipOws()
    if (index >= header.length) break
    if (header[index++] !== ',') fail()
    skipOws()
  }
  return challenges
}

/** Parse only RFC 9728 hints from Bearer challenges. These hints never grant
 * authority: callers must present them for an explicit user review. */
export function parseMcpOAuthChallenge(raw) {
  const header = parseHeader(raw)
  if (!header) return Object.freeze({})
  const challenges = parseChallenges(header)
  const bearer = challenges.filter(challenge => challenge.scheme === 'bearer')
  if (bearer.length === 0) return Object.freeze({})
  const parsed = bearer.map(({ params }) => {
    const result = {}
    try {
      if (params.has('resource_metadata')) result.resourceMetadataUrl = oauthHttpsUrl(params.get('resource_metadata'))
      if (params.has('scope')) {
        const rawScopes = params.get('scope')
        const scopes = rawScopes.split(' ')
        if (scopes.some(scope => scope.length === 0)) fail()
        result.scopes = oauthScopes(scopes)
      }
    } catch { fail() }
    return result
  })
  const canonical = JSON.stringify(parsed[0])
  if (parsed.some(candidate => JSON.stringify(candidate) !== canonical)) fail()
  return Object.freeze(parsed[0])
}
