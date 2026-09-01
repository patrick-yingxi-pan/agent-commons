import type {
  DesktopBackupMetadata,
  DesktopBridge,
  DesktopBridgeScope,
  DesktopRestoreResult,
} from './desktopCredentials.ts'

function bridge(scope: DesktopBridgeScope = window): DesktopBridge['data'] | undefined {
  return scope.agentCommonsDesktop?.data
}

export function desktopDataAvailable(scope?: DesktopBridgeScope): boolean {
  return bridge(scope) !== undefined
}

export async function createDesktopBackup(scope?: DesktopBridgeScope): Promise<DesktopBackupMetadata> {
  const data = bridge(scope)
  if (!data) throw new Error('Desktop backup controls are unavailable.')
  return data.createBackup()
}

export async function revealDesktopBackups(scope?: DesktopBridgeScope): Promise<void> {
  const data = bridge(scope)
  if (!data) throw new Error('Desktop backup controls are unavailable.')
  await data.revealBackups()
}

export async function restoreDesktopBackup(scope?: DesktopBridgeScope): Promise<DesktopRestoreResult> {
  const data = bridge(scope)
  if (!data) throw new Error('Desktop backup controls are unavailable.')
  return data.restoreBackup()
}
