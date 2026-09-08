/** Owns native credential ordering independently of IPC acknowledgement clocks.
 * A timed-out IPC call may still finish its disk write; the next snapshot must
 * remain behind it, never race a late cleanup against a newer credential. */
import { isMcpBinding, isMcpCredentialReference, MCP_CREDENTIAL_MAX_BINDINGS } from './mcpCredentialProtocol.mjs'

const copyBinding = binding => ({ tenantId: binding.tenantId, connectionId: binding.connectionId, endpoint: binding.endpoint })
const audience = binding => JSON.stringify([binding.tenantId, binding.connectionId, binding.endpoint])

export function createMcpCredentialLifecycle(vault) {
  let initialized = false
  let authoritative = new Map()
  const provisionals = new Map()
  const pendingCleanup = new Map()
  let mutations = Promise.resolve()
  const enqueue = operation => {
    const result = mutations.then(operation)
    mutations = result.then(() => undefined, () => undefined)
    return result
  }
  return {
    provision(binding, secret) {
      if (!isMcpBinding(binding)) return Promise.reject(new Error('The MCP credential binding is invalid.'))
      const frozen = copyBinding(binding)
      return enqueue(async () => {
        const reference = await vault.provision(frozen, secret)
        provisionals.set(reference, frozen)
        return reference
      })
    },
    synchronize(bindings) {
      if (!Array.isArray(bindings) || bindings.length > MCP_CREDENTIAL_MAX_BINDINGS) {
        return Promise.reject(new Error('The MCP credential bindings are invalid.'))
      }
      const next = new Map()
      const audiences = new Set()
      for (const entry of bindings) {
        if (!entry || !isMcpCredentialReference(entry.reference) || !isMcpBinding(entry.binding) ||
            next.has(entry.reference) || audiences.has(audience(entry.binding))) {
          return Promise.reject(new Error('The MCP credential bindings are invalid.'))
        }
        next.set(entry.reference, copyBinding(entry.binding))
        audiences.add(audience(entry.binding))
      }
      return enqueue(async () => {
        if (!initialized) {
          const effective = new Map(next)
          for (const [reference, binding] of provisionals) {
            if (!effective.has(reference)) {
              if (audiences.has(audience(binding))) return false
              effective.set(reference, binding)
            }
          }
          await vault.reconcile([...effective].map(([reference, binding]) => ({ reference, binding })))
          initialized = true
        } else {
          for (const [reference, binding] of authoritative) {
            if (!next.has(reference)) pendingCleanup.set(reference, binding)
          }
          for (const reference of pendingCleanup.keys()) {
            if (next.has(reference)) pendingCleanup.delete(reference)
          }
          for (const [reference, binding] of pendingCleanup) {
            try {
              await vault.discard(reference, binding)
              pendingCleanup.delete(reference)
            } catch { /* Retain exact retirement for the next explicit sync. */ }
          }
        }
        authoritative = next
        for (const reference of provisionals.keys()) {
          if (next.has(reference)) provisionals.delete(reference)
        }
        return pendingCleanup.size === 0
      })
    },
  }
}
