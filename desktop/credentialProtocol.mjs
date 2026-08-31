export const DESKTOP_CREDENTIAL_PREFIX = 'PROVIDER_DESKTOP_'
export const MAX_CREDENTIAL_CHARS = 8_192
export const CREDENTIAL_REQUEST = 'agent-commons:credential-request'
export const CREDENTIAL_RESULT = 'agent-commons:credential-result'
export const CREDENTIAL_BINDINGS = 'agent-commons:credential-bindings'

const REFERENCE_PATTERN = /^PROVIDER_DESKTOP_[A-F0-9]{32}$/
const PROVIDER_ID_PATTERN = /^provider-[A-Za-z0-9_-]{1,120}$/

export function isDesktopCredentialReference(value) {
  return typeof value === 'string' && REFERENCE_PATTERN.test(value)
}

export function isProviderId(value) {
  return typeof value === 'string' && PROVIDER_ID_PATTERN.test(value)
}

export function validCredentialSecret(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_CREDENTIAL_CHARS && !value.includes('\0')
}

/** The utility-process half of the secret handoff. It accepts only generated
 * PROVIDER_DESKTOP_* names, mutates no other environment variable, and returns
 * result metadata that can never contain the credential value. */
export function installCredentialRuntime(parentPort = process.parentPort, env = process.env) {
  if (!parentPort) return null
  parentPort.on('message', (event) => {
    const message = event?.data
    if (!message || message.type !== CREDENTIAL_REQUEST || !Number.isSafeInteger(message.requestId)) return
    const result = { type: CREDENTIAL_RESULT, requestId: message.requestId }
    if (!isDesktopCredentialReference(message.reference)) {
      parentPort.postMessage({ ...result, ok: false, error: 'invalid_reference' })
      return
    }
    if (message.operation === 'set' && validCredentialSecret(message.secret)) {
      env[message.reference] = message.secret
      parentPort.postMessage({ ...result, ok: true })
      return
    }
    if (message.operation === 'delete') {
      delete env[message.reference]
      parentPort.postMessage({ ...result, ok: true })
      return
    }
    parentPort.postMessage({ ...result, ok: false, error: 'invalid_request' })
  })
  return {
    announceBindings(bindings) {
      const safe = Array.isArray(bindings)
        ? bindings.filter((binding) => isDesktopCredentialReference(binding?.reference) && isProviderId(binding?.providerId))
        : []
      parentPort.postMessage({ type: CREDENTIAL_BINDINGS, bindings: safe })
    },
  }
}

/** Main-process request client for the already-supervised backend. Secrets ride
 * only this local memory channel; errors, logs, and acknowledgements never echo
 * them. */
export function createCredentialBackendClient(child, { onBindings = () => {}, timeoutMs = 5_000 } = {}) {
  let sequence = 0
  let closed = false
  const pending = new Map()

  const onMessage = (message) => {
    if (message?.type === CREDENTIAL_BINDINGS) {
      onBindings(Array.isArray(message.bindings) ? message.bindings : [])
      return
    }
    if (message?.type !== CREDENTIAL_RESULT || !Number.isSafeInteger(message.requestId)) return
    const request = pending.get(message.requestId)
    if (!request) return
    pending.delete(message.requestId)
    clearTimeout(request.timeout)
    if (message.ok === true) request.resolve()
    else request.reject(new Error('The local backend refused the credential update.'))
  }
  child.on('message', onMessage)

  const request = (operation, reference, secret) => {
    if (closed) return Promise.reject(new Error('The local backend is not available.'))
    const requestId = (sequence += 1)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error('The local backend did not acknowledge the credential update.'))
      }, timeoutMs)
      pending.set(requestId, { resolve, reject, timeout })
      child.postMessage({ type: CREDENTIAL_REQUEST, requestId, operation, reference, ...(secret === undefined ? {} : { secret }) })
    })
  }

  return {
    set(reference, secret) {
      if (!isDesktopCredentialReference(reference) || !validCredentialSecret(secret)) {
        return Promise.reject(new Error('The credential update is invalid.'))
      }
      return request('set', reference, secret)
    },
    delete(reference) {
      if (!isDesktopCredentialReference(reference)) return Promise.reject(new Error('The credential reference is invalid.'))
      return request('delete', reference)
    },
    close() {
      if (closed) return
      closed = true
      child.off('message', onMessage)
      for (const entry of pending.values()) {
        clearTimeout(entry.timeout)
        entry.reject(new Error('The local backend stopped before applying the credential update.'))
      }
      pending.clear()
    },
  }
}
