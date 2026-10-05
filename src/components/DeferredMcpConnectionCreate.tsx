import { Component, lazy, Suspense, useRef, type ComponentProps, type ReactNode } from 'react'
import type * as McpViews from './McpConnectionPanel.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'
import { BOUNDED_DIALOG_BODY_CLASS, BOUNDED_DIALOG_LAYER_CLASS, BOUNDED_DIALOG_PANEL_CLASS, DIALOG_SURFACE_CLASS } from '../lib/dialog.ts'
import { SCRIM_CLASS } from '../lib/scrim.ts'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { useFocusTrap } from '../lib/useFocusTrap.ts'
import { useBoundedDialog } from '../lib/useBoundedDialog.ts'

const CreateDialog = lazy(() => import('./McpConnectionPanel.tsx').then((module) => ({ default: module.McpConnectionCreateDialog })))
type CreateProps = ComponentProps<typeof McpViews.McpConnectionCreateDialog>

class Boundary extends Component<{ children: ReactNode; fallback: (failed: boolean) => ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? this.props.fallback(true)
      : <Suspense fallback={this.props.fallback(false)}>{this.props.children}</Suspense>
  }
}

function CreateFallback({ failed, onClose }: { failed: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useFocusTrap(dialogRef, onClose, { initialFocus: cancelRef })
  useBoundedDialog(dialogRef)
  return (
    <div className={BOUNDED_DIALOG_LAYER_CLASS} onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Add an MCP server">
      <div className={SCRIM_CLASS} />
      <div ref={dialogRef} data-bounded-dialog="mcp-create-load" onMouseDown={(event) => event.stopPropagation()}
        className={`w-[460px] ${BOUNDED_DIALOG_PANEL_CLASS} ${DIALOG_SURFACE_CLASS}`}>
        <div className={`p-5 text-center text-[13px] text-ink ${BOUNDED_DIALOG_BODY_CLASS}`}>
          <InlineOperationStatus tone={failed ? 'alert' : 'status'} message={failed
            ? 'Couldn’t load MCP setup. No server was saved. Copy any unsent workspace text before reloading.'
            : 'Loading MCP setup…'} />
        </div>
        <div className="flex shrink-0 justify-center gap-2 border-t border-line bg-panel px-5 py-3">
          {failed && <button type="button" className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px]`} onClick={() => window.location.reload()}>Reload app</button>}
          <button ref={cancelRef} type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export function DeferredMcpConnectionCreateDialog(props: CreateProps) {
  return <Boundary fallback={(failed) => <CreateFallback failed={failed} onClose={props.onClose} />}><CreateDialog {...props} /></Boundary>
}
