import type { UiHostFsLoadState } from '../lib/useUiHostFs.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'

/** One recovery face for every consumer of the lazy local-file bridge. */
export function UiHostLoadNotice({ state, label }: { state: UiHostFsLoadState; label: string }) {
  if (state.status === 'loading') {
    return <p role="status" aria-busy="true" className="px-1 py-6 text-center text-[11px] text-ink-soft">Loading {label}…</p>
  }
  if (state.status === 'error') {
    return (
      <div role="alert" data-local-picker-load="error" className="px-1 py-4 text-center text-[11px] text-danger-text">
        <p>Local {label} could not be loaded.</p>
        <p className="mt-1 text-ink-soft">Reload the app to try again. Copy any unsent text first.</p>
        <button type="button" onClick={() => window.location.reload()} className={`${SECONDARY_BUTTON_CLASS} mt-2 px-2 py-1 text-[11px]`}>Reload app</button>
      </div>
    )
  }
  return null
}
