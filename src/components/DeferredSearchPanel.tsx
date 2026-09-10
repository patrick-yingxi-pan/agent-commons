import { Component, lazy, Suspense, useRef, type ComponentProps, type ReactNode } from 'react'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { SCRIM_CLASS } from '../lib/scrim.ts'
import { BOUNDED_DIALOG_BODY_CLASS, BOUNDED_DIALOG_LAYER_CLASS, BOUNDED_DIALOG_PANEL_CLASS, DIALOG_SURFACE_CLASS } from '../lib/dialog.ts'
import { useFocusTrap } from '../lib/useFocusTrap.ts'
import { useBoundedDialog } from '../lib/useBoundedDialog.ts'
import { Spinner } from './Spinner.tsx'
import type { SearchPanel } from './SearchPanel.tsx'

const Panel = lazy(() => import('./SearchPanel.tsx').then((module) => ({ default: module.SearchPanel })))
type Props = ComponentProps<typeof SearchPanel>

function SearchLoadState({ failed, onClose }: { failed: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useFocusTrap(dialogRef, onClose, { initialFocus: closeRef })
  useBoundedDialog(dialogRef)
  return (
    <div className={BOUNDED_DIALOG_LAYER_CLASS} onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Search">
      <div className={SCRIM_CLASS} />
      <div
        ref={dialogRef}
        data-bounded-dialog="search"
        role={failed ? 'alert' : 'status'}
        data-search-load-error={failed || undefined}
        data-search-loading={!failed || undefined}
        onMouseDown={(event) => event.stopPropagation()}
        className={`w-[580px] ${BOUNDED_DIALOG_PANEL_CLASS} ${DIALOG_SURFACE_CLASS}`}
      >
        <div className={`p-5 text-center text-[13px] text-ink ${BOUNDED_DIALOG_BODY_CLASS}`}>
          {failed ? (
            <>
              <p>Couldn’t load search.</p>
              <p className="mt-1 text-ink-faint">The app may have updated, or the connection was interrupted.</p>
              <p className="mt-2 text-[12px] text-ink-faint">Copy any unsent workspace text before reloading.</p>
            </>
          ) : (
            <>
              <Spinner size={16} className="mx-auto mb-2 text-ink-faint" />
              <p>Loading search…</p>
            </>
          )}
        </div>
        <div className="flex shrink-0 justify-center gap-2 border-t border-line bg-panel px-5 py-3">
          {failed && (
            <button type="button" className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px]`} onClick={() => window.location.reload()}>
              Reload
            </button>
          )}
          <button ref={closeRef} type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

class SearchLoadBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <SearchLoadState failed onClose={this.props.onClose} />
  }
}

export function DeferredSearchPanel(props: Props) {
  return (
    <SearchLoadBoundary onClose={props.onClose}>
      <Suspense fallback={<SearchLoadState failed={false} onClose={props.onClose} />}>
        <Panel {...props} />
      </Suspense>
    </SearchLoadBoundary>
  )
}
