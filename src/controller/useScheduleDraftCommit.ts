import { useRef, useState } from 'react'
import type { SchedulePatch } from '../../contract/index.ts'
import type { RevisionedMutationOutcome } from './revisionedMutationCore'

/** One routine draft has one settlement grammar regardless of which field owns
 * it. Retry is retained by the shared revision controller; this hook keeps the
 * editor frozen until acknowledgement and preserves its values after Dismiss. */
export function useScheduleDraftCommit(
  update: (scheduleId: string, patch: SchedulePatch, expectedRevision: number) => Promise<RevisionedMutationOutcome>,
  scheduleId: string,
  draftLabel: string,
  onApplied: () => void,
  onHeldChange?: (held: boolean) => void,
) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)

  const commit = async (
    patch: SchedulePatch,
    expectedRevision: number,
  ) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    onHeldChange?.(true)
    const outcome = await update(scheduleId, patch, expectedRevision)
    busyRef.current = false
    setBusy(false)
    onHeldChange?.(false)
    if (outcome === 'applied') {
      onApplied()
      return
    }
    setError(`Your ${draftLabel} draft was not saved. Review the latest routine, then apply what you still want.`)
  }

  return { busy, error, clearError: () => setError(null), commit }
}
