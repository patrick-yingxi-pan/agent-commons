import {
  discardSocialPostMutation,
  retrySocialPostMutation,
  useSocialPostMutationStatus,
} from '../controller/socialPostMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function SocialPostMutationNotice() {
  const mutation = useSocialPostMutationStatus()
  return (
    <RevisionedMutationNotice
      kind="social-post"
      mutation={mutation}
      pendingLabel="Posting…"
      onRetry={retrySocialPostMutation}
      onDiscard={discardSocialPostMutation}
    />
  )
}
