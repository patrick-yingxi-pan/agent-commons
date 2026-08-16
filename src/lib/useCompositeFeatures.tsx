import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { SectionId } from '../types'
import {
  compositeCommandSnapshot,
  compositeFoldSnapshot,
  consumeCompositeCommand,
  subscribeCompositeCommand,
  subscribeCompositeFold,
  type CompositeCommandKind,
} from './compositeFeatures'

/** Only the focused split pane may answer a rail command. Without this scope,
 * two panes showing the same section would both open a dialog or move focus. */
const FocusedCompositeProjection = createContext(false)

export function CompositeProjectionScope({
  active,
  children,
}: {
  active: boolean
  children: ReactNode
}) {
  return (
    <FocusedCompositeProjection.Provider value={active}>
      {children}
    </FocusedCompositeProjection.Provider>
  )
}

export function useCompositeCommand(
  section: SectionId | undefined,
  kind: CompositeCommandKind,
  onCommand: () => void,
  ready = true,
): void {
  const focused = useContext(FocusedCompositeProjection)
  const command = useSyncExternalStore(
    subscribeCompositeCommand,
    compositeCommandSnapshot,
    compositeCommandSnapshot,
  )
  const handler = useRef(onCommand)
  handler.current = onCommand

  useEffect(() => {
    if (!focused || !ready || !section || command?.section !== section || command.kind !== kind) return
    handler.current()
    consumeCompositeCommand(command.revision)
  }, [focused, ready, section, kind, command?.revision])
}

export function useCompositeFoldSignal() {
  return useSyncExternalStore(
    subscribeCompositeFold,
    compositeFoldSnapshot,
    compositeFoldSnapshot,
  )
}

export function useFocusedCompositeFold(section: SectionId, onFold: (expanded: boolean) => void, ready = true): void {
  const focused = useContext(FocusedCompositeProjection)
  const signal = useCompositeFoldSignal()
  const handled = useRef(0)
  const handler = useRef(onFold)
  handler.current = onFold

  useEffect(() => {
    if (!focused || !ready || signal?.section !== section || signal.revision === handled.current) return
    handled.current = signal.revision
    handler.current(signal.expanded)
  }, [focused, ready, section, signal?.revision])
}
