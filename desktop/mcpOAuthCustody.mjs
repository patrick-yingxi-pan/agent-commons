/** Native-only typed custody over the existing serialized encrypted vault.
 * No renderer/API exports, disk paths, network dispatch or tool permission. */
import { snapshotOAuthJson } from './mcpOAuthMetadata.mjs'
import { snapshotMcpOAuthGrant, snapshotMcpOAuthGrantAuthority, mcpOAuthGrantAuthority } from './mcpOAuthGrant.mjs'

const fail = () => { throw new Error('The native OAuth credential is unavailable.') }
const owner = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[\x20-\x7e]+$/.test(value)
const generation = value => Number.isSafeInteger(value) && value >= 0
const exact = (value, keys) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const current = isCurrent => {
  const result = typeof isCurrent === 'function' && isCurrent()
  if (result instanceof Promise) result.catch(() => {})
  if (result !== true) fail()
}

export function snapshotMcpOAuthCustody(raw) {
  try {
    const value = snapshotOAuthJson(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value) || !owner(value.ownerId) || !generation(value.generation)) fail()
    if (value.state === 'ready' && exact(value, ['ownerId', 'generation', 'state', 'grant'])) {
      return Object.freeze({ ownerId: value.ownerId, generation: value.generation, state: 'ready', grant: snapshotMcpOAuthGrant(value.grant) })
    }
    if (value.state === 'refreshing' && exact(value, ['ownerId', 'generation', 'state', 'authority'])) {
      return Object.freeze({ ownerId: value.ownerId, generation: value.generation, state: 'refreshing', authority: snapshotMcpOAuthGrantAuthority(value.authority) })
    }
    fail()
  } catch { fail() }
}

/** These storage capabilities are private to the vault instance. Mutate shares
 * bearer provisioning/cleanup's disk queue; beforePublish runs after encryption.
 * Tickets are object identities in memory, never serializable restart authority. */
export function createMcpOAuthCustody({ provision, read, mutate }) {
  const active = new Map()
  const owned = (payload, ownerId) => {
    if (!owner(ownerId) || !payload?.oauth || payload.oauth.ownerId !== ownerId) fail()
    return payload.oauth
  }
  return {
    provisionOAuth(binding, ownerId, rawGrant, isCurrent = () => true) {
      const oauth = snapshotMcpOAuthCustody({ ownerId, generation: 0, state: 'ready', grant: rawGrant })
      const check = () => current(isCurrent)
      check()
      return provision(binding, { oauth }, check)
    },
    async readOAuth(reference, binding, ownerId) {
      const value = owned(await read(reference, binding), ownerId)
      if (value.state === 'ready') return value
      return Object.freeze({ ...value, state: active.has(reference) ? 'refreshing' : 'reauthorization-required' })
    },
    async reserveOAuthRefresh(reference, binding, ownerId, expectedGeneration, isCurrent) {
      if (!generation(expectedGeneration)) fail()
      const ticket = Object.freeze({})
      let grant
      const check = () => current(isCurrent)
      await mutate(reference, binding, payload => {
        check()
        const value = owned(payload, ownerId)
        if (value.state !== 'ready' || value.generation !== expectedGeneration || !value.grant.refreshToken ||
            value.generation === Number.MAX_SAFE_INTEGER || active.has(reference)) fail()
        grant = value.grant
        return { oauth: snapshotMcpOAuthCustody({ ownerId, generation: value.generation + 1,
          state: 'refreshing', authority: mcpOAuthGrantAuthority(grant) }) }
      }, check)
      // The old tokens have been removed from the durable entry before they can
      // be handed to an exchange. A crash now requires a fresh sign-in.
      active.set(reference, ticket)
      return Object.freeze({ ticket, grant })
    },
    async completeOAuthRefresh(reference, binding, ownerId, ticket, rawGrant, isCurrent) {
      const grant = snapshotMcpOAuthGrant(rawGrant)
      const check = () => {
        if (!active.has(reference) || active.get(reference) !== ticket) fail()
        current(isCurrent)
      }
      await mutate(reference, binding, payload => {
        check()
        const value = owned(payload, ownerId)
        if (value.state !== 'refreshing') fail()
        const prior = value.authority
        if (['issuer', 'tokenEndpoint', 'clientId', 'resource'].some(key => grant[key] !== prior[key]) ||
            grant.scopes.some(scope => !prior.scopes.includes(scope))) fail()
        return { oauth: snapshotMcpOAuthCustody({ ownerId, generation: value.generation, state: 'ready', grant }) }
      }, check)
      if (active.get(reference) === ticket) active.delete(reference)
    },
    abandonOAuthRefresh(reference, ticket) {
      if (active.get(reference) === ticket) active.delete(reference)
    },
  }
}
