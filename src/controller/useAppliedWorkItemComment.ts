import { useEffect, useRef } from 'react'
import { subscribeWorkItemCommentCreationApplied } from './workItemCommentCreationMutations.ts'

/** Clears only the exact editor body whose keyed comment creation was acknowledged. */
export function useAppliedWorkItemComment(
  tenantId: string | undefined,
  projectId: string,
  itemId: string,
  draft: string,
  onApplied: () => void,
): void {
  const draftRef = useRef(draft)
  draftRef.current = draft
  const onAppliedRef = useRef(onApplied)
  onAppliedRef.current = onApplied
  useEffect(() => subscribeWorkItemCommentCreationApplied((event) => {
    if (event.tenantId !== tenantId || event.projectId !== projectId || event.itemId !== itemId || draftRef.current !== event.body) return
    onAppliedRef.current()
  }), [tenantId, projectId, itemId])
}
