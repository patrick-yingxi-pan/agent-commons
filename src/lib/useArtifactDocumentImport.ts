import { useCallback, useEffect, useRef, useState } from 'react'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { reviewArtifactDocumentImport } from './artifactDocumentImport.ts'
import { useUiHostFs } from './useUiHostFs.ts'

type Candidate = Extract<ReturnType<typeof reviewArtifactDocumentImport>, { status: 'ready' }>
type ImportState = { status: 'idle' | 'reading' } | { status: 'error'; message: string } | Candidate

/** Import is a local review, never a mutation. The operation owns its account
 * generation through both extraction and explicit adoption into the draft. */
export function useArtifactDocumentImport(enabled: boolean) {
  const picker = useUiHostFs(enabled)
  const [state, setState] = useState<ImportState>({ status: 'idle' })
  const operation = useRef<{ abort: AbortController; generation: number } | null>(null)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const discard = useCallback(() => {
    operation.current?.abort.abort()
    operation.current = null
    setState({ status: 'idle' })
  }, [])
  useEffect(() => {
    if (!enabled) discard()
  }, [enabled, discard])
  useEffect(() => {
    const unsubscribe = onAccountSwitch(discard)
    return () => {
      unsubscribe()
      operation.current?.abort.abort()
      operation.current = null
    }
  }, [discard])
  const pick = () => {
    if (!enabledRef.current || picker.status !== 'ready' || operation.current) return
    const current = { abort: new AbortController(), generation: accountGeneration() }
    operation.current = current
    const live = () => enabledRef.current && operation.current === current && !current.abort.signal.aborted && current.generation === accountGeneration()
    setState({ status: 'reading' })
    // Call synchronously in the gesture; the loader has already admitted the
    // module. Never open a delayed native chooser after an async chunk load.
    void picker.module.pickUiHostFiles('document', window, current.abort.signal).then((files) => {
      if (!live()) return
      const result = reviewArtifactDocumentImport(files)
      if (result.status !== 'ready') operation.current = null
      setState(result.status === 'cancelled' ? { status: 'idle' } : result)
    }, () => {
      if (!live()) return
      operation.current = null
      setState({ status: 'error', message: 'The file could not be read. Check its permissions and try again. Your draft is unchanged.' })
    })
  }
  const accept = (apply: (candidate: Candidate) => void) => {
    const current = operation.current
    if (!enabledRef.current || state.status !== 'ready' || !current || current.abort.signal.aborted || current.generation !== accountGeneration()) return
    apply(state)
    discard()
  }
  return { state, picker, pick, discard, accept, reviewing: state.status === 'reading' || state.status === 'ready' }
}
