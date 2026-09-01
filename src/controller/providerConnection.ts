/** Provider-connection replacement is an acknowledgement-gated credential
 * ceremony. Provision the new device key first so the backend can probe it;
 * discard it only when the server rejects the replacement. Once acknowledged,
 * a failed local bind is recoverable at startup from the server's write-only
 * reference and must not roll back/delete the now-active key. */
import type { ModelProvider } from '../../contract/index.ts'
import {
  AccountSwitchedError,
  ApiRequestError,
  bindDesktopCredential,
  discardDesktopCredential,
  provisionDesktopCredential,
  reconcileProviderConnection,
  updateProviderConnection,
} from '../api'
import {
  replaceProviderConnectionCore,
  type ProviderConnectionAttempt,
  type ProviderConnectionDependencies,
} from './providerConnectionCore'

const runtimeDependencies: ProviderConnectionDependencies = {
  provision: provisionDesktopCredential,
  update: updateProviderConnection,
  bind: bindDesktopCredential,
  discard: discardDesktopCredential,
  definitiveFailure: (error) =>
    error instanceof ApiRequestError && [400, 401, 403, 404, 409, 429].includes(error.status),
}

export async function replaceProviderConnection(
  providerId: string,
  attempt: ProviderConnectionAttempt,
  dependencies: ProviderConnectionDependencies = runtimeDependencies,
): Promise<ModelProvider> {
  try {
    return await replaceProviderConnectionCore(providerId, attempt, dependencies)
  } catch (error) {
    // A conflict and a lost acknowledgement both make the public revision
    // suspect. Reconcile before the dialog offers another explicit attempt.
    let reconciled = false
    if (dependencies === runtimeDependencies && !(error instanceof AccountSwitchedError)) {
      try {
        await reconcileProviderConnection(providerId)
        reconciled = true
      } catch {
        // Keep the original mutation failure as the actionable error.
      }
    }
    if (attempt.uncertain) {
      throw new Error('Couldn’t confirm whether this connection changed. Retry sends the exact same request safely.', { cause: error })
    }
    if (error instanceof ApiRequestError && error.status === 409) {
      throw new Error(
        reconciled
          ? 'This provider connection changed elsewhere. The latest revision is loaded—review your fields, then try again.'
          : 'This provider connection changed elsewhere, but the latest revision couldn’t be reloaded. Close this dialog and try again when the connection recovers.',
        { cause: error },
      )
    }
    throw error
  }
}

export { createProviderConnectionAttempt } from './providerConnectionCore'
