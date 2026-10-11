import { mcpStdioSetup, useMcpStdioSetups } from '../controller/mcpStdioSetup.ts'
import { mcpStdioBusy, mcpStdioTerminal } from '../controller/mcpStdioSetupCore.ts'
import { McpStdioSetupStatus } from './McpStdioSetupStatus.tsx'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'
import { RECOVERY_NOTICE_REGION_CLASS, RECOVERY_NOTICE_MESSAGE_CLASS } from '../lib/recoveryNotice.ts'

export function McpStdioSetupNotice() {
  const states = useMcpStdioSetups()
  if (!states.length) return null
  return <div data-mcp-stdio-recovery role="region" aria-label="Local server setup recovery" tabIndex={0}
    className={`relative z-[60] shrink-0 space-y-3 border-b border-line bg-panel px-3 py-2 ${RECOVERY_NOTICE_REGION_CLASS}`}>
    {states.map(state => <div key={state.connectionId} role="group" aria-label={`Local server setup · ${state.label}`} className="flex min-w-0 flex-wrap items-center justify-center gap-2">
      <div data-recovery-notice-message className={RECOVERY_NOTICE_MESSAGE_CLASS}><p className="text-[12px] font-medium text-ink">{state.label}</p><McpStdioSetupStatus state={state} /></div>
      {mcpStdioTerminal(state.phase)
        ? <button className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`} onClick={() => mcpStdioSetup.dismiss(state.connectionId)}>Dismiss</button>
        : <>
          {!mcpStdioBusy(state.phase) && <button className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`} onClick={() => void mcpStdioSetup.check(state.connectionId)}>Check status</button>}
          <button disabled={state.phase === 'cancelling'} className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`} onClick={() => void mcpStdioSetup.cancel(state.connectionId)}>Stop setup</button>
        </>}
    </div>)}
  </div>
}
