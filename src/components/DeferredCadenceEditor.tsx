import { lazy, Suspense, useCallback, type ComponentProps } from 'react'
import { Check } from 'lucide-react'
import { POPOVER_SURFACE } from '../lib/popover'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button'
import { useDismissable } from '../lib/useDismissable'
import { usePopoverShift } from '../lib/usePopoverShift'
import { Spinner } from './Spinner'
import { DeferredLoadBoundary } from './DeferredLoadBoundary'
import type { CadenceEditor } from './CadenceEditor'

const Editor = lazy(() => import('./CadenceEditor').then((module) => ({ default: module.CadenceEditor })))
type Props = Omit<ComponentProps<typeof CadenceEditor>, 'softButtonClass'>

function CadenceEditorLoadState({ failed, onClose }: { failed: boolean; onClose: () => void }) {
  return (
    <div data-cadence-editor-load={failed ? 'error' : 'loading'}>
      <div role={failed ? 'alert' : 'status'} className="text-[12px] text-ink-soft">
        {failed ? <p>Couldn’t load the schedule editor. No change was made. Copy any unsent workspace text before reloading.</p> : <><Spinner size={13} className="mr-1 inline-block" />Loading schedule editor…</>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`} onClick={onClose}>Close</button>
          {failed && <button type="button" className={`${SOFT_BUTTON_CLASS} px-2 py-1 text-[12px]`} onClick={() => window.location.reload()}>Reload app</button>}
        </div>
      </div>
    </div>
  )
}

export function DeferredCadenceEditor(props: Props) {
  const dismissRef = useDismissable<HTMLDivElement>(true, props.onClose)
  const shiftRef = usePopoverShift<HTMLDivElement>(true)
  const panelRef = useCallback((element: HTMLDivElement | null) => {
    dismissRef.current = element
    shiftRef.current = element
  }, [dismissRef, shiftRef])
  const loading = <CadenceEditorLoadState failed={false} onClose={props.onClose} />
  return <div ref={panelRef} role="dialog" aria-label="Edit schedule" aria-busy={props.busy} data-cadence-editor-shell className={`absolute right-0 top-full z-30 mt-1.5 w-[280px] p-3 ${POPOVER_SURFACE}`}>
    <DeferredLoadBoundary fallback={<CadenceEditorLoadState failed onClose={props.onClose} />}>
      <Suspense fallback={loading}>
        <Editor {...props} softButtonClass={SOFT_BUTTON_CLASS} busyIndicator={<Spinner size={13} />} doneIndicator={<Check size={13} />} />
      </Suspense>
    </DeferredLoadBoundary>
  </div>
}
