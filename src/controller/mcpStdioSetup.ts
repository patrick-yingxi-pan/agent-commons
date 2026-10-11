import { useSyncExternalStore } from 'react'
import { onAccountSwitch } from '../api/account.ts'
import { desktopMcpStdioApi, desktopMcpStdioSource } from '../api/desktopMcpStdio.ts'
import { invalidate } from '../api/cache.ts'
import { keys } from '../api/keys.ts'
import { createMcpStdioSetupController, mcpStdioTerminal } from './mcpStdioSetupCore.ts'

export const mcpStdioSetup = createMcpStdioSetupController({ api: desktopMcpStdioApi(), currentSource: desktopMcpStdioSource,
  refresh(id) { invalidate(keys.mcpConnection(id)); invalidate(keys.mcpConnections); invalidate(keys.savedContexts) } })
onAccountSwitch(() => mcpStdioSetup.reset())
export const useMcpStdioSetups = () => useSyncExternalStore(mcpStdioSetup.subscribe, mcpStdioSetup.snapshot, mcpStdioSetup.snapshot)
export const isMcpStdioSetupHeld = (id: string) => mcpStdioSetup.snapshot().some(state => state.connectionId === id && !mcpStdioTerminal(state.phase))
