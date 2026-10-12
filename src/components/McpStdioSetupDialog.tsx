import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { McpStdioSetupDialogProps } from './DeferredMcpStdioSetupDialog.tsx'
import { MCP_STDIO_TOOL_APPROVAL_COPY } from '../../contract/mcpStdioSetupCopy.mjs'
import { mcpStdioSetup, useMcpStdioSetups } from '../controller/mcpStdioSetup.ts'
import { mcpStdioTerminal, mcpStdioBusy } from '../controller/mcpStdioSetupCore.ts'
import { EMPTY_MCP_STDIO_DRAFT, parseMcpStdioLaunchDraft } from '../lib/mcpStdioLaunch.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { useBoundedDialog } from '../lib/useBoundedDialog.ts'
import { useFocusTrap } from '../lib/useFocusTrap.ts'
import { BOUNDED_DIALOG_LAYER_CLASS, BOUNDED_DIALOG_PANEL_CLASS, BOUNDED_DIALOG_BODY_CLASS, DIALOG_SURFACE_CLASS, dialogReadRegionProps } from '../lib/dialog.ts'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { SCRIM_CLASS } from '../lib/scrim.ts'
import { McpStdioSetupStatus } from './McpStdioSetupStatus.tsx'

export function McpStdioSetupDialog({ connection, source, onClose }: McpStdioSetupDialogProps) {
  const id = useId(), dialogRef = useRef<HTMLDivElement>(null), close = useRef<HTMLButtonElement>(null)
  const reviewed = useRef({ connection, source }).current
  const [draft, setDraft] = useState(() => ({ ...EMPTY_MCP_STDIO_DRAFT }))
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const state = useMcpStdioSetups().find(state => state.connectionId === connection.id)
  const held = !!state && !mcpStdioTerminal(state.phase)
  const busy = !!state && mcpStdioBusy(state.phase)
  useFocusTrap(dialogRef, onClose, { initialFocus: close }); useBoundedDialog(dialogRef)
  const submit = () => {
    if (state || submitted) return
    const result = parseMcpStdioLaunchDraft(draft)
    if (!result.launch) { setError(result.error); return }
    setError(null)
    setSubmitted(true)
    void mcpStdioSetup.begin(reviewed.connection, reviewed.source, result.launch)
    // Configuration is write-only. Recovery retains only the opaque flow ID.
    setDraft({ ...EMPTY_MCP_STDIO_DRAFT })
  }
  const field = `${FORM_INPUT_CLASS} mt-1 min-w-0`
  return createPortal(<div className={BOUNDED_DIALOG_LAYER_CLASS} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onMouseDown={onClose}>
    <div className={SCRIM_CLASS} />
    <div ref={dialogRef} tabIndex={-1} data-bounded-dialog="mcp-stdio-setup" className={`w-full max-w-lg ${BOUNDED_DIALOG_PANEL_CLASS} ${DIALOG_SURFACE_CLASS}`} onMouseDown={event => event.stopPropagation()}>
      <header className="shrink-0 p-4 pb-0"><h2 id={`${id}-title`} className="break-words text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">Configure {connection.label}</h2></header>
      <div {...dialogReadRegionProps('Local MCP setup review')} className={`space-y-4 p-4 ${BOUNDED_DIALOG_BODY_CLASS}`}>
        <p className="text-[13px] leading-relaxed text-ink-soft">This runs a local program with your macOS account’s access. It is not sandboxed: even catalog inspection can read files, use the network, or change data. Only use a server you trust. The next native review defaults to Cancel.</p>
        <p className="text-[12px] leading-relaxed text-ink-soft">Settings go only to this desktop’s encrypted storage after approval, never to the application server or a model. Saved settings cannot be read back here. {MCP_STDIO_TOOL_APPROVAL_COPY}</p>
        {state && <McpStdioSetupStatus state={state} />}
        {!state && submitted && <p role="status" className="text-[13px] text-ink-soft">This review has ended. Close it to see the saved connection’s current status or configure new settings.</p>}
        {!state && !submitted && <form id={`${id}-form`} className="space-y-4" onSubmit={event => { event.preventDefault(); submit() }}>
          <label className="block text-[12px] font-medium text-ink">Executable path
            <input required maxLength={4096} value={draft.executable} autoComplete="off" autoCapitalize="none" spellCheck={false} className={field} aria-describedby={`${id}-paths`} onChange={event => setDraft({ ...draft, executable: event.target.value })} />
          </label>
          <label className="block text-[12px] font-medium text-ink">Working directory
            <input required maxLength={4096} value={draft.cwd} autoComplete="off" autoCapitalize="none" spellCheck={false} className={field} aria-describedby={`${id}-paths`} onChange={event => setDraft({ ...draft, cwd: event.target.value })} />
          </label>
          <p id={`${id}-paths`} className="text-[12px] leading-relaxed text-ink-soft">Use full paths beginning with /. No shell is used; ~, variables, pipes and command substitutions are not expanded.</p>
          <label className="block text-[12px] font-medium text-ink">Arguments (JSON array)
            <textarea rows={3} maxLength={131072} value={draft.argumentsJson} autoComplete="off" autoCapitalize="none" spellCheck={false} className={`${field} font-mono`} aria-describedby={`${id}-args`} onChange={event => setDraft({ ...draft, argumentsJson: event.target.value })} />
          </label>
          <p id={`${id}-args`} className="text-[12px] leading-relaxed text-ink-soft">Each string is one literal argument, for example ["/full/path/server.mjs", "--read-only"]. An empty array [] passes no arguments.</p>
          <label className="block text-[12px] font-medium text-ink">Environment (JSON object)
            <textarea rows={3} maxLength={131072} value={draft.environmentJson} autoComplete="off" autoCapitalize="none" spellCheck={false} className={`${field} font-mono`} aria-describedby={`${id}-env`} onChange={event => setDraft({ ...draft, environmentJson: event.target.value })} />
          </label>
          <p id={`${id}-env`} className="text-[12px] leading-relaxed text-ink-soft">Only these variables are passed; your shell environment is not inherited. Use string values, for example {`{"MODE":"read-only"}`}. Values may be sensitive and will be visible in this form and the native review.</p>
        </form>}
        {error && <p role="alert" className="text-[12px] leading-relaxed text-danger-text">{error}</p>}
        <p className="text-[12px] leading-relaxed text-ink-soft">You can close this review and return to this connection. Reloading clears in-memory recovery; it does not undo a started inspection. The saved connection is the source of current status.</p>
      </div>
      <div data-mcp-stdio-actions className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line bg-panel p-3">
        {held && <button type="button" disabled={state.phase === 'cancelling'} className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[13px]`} onClick={() => void mcpStdioSetup.cancel(connection.id)}>Stop setup</button>}
        {held && !busy && <button type="button" className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[13px]`} onClick={() => void mcpStdioSetup.check(connection.id)}>Check status</button>}
        {!state && !submitted && <button type="submit" form={`${id}-form`} className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[13px]`}>Review &amp; inspect</button>}
        <button ref={close} type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[13px]`} onClick={onClose}>{held ? 'Close and keep recovery' : 'Close'}</button>
      </div>
    </div>
  </div>, document.body)
}
