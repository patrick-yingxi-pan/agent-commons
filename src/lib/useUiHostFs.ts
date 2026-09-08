import { useEffect, useState } from 'react'

export type UiHostFsModule = Pick<
  typeof import('./uiHostFs'),
  'pickUiHostFiles' | 'readDroppedFiles' | 'pickUiHostFolder'
>

export type UiHostFsLoadState =
  | { status: 'idle'; module: null }
  | { status: 'loading'; module: null }
  | { status: 'error'; module: null }
  | { status: 'ready'; module: UiHostFsModule }

/** Load the local-file bridge only while a UI-host picker is mounted. Keeping
 * the import here (before the user clicks) preserves native/browser dialog
 * activation, while the alive fence prevents a late chunk rejection or
 * resolution from writing into a closed picker. */
export function useUiHostFs(enabled: boolean): UiHostFsLoadState {
  const [state, setState] = useState<UiHostFsLoadState>(enabled ? { status: 'loading', module: null } : { status: 'idle', module: null })

  useEffect(() => {
    let alive = true
    if (!enabled) {
      setState({ status: 'idle', module: null })
      return () => { alive = false }
    }
    setState({ status: 'loading', module: null })
    void import('./uiHostFs').then((loaded) => {
      if (!alive) return
      setState({ status: 'ready', module: loaded })
    }).catch(() => {
      if (!alive) return
      setState({ status: 'error', module: null })
    })
    return () => { alive = false }
  }, [enabled])

  return state
}
