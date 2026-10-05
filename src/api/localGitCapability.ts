import type { DesktopBridgeScope } from './desktopCredentials.ts'

export function localGitAvailable(scope: DesktopBridgeScope = globalThis.window): boolean {
  return !!scope?.agentCommonsDesktop?.context?.localGit
}
