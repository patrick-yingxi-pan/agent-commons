import type { McpStdioSetupErrorCode, McpStdioSetupStartRequest, McpStdioSetupView, NativeMcpStdioBridge } from '../../contract/mcpStdioSetup.ts'
import type { DesktopBridgeScope } from './desktopCredentials.ts'
import type { Identity } from '../../contract/identity.ts'
import { peek } from './cache.ts'
import { keys } from './keys.ts'

const codes: readonly McpStdioSetupErrorCode[] = ['invalid', 'unavailable', 'stale', 'busy', 'cancelled', 'expired']
const statuses = ['ready', 'working', 'connected', 'disconnected', 'failed', 'cancelled', 'uncertain']
const bridge = (scope?: DesktopBridgeScope) => scope ? scope.agentCommonsDesktop?.mcpStdio : typeof window === 'undefined' ? undefined : window.agentCommonsDesktop?.mcpStdio
const error = (code: McpStdioSetupErrorCode = 'unavailable') => Object.assign(new Error(`Local MCP setup could not continue (${code}).`), { code })
export function desktopMcpStdioSource() {
  const identity = peek<Identity>(keys.me)
  return identity?.via === 'session' ? { tenantId: identity.tenant.id, userId: identity.user.id } : null
}
export function desktopMcpStdioAvailable(scope?: DesktopBridgeScope): boolean {
  const api = bridge(scope)
  return !!api && ['start', 'authorize', 'reconcile', 'cancel'].every(method => typeof api[method as keyof NativeMcpStdioBridge] === 'function')
}
/** IPC only. A fixed response projection prevents native diagnostics or launch
 * material from entering renderer recovery state. The native host is authority. */
export function desktopMcpStdioApi(scope?: DesktopBridgeScope): NativeMcpStdioBridge {
  const call = async (method: keyof NativeMcpStdioBridge, request: unknown): Promise<McpStdioSetupView> => {
    try {
      const api = bridge(scope)
      if (!api) throw error()
      const result: unknown = await (api[method] as (request: unknown) => Promise<unknown>).call(api, request)
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw error()
      const descriptors = Object.getOwnPropertyDescriptors(result)
      const expected = ['flowId', 'connectionId', 'revision', 'status']
      if (Reflect.ownKeys(result).length !== expected.length || expected.some(key => !descriptors[key] || !Object.hasOwn(descriptors[key], 'value'))) throw error()
      const { flowId, connectionId, revision, status } = Object.fromEntries(expected.map(key => [key, descriptors[key]!.value]))
      if (typeof flowId !== 'string' || !flowId || flowId.length > 128 || typeof connectionId !== 'string' || !connectionId || connectionId.length > 200 || !Number.isSafeInteger(revision) || revision < 0 || !statuses.includes(status)) throw error()
      return Object.freeze({ flowId, connectionId, revision, status }) as McpStdioSetupView
    } catch (cause) {
      const descriptor = cause && typeof cause === 'object' ? Object.getOwnPropertyDescriptor(cause, 'code') : undefined
      throw error(descriptor && Object.hasOwn(descriptor, 'value') && codes.includes(descriptor.value) ? descriptor.value : 'unavailable')
    }
  }
  return { start: (request: McpStdioSetupStartRequest) => call('start', request), authorize: request => call('authorize', request),
    reconcile: request => call('reconcile', request), cancel: request => call('cancel', request) }
}
