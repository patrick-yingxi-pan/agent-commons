import {
  discardDispatchMutation,
  retryDispatchMutation,
  useDispatchMutationStatus,
} from '../controller/dispatchMutations'
import { RevisionedMutationNotice } from './RevisionedMutationNotice'

export function DispatchMutationNotice() {
  const mutation = useDispatchMutationStatus()
  return (
    <RevisionedMutationNotice
      kind="dispatch-create"
      mutation={mutation}
      pendingLabel="Starting dispatch…"
      onRetry={retryDispatchMutation}
      onDiscard={discardDispatchMutation}
    />
  )
}
