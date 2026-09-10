import { useCallback, useEffect, useRef, useState } from 'react'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import type { UiHostFile } from './uiHostFs.ts'
import { useUiHostFs } from './useUiHostFs.ts'

type ReviewResult<Candidate> = Candidate | { status: 'cancelled' } | { status: 'error'; message: string }
type ImportState<Candidate> = { status: 'idle' | 'reading' } | { status: 'error'; message: string } | Candidate
type Mode = 'document' | 'slides'

/** Every artifact format shares one local review lifetime. Neither extraction
 * nor adoption writes; account generation and operation identity own both. */
export function useArtifactFileImport<Candidate extends { status: 'ready' }>(
  mode: Mode | null,
  review: (files: readonly UiHostFile[]) => ReviewResult<Candidate>,
) {
  const picker = useUiHostFs(mode !== null)
  const [state, setState] = useState<ImportState<Candidate>>({ status: 'idle' })
  const operation = useRef<{ abort: AbortController; generation: number; mode: Mode } | null>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const discard = useCallback(() => {
    operation.current?.abort.abort()
    operation.current = null
    setState({ status: 'idle' })
  }, [])
  useEffect(discard, [mode, discard])
  useEffect(() => {
    const unsubscribe = onAccountSwitch(discard)
    return () => {
      unsubscribe()
      operation.current?.abort.abort()
      operation.current = null
    }
  }, [discard])
  const pick = () => {
    if (!mode || modeRef.current !== mode || picker.status !== 'ready' || operation.current) return
    const current = { abort: new AbortController(), generation: accountGeneration(), mode }
    operation.current = current
    const live = () => modeRef.current === current.mode && operation.current === current && !current.abort.signal.aborted && current.generation === accountGeneration()
    setState({ status: 'reading' })
    // Admission precedes the gesture: a delayed module load must not open a
    // native chooser after the initiating control has gone away.
    void picker.module.pickUiHostFiles(mode, window, current.abort.signal).then((files) => {
      if (!live()) return
      const result = review(files)
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
    if (!current || modeRef.current !== current.mode || state.status !== 'ready' || current.abort.signal.aborted || current.generation !== accountGeneration()) return
    apply(state)
    discard()
  }
  return { state, picker, pick, discard, accept, reviewing: state.status === 'reading' || state.status === 'ready' }
}
