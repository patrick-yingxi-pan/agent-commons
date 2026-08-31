/** Provider-connection replacement is an acknowledgement-gated credential
 * ceremony. Provision the new device key first so the backend can probe it;
 * discard it only when the server rejects the replacement. Once acknowledged,
 * a failed local bind is recoverable at startup from the server's write-only
 * reference and must not roll back/delete the now-active key. */
import type { ModelProvider, UpdateProviderConnectionRequest } from '../../contract/index.ts'
import {
  bindDesktopCredential,
  discardDesktopCredential,
  provisionDesktopCredential,
  updateProviderConnection,
} from '../api'
import { replaceProviderConnectionCore, type ProviderConnectionDependencies } from './providerConnectionCore'

const runtimeDependencies: ProviderConnectionDependencies = {
  provision: provisionDesktopCredential,
  update: updateProviderConnection,
  bind: bindDesktopCredential,
  discard: discardDesktopCredential,
}

export async function replaceProviderConnection(
  providerId: string,
  patch: UpdateProviderConnectionRequest,
  deviceSecret?: string,
  dependencies: ProviderConnectionDependencies = runtimeDependencies,
): Promise<ModelProvider> {
  return replaceProviderConnectionCore(providerId, patch, deviceSecret, dependencies)
}
