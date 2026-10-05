import type { DesktopBridgeScope } from './desktopCredentials.ts'

/** Capability detection is eager; native operations load only on use. */
export function localFoldersAvailable(scope: DesktopBridgeScope = globalThis.window): boolean {
  return !!scope?.agentCommonsDesktop?.context?.localFolders
}
