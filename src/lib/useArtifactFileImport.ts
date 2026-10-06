import { useCallback, useEffect, useRef, useState } from 'react'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import type { UiHostFile } from './uiHostFs.ts'
import { useUiHostFs } from './useUiHostFs.ts'

type ReviewResult<Candidate> = Candidate | { status: 'cancelled' } | { status: 'error'; message: string }
type ImportState<Candidate> = { status: 'idle' | 'reading' } | { status: 'error'; message: string } | Candidate
type Mode = 'document' | 'slides' | 'sheet' | 'image-text'

/** Every artifact format shares one local review lifetime. Neither extraction
 * nor adoption writes; account generation and operation identity own both. */
export function useArtifactFileImport<Candidate extends { status: 'ready' }>(
  mode: Mode | null,
  review: (files: readonly UiHostFile[], signal: AbortSignal, selectionMode: Mode) => ReviewResult<Candidate> | Promise<ReviewResult<Candidate>>,
) {
  const picker = useUiHostFs(mode !== null)
  const [state, setState] = useState<ImportState<Candidate>>({ status: 'idle' })
  const operation = useRef<{ abort: AbortController; generation: number; mode: Mode; selectionMode: Mode } | null>(null)
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
  const pickAs = (selectionMode: Mode) => {
    if (!mode || modeRef.current !== mode || picker.status !== 'ready' || operation.current) return
    const current = { abort: new AbortController(), generation: accountGeneration(), mode, selectionMode }
    operation.current = current
    const live = () => modeRef.current === current.mode && operation.current === current && !current.abort.signal.aborted && current.generation === accountGeneration()
    setState({ status: 'reading' })
    // Admission precedes the gesture: a delayed module load must not open a
    // native chooser after the initiating control has gone away.
    void picker.module.pickUiHostFiles(selectionMode, window, current.abort.signal).then(async (files) => {
      if (!live()) return
      const result = await review(files, current.abort.signal, selectionMode)
      if (!live()) return
      if (result.status !== 'ready') operation.current = null
      setState(result.status === 'cancelled' ? { status: 'idle' } : result)
    }).catch((error: unknown) => {
      if (!live()) return
      operation.current = null
      const message = error instanceof picker.module.UiHostPickerError ? error.message : 'The file could not be read. Check its permissions and try again.'
      setState({ status: 'error', message: `${message} Your draft is unchanged.` })
    })
  }
  const accept = (apply: (candidate: Candidate) => void) => {
    const current = operation.current
    if (!current || modeRef.current !== current.mode || state.status !== 'ready' || current.abort.signal.aborted || current.generation !== accountGeneration()) return
    apply(state)
    discard()
  }
  // Zero-argument actions cannot accidentally treat a DOM click as a mode.
  const pick = () => { if (mode) pickAs(mode) }
  return { state, picker, pick, pickAs, discard, accept, selectionMode: operation.current?.selectionMode, reviewing: state.status === 'reading' || state.status === 'ready' }
}
