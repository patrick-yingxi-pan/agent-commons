import { Component, lazy, Suspense, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { McpStdioConnectionView } from '../../contract/mcpConnections.ts'
import type { McpStdioSetupSource } from '../../contract/mcpStdioSetup.ts'
import { useBoundedDialog } from '../lib/useBoundedDialog.ts'
import { useFocusTrap } from '../lib/useFocusTrap.ts'
import { BOUNDED_DIALOG_LAYER_CLASS, BOUNDED_DIALOG_PANEL_CLASS, BOUNDED_DIALOG_BODY_CLASS, DIALOG_SURFACE_CLASS, dialogReadRegionProps } from '../lib/dialog.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'
import { SCRIM_CLASS } from '../lib/scrim.ts'

const Dialog = lazy(() => import('./McpStdioSetupDialog.tsx').then(module => ({ default: module.McpStdioSetupDialog })))
export interface McpStdioSetupDialogProps { connection: McpStdioConnectionView; source: McpStdioSetupSource; onClose: () => void }
function LoadShell({ failed, onClose }: { failed: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null), close = useRef<HTMLButtonElement>(null)
  useFocusTrap(dialogRef, onClose, { initialFocus: close }); useBoundedDialog(dialogRef)
  return createPortal(<div className={BOUNDED_DIALOG_LAYER_CLASS} role="dialog" aria-modal="true" aria-label="Local MCP setup" onMouseDown={onClose}>
    <div className={SCRIM_CLASS} />
    <div ref={dialogRef} tabIndex={-1} data-bounded-dialog="mcp-stdio-load" className={`w-full max-w-lg ${BOUNDED_DIALOG_PANEL_CLASS} ${DIALOG_SURFACE_CLASS}`} onMouseDown={event => event.stopPropagation()}>
      <div {...dialogReadRegionProps('Local server setup loading')} className={`p-4 ${BOUNDED_DIALOG_BODY_CLASS}`}>
        <p role={failed ? 'alert' : 'status'} className="text-[13px] text-ink">{failed ? 'Couldn’t load local server setup.' : 'Loading local server setup…'}</p>
        {failed && <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">Loading this review does not start a process. Copy unsent work before reloading; reload clears in-memory setup recovery, but does not undo an inspection that may already have started. Check the saved connection afterward.</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line bg-panel p-3">
        {failed && <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[13px]`} onClick={() => window.location.reload()}>Reload app</button>}
        <button ref={close} type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[13px]`} onClick={onClose}>Close</button>
      </div>
    </div>
  </div>, document.body)
}
class Boundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <LoadShell failed onClose={this.props.onClose} /> : <Suspense fallback={<LoadShell failed={false} onClose={this.props.onClose} />}>{this.props.children}</Suspense> }
}
export function DeferredMcpStdioSetupDialog(props: McpStdioSetupDialogProps) {
  return <Boundary onClose={props.onClose}><Dialog {...props} /></Boundary>
}
