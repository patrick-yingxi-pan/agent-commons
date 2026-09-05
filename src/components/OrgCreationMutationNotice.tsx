import {
  discardOrgCreation,
  retryOrgCreation,
  useOrgCreationStatus,
} from '../controller/orgCreationMutations.ts'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function OrgCreationMutationNotice() {
  const mutation = useOrgCreationStatus()
  return (
    <RevisionedMutationNotice
      kind="org-create"
      mutation={mutation}
      pendingLabel="Creating organization…"
      onRetry={retryOrgCreation}
      onDiscard={discardOrgCreation}
    />
  )
}
