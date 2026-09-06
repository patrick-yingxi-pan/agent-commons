import {
  discardCommonsLike,
  retryCommonsLike,
  useCommonsLikeStatus,
} from '../controller/commonsLikeMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

/** One shell recovery surface for Commons endorsement uncertainty. */
export function CommonsLikeMutationNotice() {
  const mutation = useCommonsLikeStatus()
  return (
    <RevisionedMutationNotice
      kind="commons-like"
      mutation={mutation}
      pendingLabel="Saving Like…"
      onRetry={retryCommonsLike}
      onDiscard={discardCommonsLike}
    />
  )
}
