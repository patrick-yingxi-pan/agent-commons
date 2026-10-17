import { lazy, Suspense, type ComponentProps } from 'react'
import type { ModelPickerMenuBody } from './ModelPickerMenuBody'
import { SECONDARY_BUTTON_CLASS } from '../lib/button'
import { DeferredLoadBoundary } from './DeferredLoadBoundary'

const Menu = lazy(() =>
  import('./ModelPickerMenuBody').then((module) => ({ default: module.ModelPickerMenuBody })),
)
const STATUS_CLASS = 'p-3 text-[12px] leading-relaxed text-ink-soft'

/** All pickers share one on-demand catalog. Loading failure stays inside the
 * caller's popover, leaving the draft and current selection untouched. */
export function ModelPickerMenu(props: ComponentProps<typeof ModelPickerMenuBody>) {
  return (
    <DeferredLoadBoundary fallback={
      <div role="alert" data-model-picker-load-error className={STATUS_CLASS}>
        <p>Couldn’t load model choices. Your selection hasn’t changed.</p>
        <p className="mt-1">Copy any unsent text before reloading.</p>
        <button type="button" className={`${SECONDARY_BUTTON_CLASS} mt-2 px-2.5 py-1 text-[12px]`}
          onClick={() => window.location.reload()}>Reload model choices</button>
      </div>
    }>
      <Suspense fallback={<div role="status" data-model-picker-loading className={STATUS_CLASS}>
        Loading model choices…
      </div>}>
        <Menu {...props} />
      </Suspense>
    </DeferredLoadBoundary>
  )
}

/** The toolbar uses this even while the catalog is closed, so it stays eager. */
export function OnlineDot({ online }: { online?: boolean }) {
  return (
    <span
      title={online ? 'Session connected' : 'Offline — drain loop not running'}
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${online ? 'bg-added' : 'bg-ink-faint/50'}`}
    />
  )
}
